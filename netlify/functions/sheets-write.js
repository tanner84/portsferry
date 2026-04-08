/**
 * sheets-write.js — Netlify Function
 * Appends validated entries to the correct Google Sheets tab.
 *
 * POST /.netlify/functions/sheets-write
 * Headers: x-admin-password: <ADMIN_PASSWORD>
 * Body:    JSON array of entry objects, each with an entry_type field.
 *
 * Guarantees:
 *   - Reads sheet headers before writing — column order always matches sheet
 *   - Checks existing rows for duplicate primary IDs before appending
 *   - Never overwrites an existing row
 *   - Writes every operation to AUDIT_LOG
 */

const { google } = require('googleapis');

/* ── Environment ────────────────────────────────────────────────── */
const SPREADSHEET_ID        = process.env.GOOGLE_SHEETS_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const ADMIN_PASSWORD        = process.env.ADMIN_PASSWORD;

function getPrivateKey() {
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  // Netlify stores newlines as literal \n in some configurations
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

/* ── Sheet registry ─────────────────────────────────────────────── */
const VALID_SHEET_NAMES = [
  'INDIVIDUALS', 'CHURCHES', 'PROPERTIES', 'UNITS', 'EVENTS',
  'SOURCES', 'BATTLES', 'UNIT_POSITIONS', 'BATTLE_PARTICIPANTS',
  'IND_CHURCH', 'IND_UNIT', 'IND_PROPERTY', 'IND_IND', 'EVT_LINKS',
];

// Primary ID field(s) per sheet — array means composite key
const PRIMARY_ID = {
  INDIVIDUALS:         'ind_id',
  CHURCHES:            'ch_id',
  PROPERTIES:          'prop_id',
  UNITS:               'unit_id',
  EVENTS:              'evt_id',
  SOURCES:             'src_id',
  BATTLES:             'battle_id',
  UNIT_POSITIONS:      'pos_id',
  BATTLE_PARTICIPANTS: 'bp_id',
  IND_CHURCH:          ['ind_id', 'ch_id', 'date_from'],
  IND_UNIT:            ['ind_id', 'unit_id', 'date_from'],
  IND_PROPERTY:        ['ind_id', 'prop_id', 'date_from'],
  IND_IND:             ['ind_id_a', 'ind_id_b', 'relationship'],
  EVT_LINKS:           ['evt_id', 'linked_id'],
};

/* ── Key helpers ────────────────────────────────────────────────── */
// Null byte as separator — safe for any realistic field value
const SEP = '\x00';

function keyFromData(fields, rowData) {
  if (Array.isArray(fields)) {
    return fields.map(f => String(rowData[f] ?? '')).join(SEP);
  }
  return String(rowData[fields] ?? '');
}

function keyFromRow(fields, headers, row) {
  if (Array.isArray(fields)) {
    return fields.map(f => {
      const i = headers.indexOf(f);
      return i >= 0 ? String(row[i] ?? '') : '';
    }).join(SEP);
  }
  const i = headers.indexOf(fields);
  return i >= 0 ? String(row[i] ?? '') : '';
}

/* ── Auth factory ───────────────────────────────────────────────── */
function buildSheetsClient() {
  const auth = new google.auth.JWT(
    SERVICE_ACCOUNT_EMAIL,
    null,
    getPrivateKey(),
    ['https://www.googleapis.com/auth/spreadsheets'],
  );
  return google.sheets({ version: 'v4', auth });
}

/* ── CORS headers ───────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
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

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed — use POST' });
  }

  // Parse body
  let entries;
  try {
    entries = JSON.parse(event.body);
    if (!Array.isArray(entries)) throw new Error('Body must be a JSON array');
  } catch (e) {
    return json(400, { error: `Invalid JSON: ${e.message}` });
  }

  const sheets = buildSheetsClient();
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const results = { written: [], skipped: [], errors: [] };
  const entryTypesAffected = new Set();

  // Group entries by sheet
  const bySheet = {};
  for (const entry of entries) {
    const { entry_type, ...data } = entry;
    if (!VALID_SHEET_NAMES.includes(entry_type)) {
      results.errors.push({
        entry_type: entry_type || '(missing)',
        error: `Unknown sheet: "${entry_type}". Valid sheets: ${VALID_SHEET_NAMES.join(', ')}`,
      });
      continue;
    }
    (bySheet[entry_type] = bySheet[entry_type] || []).push(data);
  }

  // Process each sheet
  for (const [sheetName, rows] of Object.entries(bySheet)) {
    try {
      // 1. Read existing headers + data
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:ZZ`,
      });
      const allValues  = resp.data.values || [[]];
      const headers    = allValues[0] || [];
      const existingRows = allValues.slice(1);

      // 2. Build existing-key set for duplicate detection
      const idField = PRIMARY_ID[sheetName];
      const existingKeys = new Set(
        existingRows.map(row => keyFromRow(idField, headers, row))
      );

      // 3. Separate new from duplicate
      const toAppend = [];
      for (const rowData of rows) {
        const key = keyFromData(idField, rowData);
        if (key && existingKeys.has(key)) {
          results.skipped.push({ sheet: sheetName, id: key, reason: 'duplicate' });
        } else {
          // Map to header column order — unknown columns are silently dropped
          const rowArr = headers.map(h => {
            const v = rowData[h];
            return v === undefined || v === null ? '' : String(v);
          });
          toAppend.push({ key, rowArr });
        }
      }

      // 4. Append new rows
      if (toAppend.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheetName}!A:A`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: toAppend.map(r => r.rowArr) },
        });
        for (const { key } of toAppend) {
          results.written.push({ sheet: sheetName, id: key });
          entryTypesAffected.add(sheetName);
        }
      }
    } catch (err) {
      results.errors.push({ sheet: sheetName, error: err.message });
    }
  }

  // 5. Write AUDIT_LOG (failure here must not block the response)
  try {
    const AUDIT_COLS = [
      'timestamp', 'session_id', 'entries_written',
      'entries_skipped', 'entry_types_affected', 'notes',
    ];
    const auditData = {
      timestamp:            new Date().toISOString(),
      session_id:           sessionId,
      entries_written:      String(results.written.length),
      entries_skipped:      String(results.skipped.length),
      entry_types_affected: [...entryTypesAffected].join(', '),
      notes:                results.errors.length > 0
                              ? `Errors: ${results.errors.map(e => e.error).join('; ')}`
                              : '',
    };

    // Read AUDIT_LOG headers to preserve column order
    let auditCols = AUDIT_COLS;
    try {
      const ar = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'AUDIT_LOG!A1:Z1',
      });
      const h = (ar.data.values || [[]])[0];
      if (h.length > 0) auditCols = h;
    } catch (_) { /* fall back to default column order */ }

    const auditRow = auditCols.map(h => auditData[h] || '');
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'AUDIT_LOG!A:A',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [auditRow] },
    });
  } catch (err) {
    console.error('[sheets-write] AUDIT_LOG write failed:', err.message);
  }

  return json(200, { sessionId, ...results });
};
