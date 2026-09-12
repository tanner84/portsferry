/**
 * sheets-correct.js — safe record correction / reassignment / deletion API
 *
 * POST /.netlify/functions/sheets-correct
 * Header: x-admin-password: <ADMIN_PASSWORD>
 * Body: { mode: "preview" | "apply", operations: [...] }
 *
 * Rows are always addressed by a stable record ID. Apply requests must include
 * the complete expected row returned by preview; a changed row is rejected.
 */

'use strict';

import { google } from 'googleapis';

const RECORD_ID = {
  INDIVIDUALS:         'ind_id',
  CHURCHES:            'ch_id',
  PROPERTIES:          'prop_id',
  UNITS:               'unit_id',
  EVENTS:              'evt_id',
  SOURCES:             'src_id',
  BATTLES:             'battle_id',
  UNIT_POSITIONS:      'pos_id',
  BATTLE_PARTICIPANTS: 'bp_id',
  IND_CHURCH:          'link_id',
  IND_UNIT:            'link_id',
  IND_PROPERTY:        'link_id',
  IND_IND:             'edge_id',
  EVT_LINKS:           'link_id',
  WEATHER:             'weather_id',
  COUNTIES:            'county_id',
};

const FOREIGN_KEYS = {
  IND_CHURCH: {
    ind_id: 'INDIVIDUALS',
    ch_id:  'CHURCHES',
  },
  IND_UNIT: {
    ind_id:  'INDIVIDUALS',
    unit_id: 'UNITS',
  },
  IND_PROPERTY: {
    ind_id:  'INDIVIDUALS',
    prop_id: 'PROPERTIES',
  },
  IND_IND: {
    ind_id_a: 'INDIVIDUALS',
    ind_id_b: 'INDIVIDUALS',
  },
};

const ALLOWED_OPS = new Set(['update', 'reassign', 'delete']);
const META_KEYS = new Set([
  'operation', 'entry_type', 'record_id', 'changes', 'reason', 'source_ids', 'expected',
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function buildSheetsClient(serviceAccountEmail, privateKey) {
  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets'],
  );
  return google.sheets({ version: 'v4', auth });
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] === undefined ? '' : String(row[i]); });
  return obj;
}

function normalizeObject(headers, obj) {
  const out = {};
  headers.forEach(h => {
    out[h] = obj && obj[h] !== undefined && obj[h] !== null ? String(obj[h]) : '';
  });
  return out;
}

function sameRow(headers, a, b) {
  const na = normalizeObject(headers, a);
  const nb = normalizeObject(headers, b);
  return headers.every(h => na[h] === nb[h]);
}

function changedFields(headers, before, after) {
  if (!after) {
    return headers
      .filter(h => String(before[h] ?? '') !== '')
      .map(field => ({ field, before: String(before[field] ?? ''), after: null }));
  }
  const diffs = [];
  for (const h of headers) {
    const b = before[h] === undefined || before[h] === null ? '' : String(before[h]);
    const a = after[h]  === undefined || after[h]  === null ? '' : String(after[h]);
    if (a !== b) diffs.push({ field: h, before: b, after: a });
  }
  return diffs;
}

function validateShape(op, index) {
  const errors = [];
  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    return [`Operation ${index + 1} must be an object`];
  }
  if (!ALLOWED_OPS.has(op.operation)) errors.push(`Unknown operation "${op.operation || ''}"`);
  if (!RECORD_ID[op.entry_type]) errors.push(`Unknown or unsupported entry_type "${op.entry_type || ''}"`);
  if (!op.record_id || typeof op.record_id !== 'string') errors.push('record_id is required');
  if ((op.operation === 'update' || op.operation === 'reassign') &&
      (!op.changes || typeof op.changes !== 'object' || Array.isArray(op.changes))) {
    errors.push('changes object is required for update/reassign');
  }
  if (op.operation === 'delete' && op.changes && Object.keys(op.changes).length) {
    errors.push('delete must not include changes');
  }
  for (const k of Object.keys(op)) {
    if (!META_KEYS.has(k)) errors.push(`Unknown operation field "${k}"`);
  }
  return errors;
}

