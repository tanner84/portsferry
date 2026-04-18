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
  'WEATHER', 'COUNTIES',
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
  IND_IND:             'edge_id',   // record-level key; enables targeted overwrite by edge_id
  EVT_LINKS:           ['evt_id', 'linked_id'],
  WEATHER:             'weather_id',
  COUNTIES:            'county_id',
};

// Sheets that use a composite duplicate key but also have a separate
// record-ID field that should be auto-generated when not supplied.
const AUTO_ID = {
  IND_CHURCH:   { field: 'link_id',  prefix: 'ich_'  },
  IND_UNIT:     { field: 'link_id',  prefix: 'iu_'   },
  IND_PROPERTY: { field: 'link_id',  prefix: 'ip_'   },
  IND_IND:      { field: 'edge_id',  prefix: 'iind_' },
  EVT_LINKS:    { field: 'link_id',  prefix: 'el_'   },
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

/* Convert 1-based column count to A1 letter notation (A, B, …, Z, AA, …) */
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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
  const results = { written: [], overwritten: [], skipped: [], errors: [] };
  const entryTypesAffected = new Set();

  // Group entries by sheet; strip meta-keys (entry_type, overwrite) from data payload
  const bySheet = {};
  for (const entry of entries) {
    const { entry_type, overwrite: isOverwrite, ...data } = entry;
    if (!VALID_SHEET_NAMES.includes(entry_type)) {
      results.errors.push({
        entry_type: entry_type || '(missing)',
        error: `Unknown sheet: "${entry_type}". Valid sheets: ${VALID_SHEET_NAMES.join(', ')}`,
      });
      continue;
    }
    (bySheet[entry_type] = bySheet[entry_type] || []).push({ data, isOverwrite: !!isOverwrite });
  }

  // Process each sheet
  for (const [sheetName, rows] of Object.entries(bySheet)) {
    try {
      // 1. Read existing headers + data
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:ZZ`,
      });
      const allValues    = resp.data.values || [[]];
      const headers      = allValues[0] || [];
      const existingRows = allValues.slice(1);

      // 2. Build key → row-index map for both duplicate detection and overwrite lookup
      const idField = PRIMARY_ID[sheetName];
      const keyToRowIdx = new Map();
      existingRows.forEach((row, idx) => {
        const k = keyFromRow(idField, headers, row);
        if (k) keyToRowIdx.set(k, idx);
      });
      const existingKeys = new Set(keyToRowIdx.keys());

      // 3. Auto-ID setup for junction tables
      const autoId = AUTO_ID[sheetName];
      let nextAutoNum = existingRows.length + 1; // base on total row count so IDs never collide

      // 4. Classify entries: toAppend (new), toUpdate (overwrite), toSkip (dup)
      const toAppend = [];
      const toUpdate = [];

      for (const { data: rowData, isOverwrite } of rows) {
        const key = keyFromData(idField, rowData);
        const exists = key && existingKeys.has(key);

        if (exists && isOverwrite) {
          // Overwrite: find existing row, build partial-merge, queue for update
          const rowIdx = keyToRowIdx.get(key);
          toUpdate.push({ key, rowData, rowIdx });
        } else if (exists) {
          results.skipped.push({ sheet: sheetName, id: key, reason: 'duplicate' });
        } else {
          // New entry — auto-generate record ID if needed
          let finalData = rowData;
          if (autoId && !rowData[autoId.field]) {
            finalData = {
              ...rowData,
              [autoId.field]: `${autoId.prefix}${String(nextAutoNum).padStart(3, '0')}`,
            };
            nextAutoNum++;
          }
          // Map to header column order — unknown columns are silently dropped
          const rowArr = headers.map(h => {
            const v = finalData[h];
            return v === undefined || v === null ? '' : String(v);
          });

          // Visibility log for SOURCES — shows exact column order in Netlify logs
          if (sheetName === 'SOURCES') {
            console.log('[sheets-write] SOURCES headers:', JSON.stringify(headers));
            console.log('[sheets-write] SOURCES row:    ', JSON.stringify(rowArr));
          }

          toAppend.push({ key, rowArr });
        }
      }

      // 5. Append new rows
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

      // 6. Partial-update overwrite rows (only fields present in incoming JSON)
      for (const { key, rowData, rowIdx } of toUpdate) {
        try {
          // Sheet row number: row 1 = headers, first data row = 2
          const sheetRowNum = rowIdx + 2;

          // Merge: start with the existing row, overwrite only fields present in rowData
          const existingArr = existingRows[rowIdx] || [];
          const mergedRow = headers.map((h, colIdx) => {
            if (rowData[h] !== undefined && rowData[h] !== null) {
              return String(rowData[h]);
            }
            return existingArr[colIdx] !== undefined ? String(existingArr[colIdx]) : '';
          });

          const endCol = colLetter(headers.length);
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A${sheetRowNum}:${endCol}${sheetRowNum}`,
            valueInputOption: 'RAW',
            resource: { values: [mergedRow] },
          });

          results.overwritten.push({ sheet: sheetName, id: key });
          entryTypesAffected.add(sheetName);
        } catch (updateErr) {
          results.errors.push({ sheet: sheetName, error: `overwrite ${key}: ${updateErr.message}` });
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
      entries_overwritten:  String(results.overwritten.length),
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
