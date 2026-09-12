/**
 * sheets-correct.js — safe record correction / reassignment / deletion API
 *
 * POST /.netlify/functions/sheets-correct
 * Headers: x-admin-password: <ADMIN_PASSWORD>
 * Body:
 *   {
 *     "mode": "preview" | "apply",
 *     "operations": [
 *       {
 *         "operation": "update" | "reassign" | "delete",
 *         "entry_type": "IND_CHURCH",
 *         "record_id": "ich_040",
 *         "changes": { "ind_id": "ind_112" },
 *         "reason": "...",
 *         "source_ids": "SRC_...",
 *         "expected": { ...full row returned by preview... } // required for apply
 *       }
 *     ]
 *   }
 *
 * Design goals:
 *   - identify rows by a stable record ID, never by fields that may change
 *   - reject unknown fields instead of silently discarding them
 *   - verify referenced people/churches/units/properties exist
 *   - preview exact before -> after values before any write
 *   - reject apply if the live row changed since preview
 *   - preserve full before/after state and reason in AUDIT_LOG
 */

'use strict';

const { google } = require('googleapis');

const SPREADSHEET_ID        = process.env.GOOGLE_SHEETS_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const ADMIN_PASSWORD        = process.env.ADMIN_PASSWORD;

function getPrivateKey() {
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

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
  UNIT_POSITIONS: {
    battle_id: 'BATTLES',
    unit_id:   'UNITS',
  },
  BATTLE_PARTICIPANTS: {
    battle_id: 'BATTLES',
    unit_id:   'UNITS',
  },
  EVT_LINKS: {
    evt_id: 'EVENTS',
  },
};

const ALLOWED_OPS = new Set(['update', 'reassign', 'delete']);
const META_KEYS = new Set([
  'operation', 'entry_type', 'record_id', 'changes', 'reason', 'source_ids', 'expected',
]);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function buildSheetsClient() {
  const auth = new google.auth.JWT(
    SERVICE_ACCOUNT_EMAIL,
    null,
    getPrivateKey(),
    ['https://www.googleapis.com/auth/spreadsheets'],
  );
  return google.sheets({ version: 'v4', auth });
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] === undefined ? '' : String(row[i]); });
  return obj;
}

function objectToRow(headers, obj) {
  return headers.map(h => {
    const v = obj[h];
    return v === undefined || v === null ? '' : String(v);
  });
}

function normalizeObject(headers, obj) {
  const out = {};
  headers.forEach(h => { out[h] = obj && obj[h] !== undefined && obj[h] !== null ? String(obj[h]) : ''; });
  return out;
}

function sameRow(headers, a, b) {
  const na = normalizeObject(headers, a);
  const nb = normalizeObject(headers, b);
  return headers.every(h => na[h] === nb[h]);
}

function changedFields(headers, before, after) {
  if (!after) return headers.map(field => ({ field, before: before[field] || '', after: null }));
  const diffs = [];
  for (const h of headers) {
    const b = before[h] === undefined || before[h] === null ? '' : String(before[h]);
    const a = after[h]  === undefined || after[h]  === null ? '' : String(after[h]);
    if (a !== b) diffs.push({ field: h, before: b, after: a });
  }
  return diffs;
}