async function readSheet(sheets, spreadsheetId, sheetName) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:ZZ`,
  });
  const values = resp.data.values || [[]];
  return { headers: values[0] || [], rows: values.slice(1) };
}

async function getSheetIds(sheets, spreadsheetId) {
  const resp = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: false,
  });
  const out = {};
  for (const sheet of resp.data.sheets || []) {
    const p = sheet.properties || {};
    if (p.title) out[p.title] = p.sheetId;
  }
  return out;
}

async function existingIds(sheets, spreadsheetId, cache, sheetName) {
  if (cache.has(sheetName)) return cache.get(sheetName);
  const idField = RECORD_ID[sheetName];
  const { headers, rows } = await readSheet(sheets, spreadsheetId, sheetName);
  const idx = headers.indexOf(idField);
  const ids = new Set();
  if (idx >= 0) {
    for (const row of rows) {
      const id = String(row[idx] ?? '');
      if (id) ids.add(id);
    }
  }
  cache.set(sheetName, ids);
  return ids;
}

async function validateForeignKeys(sheets, spreadsheetId, fkCache, sheetName, rowObj) {
  const errors = [];
  const spec = FOREIGN_KEYS[sheetName] || {};
  for (const [field, targetSheet] of Object.entries(spec)) {
    const value = rowObj[field] === undefined || rowObj[field] === null ? '' : String(rowObj[field]);
    if (!value) continue;
    const ids = await existingIds(sheets, spreadsheetId, fkCache, targetSheet);
    if (!ids.has(value)) errors.push(`${field} references missing ${targetSheet} record "${value}"`);
  }
  return errors;
}

async function preflightOperation(sheets, spreadsheetId, fkCache, op, index, requireExpected) {
  const shapeErrors = validateShape(op, index);
  if (shapeErrors.length) {
    return {
      index,
      valid: false,
      operation: op && op.operation,
      entry_type: op && op.entry_type,
      record_id: op && op.record_id,
      errors: shapeErrors,
    };
  }

  const sheetName = op.entry_type;
  const idField = RECORD_ID[sheetName];
  let table;
  try {
    table = await readSheet(sheets, spreadsheetId, sheetName);
  } catch (err) {
    return {
      index,
      valid: false,
      operation: op.operation,
      entry_type: sheetName,
      record_id: op.record_id,
      errors: [`Could not read ${sheetName}: ${err.message}`],
    };
  }

  const { headers, rows } = table;
  const errors = [];
  const idIdx = headers.indexOf(idField);
  if (idIdx < 0) {
    return {
      index,
      valid: false,
      operation: op.operation,
      entry_type: sheetName,
      record_id: op.record_id,
      errors: [`${sheetName} does not contain stable record ID column ${idField}`],
    };
  }

  const matches = [];
  rows.forEach((row, rowIdx) => {
    if (String(row[idIdx] ?? '') === op.record_id) matches.push({ row, rowIdx });
  });
  if (matches.length === 0) errors.push(`No ${sheetName} row found with ${idField}=${op.record_id}`);
  if (matches.length > 1) errors.push(`Stable ID collision: ${matches.length} ${sheetName} rows use ${idField}=${op.record_id}`);
  if (errors.length) {
    return { index, valid: false, operation: op.operation, entry_type: sheetName, record_id: op.record_id, errors };
  }

  const { row, rowIdx } = matches[0];
  const before = rowToObject(headers, row);

  if (requireExpected) {
    if (!op.expected || typeof op.expected !== 'object' || Array.isArray(op.expected)) {
      errors.push('Apply requires the expected full-row snapshot returned by preview');
    } else if (!sameRow(headers, before, op.expected)) {
      errors.push('Conflict: the live row changed after preview; preview again before applying');
    }
  }

  let after = null;
  if (op.operation !== 'delete') {
    const changeKeys = Object.keys(op.changes || {});
    if (changeKeys.length === 0) errors.push('changes must contain at least one field');
    for (const key of changeKeys) {
      if (!headers.includes(key)) errors.push(`Unknown ${sheetName} column "${key}"`);
      if (key === idField) errors.push(`Stable record ID ${idField} cannot be changed`);
    }

    if (errors.length === 0) {
      after = { ...before };
      for (const [key, value] of Object.entries(op.changes || {})) {
        after[key] = value === undefined || value === null ? '' : String(value);
      }
      errors.push(...await validateForeignKeys(sheets, spreadsheetId, fkCache, sheetName, after));
    }
  }

  const diffs = changedFields(headers, before, after);
  if (op.operation !== 'delete' && diffs.length === 0) errors.push('No data would change');

  return {
    index,
    valid: errors.length === 0,
    operation: op.operation,
    entry_type: sheetName,
    record_id: op.record_id,
    id_field: idField,
    row_index: rowIdx,
    headers,
    before,
    after,
    diffs,
    reason: op.reason || '',
    source_ids: op.source_ids || '',
    errors,
  };
}

async function appendAudit(sheets, spreadsheetId, sessionId, item, phase) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'AUDIT_LOG!A1:Z1',
  });
  const headers = (resp.data.values || [[]])[0] || [];
  if (!headers.length) throw new Error('AUDIT_LOG has no header row');

  const auditData = {
    timestamp:            new Date().toISOString(),
    session_id:           sessionId,
    entries_written:      '0',
    entries_overwritten:  phase === 'APPLIED' && item.operation !== 'delete' ? '1' : '0',
    entries_deleted:      phase === 'APPLIED' && item.operation === 'delete' ? '1' : '0',
    entries_skipped:      '0',
    entry_types_affected: item.entry_type,
    notes: JSON.stringify({
      correction_phase: phase,
      action: item.operation,
      record_id: item.record_id,
      reason: item.reason || '',
      source_ids: item.source_ids || '',
      before: item.before,
      after: item.after,
    }),
  };

  const row = headers.map(h => auditData[h] || '');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'AUDIT_LOG!A:A',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [row] },
  });
}

function cellsFromObject(headers, obj) {
  return headers.map(h => ({
    userEnteredValue: { stringValue: obj[h] === undefined || obj[h] === null ? '' : String(obj[h]) },
  }));
}

function summarize(items) {
  return {
    total: items.length,
    valid: items.filter(x => x.valid).length,
    invalid: items.filter(x => !x.valid).length,
    updates: items.filter(x => x.valid && x.operation === 'update').length,
    reassignments: items.filter(x => x.valid && x.operation === 'reassign').length,
    deletes: items.filter(x => x.valid && x.operation === 'delete').length,
  };
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed — use POST' }, 405);

  const spreadsheetId = Netlify.env.get('GOOGLE_SHEETS_ID');
  const serviceAccountEmail = Netlify.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const adminPassword = Netlify.env.get('ADMIN_PASSWORD');
  const rawPrivateKey = Netlify.env.get('GOOGLE_PRIVATE_KEY') || '';
  const privateKey = rawPrivateKey.includes('\\n') ? rawPrivateKey.replace(/\\n/g, '\n') : rawPrivateKey;

  const suppliedPassword = req.headers.get('x-admin-password') || '';
  if (!adminPassword || suppliedPassword !== adminPassword) return json({ error: 'Unauthorized' }, 401);
  if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
    return json({ error: 'Google Sheets environment is not fully configured' }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return json({ error: `Invalid JSON: ${err.message}` }, 400);
  }

  const mode = body.mode || 'preview';
  if (!['preview', 'apply'].includes(mode)) return json({ error: 'mode must be preview or apply' }, 400);
  if (!Array.isArray(body.operations) || body.operations.length === 0) {
    return json({ error: 'operations must be a non-empty array' }, 400);
  }
  if (body.operations.length > 100) return json({ error: 'Maximum 100 correction operations per request' }, 400);

  const duplicateTargets = new Map();
  body.operations.forEach((op, i) => {
    if (!op || !op.entry_type || !op.record_id) return;
    const key = `${op.entry_type}\x00${op.record_id}`;
    if (duplicateTargets.has(key)) {
      duplicateTargets.set(key, [...duplicateTargets.get(key), i]);
    } else {
      duplicateTargets.set(key, [i]);
    }
  });
  const duplicateIndexes = new Set(
    [...duplicateTargets.values()].filter(indexes => indexes.length > 1).flat(),
  );

  const sheets = buildSheetsClient(serviceAccountEmail, privateKey);
  const fkCache = new Map();
  const items = [];
  for (let i = 0; i < body.operations.length; i++) {
    const item = await preflightOperation(sheets, spreadsheetId, fkCache, body.operations[i], i, mode === 'apply');
    if (duplicateIndexes.has(i)) {
      item.valid = false;
      item.errors = [...(item.errors || []), 'A correction batch may target each stable record ID only once'];
    }
    items.push(item);
  }

  const summary = summarize(items);
  if (mode === 'preview') return json({ mode, summary, items });

  if (summary.invalid > 0) {
    return json({
      mode,
      error: 'Preflight failed. No changes were applied.',
      summary,
      items,
    }, 409);
  }

  const sessionId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    for (const item of items) {
      await appendAudit(sheets, spreadsheetId, sessionId, item, 'PREPARED');
    }
  } catch (err) {
    return json({
      mode,
      sessionId,
      error: `Could not preserve correction baseline in AUDIT_LOG: ${err.message}. No target rows were changed.`,
      applied: [],
    }, 500);
  }

  const recheckCache = new Map();
  const freshItems = [];
  for (let i = 0; i < body.operations.length; i++) {
    freshItems.push(await preflightOperation(
      sheets,
      spreadsheetId,
      recheckCache,
      body.operations[i],
      i,
      true,
    ));
  }
  const freshSummary = summarize(freshItems);
  if (freshSummary.invalid > 0) {
    return json({
      mode,
      sessionId,
      error: 'A target row changed during apply preparation. No target rows were changed; preview again.',
      summary: freshSummary,
      items: freshItems,
      applied: [],
    }, 409);
  }

  let ids;
  try {
    ids = await getSheetIds(sheets, spreadsheetId);
  } catch (err) {
    return json({ mode, sessionId, error: `Could not resolve Google sheet IDs: ${err.message}`, applied: [] }, 500);
  }

  const requests = [];

  for (const item of freshItems.filter(x => x.operation !== 'delete')) {
    const sheetId = ids[item.entry_type];
    if (sheetId === undefined) return json({ mode, sessionId, error: `Could not resolve sheetId for ${item.entry_type}`, applied: [] }, 500);
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: item.row_index + 1,
          endRowIndex: item.row_index + 2,
          startColumnIndex: 0,
          endColumnIndex: item.headers.length,
        },
        rows: [{ values: cellsFromObject(item.headers, item.after) }],
        fields: 'userEnteredValue',
      },
    });
  }

  const deletes = freshItems
    .filter(x => x.operation === 'delete')
    .sort((a, b) => a.entry_type === b.entry_type
      ? b.row_index - a.row_index
      : a.entry_type.localeCompare(b.entry_type));

  for (const item of deletes) {
    const sheetId = ids[item.entry_type];
    if (sheetId === undefined) return json({ mode, sessionId, error: `Could not resolve sheetId for ${item.entry_type}`, applied: [] }, 500);
    requests.push({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: item.row_index + 1,
          endIndex: item.row_index + 2,
        },
      },
    });
  }

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests },
    });
  } catch (err) {
    return json({
      mode,
      sessionId,
      error: `Atomic correction batch failed: ${err.message}. No target rows were changed by this batch.`,
      applied: [],
    }, 500);
  }

  const warnings = [];
  for (const item of freshItems) {
    try {
      await appendAudit(sheets, spreadsheetId, sessionId, item, 'APPLIED');
    } catch (err) {
      warnings.push(`APPLIED audit marker failed for ${item.entry_type}/${item.record_id}: ${err.message}`);
    }
  }

  return json({
    mode,
    sessionId,
    summary: freshSummary,
    applied: freshItems.map(item => ({
      operation: item.operation,
      entry_type: item.entry_type,
      record_id: item.record_id,
    })),
    warnings,
  });
};
