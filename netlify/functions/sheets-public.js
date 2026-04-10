/**
 * sheets-public.js — Netlify Function
 * Returns full contents of a Google Sheet as JSON for the public site.
 *
 * GET /.netlify/functions/sheets-public?sheet=SHEET_NAME
 *
 * No authentication required — public data only.
 * Uses the service account credentials already configured for sheets-read.js.
 */

const { google } = require('googleapis');

/* ── Environment ────────────────────────────────────────────────── */
const SPREADSHEET_ID        = process.env.GOOGLE_SHEETS_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

function getPrivateKey() {
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

const VALID_SHEETS = [
  'INDIVIDUALS', 'CHURCHES', 'PROPERTIES', 'UNITS', 'EVENTS',
  'SOURCES', 'BATTLES', 'UNIT_POSITIONS', 'BATTLE_PARTICIPANTS',
  'IND_CHURCH', 'IND_UNIT', 'IND_PROPERTY', 'IND_IND', 'EVT_LINKS',
  'WEATHER',
];

/* ── CORS ───────────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/* ── Handler ────────────────────────────────────────────────────── */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed — use GET' });
  }

  const sheet = event.queryStringParameters?.sheet;
  if (!sheet || !VALID_SHEETS.includes(sheet)) {
    return json(400, {
      error: 'Invalid or missing sheet parameter.',
      valid: VALID_SHEETS,
    });
  }

  const auth = new google.auth.JWT(
    SERVICE_ACCOUNT_EMAIL,
    null,
    getPrivateKey(),
    ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  );
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheet}!A:ZZ`,
    });
    const values  = resp.data.values || [[]];
    const headers = values[0] || [];
    const rows    = values.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });
    return json(200, { sheet, rows, count: rows.length });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