async function readSheet(sheets, sheetName) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:ZZ`,
  });
  const values = resp.data.values || [[]];
  return {
    headers: values[0] || [],
    rows: values.slice(1),
  };
}

async function sheetIdMap(sheets) {
  const resp = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    includeGridData: false,
  });
  const out = {};
  for (const s of resp.data.sheets || []) {
    if (s.properties && s.properties.title) out[s.properties.title] = s.properties.sheetId;
  }
  return out;
}

async function existingIds(sheets, cache, sheetName) {
  if (cache.has(sheetName)) return cache.get(sheetName);
  const idField = RECORD_ID[sheetName];
  if (!idField) return new Set();
  const { headers, rows } = await readSheet(sheets, sheetName);
  const idx = headers.indexOf(idField);
  const ids = new Set();
  if (idx >= 0) {
    for (const row of rows) {
      const id = row[idx] === undefined ? '' : String(row[idx]);
      if (id) ids.add(id);
    }
  }
  cache.set(sheetName, ids);
  return ids;
}

async function validateForeignKeys(sheets, fkCache, sheetName, rowObj) {
  const errors = [];
  const spec = FOREIGN_KEYS[sheetName] || {};
  for (const [field, targetSheet] of Object.entries(spec)) {
    const value = rowObj[field] === undefined || rowObj[field] === null ? '' : String(rowObj[field]);
    if (!value) continue;
    const ids = await existingIds(sheets, fkCache, targetSheet);
    if (!ids.has(value)) {
      errors.push(`${field} references missing ${targetSheet} record "${value}"`);
    }
  }
  return errors;
}

function validateShape(op, index) {
  const errors = [];
  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    return [`Operation ${index + 1} must be an object`];
  }
  if (!ALLOWED_OPS.has(op.operation)) errors.push(`Unknown operation "${op.operation || ''}"`);
  if (!RECORD_ID[op.entry_type]) errors.push(`Unknown or unsupported entry_type "${op.entry_type || ''}"`);
  if (!op.record_id || typeof op.record_id !== 'string') errors.push('record_id is required');
  if ((op.operation === 'update' || op.operation === 'reassign') && (!op.changes || typeof op.changes !== 'object' || Array.isArray(op.changes))) {
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

async function preflightOperation(sheets, fkCache, op, index, requireExpected) {
  const shapeErrors = validateShape(op, index);
  if (shapeErrors.length) {
    return { index, valid: false, errors: shapeErrors, operation: op && op.operation, entry_type: op && op.entry_type, record_id: op && op.record_id };
  }

  const sheetName = op.entry_type;
  const idField = RECORD_ID[sheetName];
  let table;
  try {
    table = await readSheet(sheets, sheetName);
  } catch (err) {
    return { index, valid: false, operation: op.operation, entry_type: sheetName, record_id: op.record_id, errors: [`Could not read ${sheetName}: ${err.message}`] };
  }

  const { headers, rows } = table;
  const errors = [];
  const idIdx = headers.indexOf(idField);
  if (idIdx < 0) {
    errors.push(`${sheetName} does not contain stable record ID column ${idField}`);
    return { index, valid: false, operation: op.operation, entry_type: sheetName, record_id: op.record_id, errors };
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
      const fkErrors = await validateForeignKeys(sheets, fkCache, sheetName, after);
      errors.push(...fkErrors);
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

async function appendAudit(sheets, sessionId, item) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'AUDIT_LOG!A1:Z1',
    });
    const headers = (resp.data.values || [[]])[0] || [];
    if (!headers.length) return { ok: false, error: 'AUDIT_LOG has no header row' };

    const auditData = {
      timestamp:            new Date().toISOString(),
      session_id:           sessionId,
      entries_written:      '0',
      entries_overwritten:  item.operation === 'delete' ? '0' : '1',
      entries_deleted:      item.operation === 'delete' ? '1' : '0',
      entries_skipped:      '0',
      entry_types_affected: item.entry_type,
      notes: JSON.stringify({
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
      spreadsheetId: SPREADSHEET_ID,
      range: 'AUDIT_LOG!A:A',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [row] },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const pw = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) return json(401, { error: 'Unauthorized' });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed — use POST' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: `Invalid JSON: ${err.message}` });
  }

  const mode = body.mode || 'preview';
  if (!['preview', 'apply'].includes(mode)) return json(400, { error: 'mode must be preview or apply' });
  if (!Array.isArray(body.operations) || body.operations.length === 0) {
    return json(400, { error: 'operations must be a non-empty array' });
  }
  if (body.operations.length > 100) return json(400, { error: 'Maximum 100 correction operations per request' });

  const duplicateTargets = new Set();
  const duplicateErrors = new Map();
  body.operations.forEach((op, i) => {
    const key = op && `${op.entry_type || ''}\x00${op.record_id || ''}`;
    if (!key) return;
    if (duplicateTargets.has(key)) duplicateErrors.set(i, 'A correction batch may target each stable record ID only once');
    duplicateTargets.add(key);
  });

  const sheets = buildSheetsClient();
  const fkCache = new Map();
  const items = [];

  for (let i = 0; i < body.operations.length; i++) {
    const item = await preflightOperation(sheets, fkCache, body.operations[i], i, mode === 'apply');
    if (duplicateErrors.has(i)) {
      item.valid = false;
      item.errors = [...(item.errors || []), duplicateErrors.get(i)];
    }
    items.push(item);
  }

  const summary = {
    total: items.length,
    valid: items.filter(x => x.valid).length,
    invalid: items.filter(x => !x.valid).length,
    updates: items.filter(x => x.valid && x.operation === 'update').length,
    reassignments: items.filter(x => x.valid && x.operation === 'reassign').length,
    deletes: items.filter(x => x.valid && x.operation === 'delete').length,
  };

  if (mode === 'preview') {
    return json(200, { mode, summary, items });
  }

  if (summary.invalid > 0) {
    return json(409, {
      mode,
      error: 'Preflight failed. No changes were applied.',
      summary,
      items,
    });
  }

  const sessionId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const applied = [];
  const warnings = [];

  // Apply updates/reassignments first. Their row indexes are stable until deletions begin.
  for (const item of items.filter(x => x.operation !== 'delete')) {
    try {
      const rowNum = item.row_index + 2;
      const endCol = colLetter(item.headers.length);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${item.entry_type}!A${rowNum}:${endCol}${rowNum}`,
        valueInputOption: 'RAW',
        resource: { values: [objectToRow(item.headers, item.after)] },
      });
      applied.push({ operation: item.operation, entry_type: item.entry_type, record_id: item.record_id });
      const audit = await appendAudit(sheets, sessionId, item);
      if (!audit.ok) warnings.push(`Audit log failed for ${item.entry_type}/${item.record_id}: ${audit.error}`);
    } catch (err) {
      return json(500, {
        mode,
        sessionId,
        error: `Apply failed at ${item.entry_type}/${item.record_id}: ${err.message}`,
        partial: applied.length > 0,
        applied,
        warnings,
      });
    }
  }

  // Delete bottom-up within each sheet so deleting one row cannot shift a later target.
  const ids = await sheetIdMap(sheets);
  const deletes = items
    .filter(x => x.operation === 'delete')
    .sort((a, b) => a.entry_type === b.entry_type
      ? b.row_index - a.row_index
      : a.entry_type.localeCompare(b.entry_type));

  for (const item of deletes) {
    try {
      const sheetId = ids[item.entry_type];
      if (sheetId === undefined) throw new Error(`Could not resolve sheetId for ${item.entry_type}`);
      const startIndex = item.row_index + 1; // grid index 0 is header row; data row 0 starts at grid row 1
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex,
                endIndex: startIndex + 1,
              },
            },
          }],
        },
      });
      applied.push({ operation: item.operation, entry_type: item.entry_type, record_id: item.record_id });
      const audit = await appendAudit(sheets, sessionId, item);
      if (!audit.ok) warnings.push(`Audit log failed for ${item.entry_type}/${item.record_id}: ${audit.error}`);
    } catch (err) {
      return json(500, {
        mode,
        sessionId,
        error: `Delete failed at ${item.entry_type}/${item.record_id}: ${err.message}`,
        partial: applied.length > 0,
        applied,
        warnings,
      });
    }
  }

  return json(200, {
    mode,
    sessionId,
    summary,
    applied,
    warnings,
  });
};
