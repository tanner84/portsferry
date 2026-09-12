/**
 * Preview and atomically apply stable-ID Google Sheets corrections.
 *
 * POST /api/admin/corrections
 *   { "action": "preview", "operations": [...] }
 *   { "action": "apply",   "operations": [...preparedFromPreview] }
 */

import type { Config, Context } from '@netlify/functions';
import { google } from 'googleapis';
import {
  buildMutationRequests,
  findConflicts,
  previewCorrections,
  requiredSheetNames,
  summarizeApplied,
} from './_shared/correction-core.mjs';

declare const Netlify: {
  env: { get(name: string): string | undefined };
};

type SheetRow = { rowIndex: number; values: Record<string, string> };
type SheetData = { headers: string[]; rows: SheetRow[] };

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed — use POST.' });
  }

  const adminPassword = Netlify.env.get('ADMIN_PASSWORD');
  if (!adminPassword || request.headers.get('x-admin-password') !== adminPassword) {
    return jsonResponse(401, { error: 'Unauthorized.' });
  }

  let payload: { action?: string; operations?: unknown[] };
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse(400, { error: `Invalid JSON: ${errorMessage(error)}` });
  }

  const action = payload?.action;
  const operations = payload?.operations;
  if (action !== 'preview' && action !== 'apply') {
    return jsonResponse(400, { error: 'action must be preview or apply.' });
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    return jsonResponse(400, { error: 'operations must be a non-empty JSON array.' });
  }
  if (operations.length > 100) {
    return jsonResponse(400, { error: 'Correction batches are limited to 100 operations.' });
  }

  const spreadsheetId = Netlify.env.get('GOOGLE_SHEETS_ID');
  const serviceAccountEmail = Netlify.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = readPrivateKey();
  if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
    return jsonResponse(500, { error: 'Google Sheets credentials are not fully configured.' });
  }

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = google.sheets({ version: 'v4', auth });

  try {
    const names = requiredSheetNames(operations);
    const [sheets, sheetIds] = await Promise.all([
      loadSheetData(client, spreadsheetId, names),
      loadSheetIds(client, spreadsheetId),
    ]);

    const preview = previewCorrections(operations, sheets);
    if (action === 'preview') {
      return jsonResponse(preview.valid ? 200 : 400, preview);
    }

    if (!preview.valid) {
      return jsonResponse(400, {
        error: 'The correction batch is no longer valid. Preview it again.',
        ...preview,
      });
    }

    const conflicts = findConflicts(operations, preview.items);
    if (conflicts.length > 0) {
      return jsonResponse(409, {
        error: 'One or more rows changed after preview. Nothing was written.',
        conflicts,
      });
    }

    const sessionId = `corr_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const timestamp = new Date().toISOString();
    const requests = buildMutationRequests(preview.items, sheets, sheetIds, { sessionId, timestamp });

    await client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });

    return jsonResponse(200, {
      sessionId,
      auditRecorded: true,
      ...summarizeApplied(preview.items),
    });
  } catch (error) {
    console.error('[sheets-correct] request failed:', error);
    return jsonResponse(500, { error: errorMessage(error) });
  }
};

export const config: Config = {
  path: ['/api/admin/corrections', '/.netlify/functions/sheets-correct'],
};

function readPrivateKey() {
  const raw = Netlify.env.get('GOOGLE_PRIVATE_KEY') || '';
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function loadSheetData(
  client: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  names: string[],
): Promise<Record<string, SheetData>> {
  const entries = await Promise.all(names.map(async name => {
    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheetName(name)}!A:ZZ`,
      valueRenderOption: 'FORMULA',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    const values = response.data.values || [[]];
    const headers = (values[0] || []).map(value => String(value));
    const rows = values.slice(1).map((row, rowIndex) => {
      const record: Record<string, string> = {};
      headers.forEach((header, columnIndex) => {
        const value = row[columnIndex];
        record[header] = value === undefined || value === null ? '' : String(value);
      });
      return { rowIndex, values: record };
    });
    return [name, { headers, rows }] as const;
  }));

  return Object.fromEntries(entries);
}

async function loadSheetIds(
  client: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
): Promise<Record<string, number>> {
  const response = await client.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  });
  const result: Record<string, number> = {};
  for (const sheet of response.data.sheets || []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && Number.isInteger(sheetId)) result[title] = sheetId as number;
  }
  return result;
}

function quoteSheetName(name: string) {
  return `'${name.replace(/'/g, "''")}'`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
