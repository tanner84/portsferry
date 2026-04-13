/**
 * sheets-read.js — Netlify Function
 * Returns full contents of a Google Sheet as JSON.
 *
 * GET /.netlify/functions/sheets-read?sheet=SHEET_NAME
 * Headers: x-admin-password: <ADMIN_PASSWORD>
 *
 * Read-only. Used by the Verify and Audit Log tabs.
 */

const { google } = require('googleapis');

/* ── Environment ────────────────────────────────────────────────── */
const SPREADSHEET_ID        = process.env.GOOGLE_SHEETS_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const ADMIN_PASSWORD        = process.env.ADMIN_PASSWORD;

function getPrivateKey() {
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

const VALID_SHEETS = [
  'INDIVIDUALS', 'CHURCHES', 'PROPERTIES', 'UNITS', 'EVENTS',
  'SOURCES', 'BATTLES', 'UNIT_POSITIONS', 'BATTLE_PARTICIPANTS',
  'IND_CHURCH', 'IND_UNIT', 'IND_PROPERTY', 'IND_IND', 'EVT_LINKS', 'WEATHER', 'COUNTIES', 'AUDIT_LOG',
];

/* ── CORS ───────────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
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

  // Auth
  const pw = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return json(401, { error: 'Unauthorized' });
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed — use GET' });
  }

  const sheet = event.queryStringParameters?.sheet;
  if (!sheet || !VALID_SHEETS.includes(sheet)) {
    return json(400, {
      error: `Invalid or missing sheet parameter.`,
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
    return json(200, { sheet, headers, rows, count: rows.length });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
