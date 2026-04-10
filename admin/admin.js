/**
 * admin.js — Port's Ferry Research Admin Panel
 *
 * Three tabs: Ingest, Verify, Audit Log.
 * All API calls go through Netlify Functions at /.netlify/functions/.
 * Password stored in sessionStorage — never in code.
 */

'use strict';

const API_WRITE = '/.netlify/functions/sheets-write';
const API_READ  = '/.netlify/functions/sheets-read';

const VALID_SHEETS = [
  'INDIVIDUALS', 'CHURCHES', 'PROPERTIES', 'UNITS', 'EVENTS',
  'SOURCES', 'BATTLES', 'UNIT_POSITIONS', 'BATTLE_PARTICIPANTS',
  'IND_CHURCH', 'IND_UNIT', 'IND_PROPERTY', 'IND_IND', 'EVT_LINKS',
  'WEATHER',
];

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
  WEATHER:             'weather_id',
};

/* ── Session auth ──────────────────────────────────────── */
function getPassword()     { return sessionStorage.getItem('pf_admin_pw'); }
function savePassword(pw)  { sessionStorage.setItem('pf_admin_pw', pw); }
function clearPassword()   { sessionStorage.removeItem('pf_admin_pw'); }

function authHeaders() {
  return { 'x-admin-password': getPassword(), 'Content-Type': 'application/json' };
}

async function checkAuth(pw) {
  try {
    const r = await fetch(`${API_READ}?sheet=AUDIT_LOG`, {
      headers: { 'x-admin-password': pw },
    });
    return r.status === 200;
  } catch { return false; }
}

/* ── Validate entry structure ──────────────────────────── */
function validateEntry(entry, index) {
  const errors = [];
  if (!entry.entry_type) {
    errors.push('Missing entry_type');
  } else if (!VALID_SHEETS.includes(entry.entry_type)) {
    errors.push(`Unknown entry_type: "${entry.entry_type}"`);
  } else {
    const idField = PRIMARY_ID[entry.entry_type];
    if (Array.isArray(idField)) {
      const missing = idField.filter(f => !entry[f]);
      if (missing.length) errors.push(`Missing composite key field(s): ${missing.join(', ')}`);
    } else {
      if (!entry[idField]) errors.push(`Missing primary ID field: ${idField}`);
    }
  }
  return errors;
}

function getPrimaryKeyValue(entry) {
  const idField = PRIMARY_ID[entry.entry_type];
  if (!idField) return '';
  if (Array.isArray(idField)) return idField.map(f => entry[f] || '').join(' · ');
  return entry[idField] || '';
}

/* ── Sheet cache for duplicate pre-check ───────────────── */
const _sheetCache = {};

async function fetchSheetKeys(sheetName) {
  if (_sheetCache[sheetName]) return _sheetCache[sheetName];
  const r = await fetch(`${API_READ}?sheet=${sheetName}`, { headers: authHeaders() });
  if (!r.ok) return new Set();
  const data = await r.json();
  const idField = PRIMARY_ID[sheetName];
  const keys = new Set(data.rows.map(row => {
    if (Array.isArray(idField)) return idField.map(f => row[f] || '').join('\x00');
    return row[idField] || '';
  }));
  _sheetCache[sheetName] = keys;
  return keys;
}

/* ── Escape HTML ───────────────────────────────────────── */
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── DOM shortcuts ─────────────────────────────────────── */
const $  = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls)  e.className   = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/* ════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  /* Auth check on load */
  const saved = getPassword();
  if (saved && await checkAuth(saved)) {
    showPanel();
  } else {
    clearPassword();
    showAuth();
  }

  /* Auth form submit */
  $('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('auth-password').value.trim();
    if (!pw) return;
    $('auth-submit').textContent = 'Checking…';
    $('auth-error').textContent  = '';
    const ok = await checkAuth(pw);
    if (ok) {
      savePassword(pw);
      showPanel();
    } else {
      $('auth-error').textContent = 'Incorrect password.';
      $('auth-submit').textContent = 'Enter';
    }
  });

  /* Logout */
  $('admin-logout').addEventListener('click', () => {
    clearPassword();
    location.reload();
  });

  /* Tab switching */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* Ingest tab */
  $('validate-btn').addEventListener('click', runValidation);
  $('clear-btn').addEventListener('click', clearIngest);
  $('push-btn').addEventListener('click', runPush);

  /* Verify tab */
  $('verify-load-btn').addEventListener('click', loadVerifySheet);
  $('verify-search').addEventListener('input', filterVerifyTable);

  /* Audit tab */
  $('audit-refresh-btn').addEventListener('click', loadAuditLog);
});

/* ── Show/hide screens ─────────────────────────────────── */
function showAuth() {
  $('auth-screen').classList.remove('hidden');
  $('admin-panel').classList.add('hidden');
  setTimeout(() => $('auth-password').focus(), 50);
}

function showPanel() {
  $('auth-screen').classList.add('hidden');
  $('admin-panel').classList.remove('hidden');
}

/* ── Tab switching ─────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${name}`));
}

/* ════════════════════════════════════════════════════════
   INGEST — VALIDATE
════════════════════════════════════════════════════════ */
let _parsedEntries  = [];
let _validatedRows  = [];  // { entry, status:'new'|'dup'|'invalid', errors }

async function runValidation() {
  const raw = $('ingest-textarea').value.trim();
  if (!raw) { $('validate-status').textContent = 'Nothing to validate.'; return; }

  $('validate-status').innerHTML = '<span class="spinner"></span>Validating…';
  $('preview-panel').classList.add('hidden');
  $('push-btn').disabled = true;
  _validatedRows = [];

  let entries;
  try {
    entries = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error('Expected a JSON array');
  } catch (e) {
    $('validate-status').textContent = `JSON error: ${e.message}`;
    return;
  }
  _parsedEntries = entries;

  // Validate structure
  const withValidation = entries.map((entry, i) => ({
    entry,
    structErrors: validateEntry(entry, i),
  }));

  // For structurally valid entries, check duplicates against live sheet data
  const sheetsToCheck = [...new Set(
    withValidation.filter(r => r.structErrors.length === 0).map(r => r.entry.entry_type)
  )];

  const keyCache = {};
  await Promise.all(sheetsToCheck.map(async sheet => {
    keyCache[sheet] = await fetchSheetKeys(sheet);
  }));

  _validatedRows = withValidation.map(({ entry, structErrors }) => {
    if (structErrors.length > 0) return { entry, status: 'invalid', errors: structErrors };

    const idField = PRIMARY_ID[entry.entry_type];
    const key = Array.isArray(idField)
      ? idField.map(f => entry[f] || '').join('\x00')
      : (entry[idField] || '');
    const isDup = key && (keyCache[entry.entry_type] || new Set()).has(key);

    return { entry, status: isDup ? 'dup' : 'new', errors: [] };
  });

  renderPreview(_validatedRows);

  const nNew     = _validatedRows.filter(r => r.status === 'new').length;
  const nDup     = _validatedRows.filter(r => r.status === 'dup').length;
  const nInvalid = _validatedRows.filter(r => r.status === 'invalid').length;

  $('validate-status').textContent = '';
  $('push-btn').disabled = nNew === 0 || nInvalid > 0;
}

/* ── Render preview tables ─────────────────────────────── */
function renderPreview(rows) {
  const bySheet = {};
  rows.forEach(r => {
    const sheet = r.entry.entry_type || 'UNKNOWN';
    (bySheet[sheet] = bySheet[sheet] || []).push(r);
  });

  const nNew     = rows.filter(r => r.status === 'new').length;
  const nDup     = rows.filter(r => r.status === 'dup').length;
  const nInvalid = rows.filter(r => r.status === 'invalid').length;

  $('preview-summary').innerHTML =
    `<span class="row-badge badge-new">${nNew} new</span> ` +
    (nDup     ? `<span class="row-badge badge-dup">${nDup} duplicate</span> ` : '') +
    (nInvalid ? `<span class="row-badge badge-invalid">${nInvalid} invalid</span>` : '');

  const container = $('preview-tables');
  container.innerHTML = '';

  for (const [sheet, sheetRows] of Object.entries(bySheet)) {
    const group = el('div', 'preview-sheet-group');
    const label = el('div', 'preview-sheet-label', sheet);
    group.appendChild(label);

    // Collect all keys across this sheet's entries
    const allKeys = new Set();
    sheetRows.forEach(r => Object.keys(r.entry).forEach(k => { if (k !== 'entry_type') allKeys.add(k); }));
    const cols = ['status', ...allKeys];

    const table = el('table', 'preview-table');
    const thead = el('thead');
    const hrow  = el('tr');
    cols.forEach(c => {
      const th = el('th', '', c === 'status' ? '' : c);
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = el('tbody');
    sheetRows.forEach(({ entry, status, errors }) => {
      const tr = el('tr', `row-${status}`);
      cols.forEach(c => {
        const td = el('td');
        if (c === 'status') {
          const badge = el('span', `row-badge badge-${status}`, status === 'new' ? 'New' : status === 'dup' ? 'Duplicate' : 'Invalid');
          if (status === 'invalid') badge.title = errors.join('\n');
          td.appendChild(badge);
        } else {
          td.textContent = entry[c] ?? '';
          td.title = entry[c] ?? '';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    group.appendChild(table);
    container.appendChild(group);
  }

  $('preview-panel').classList.remove('hidden');
}

/* ── Clear ingest ──────────────────────────────────────── */
function clearIngest() {
  $('ingest-textarea').value = '';
  $('validate-status').textContent = '';
  $('preview-panel').classList.add('hidden');
  $('results-panel').classList.add('hidden');
  $('push-btn').disabled = true;
  _parsedEntries = [];
  _validatedRows = [];
}

/* ════════════════════════════════════════════════════════
   INGEST — PUSH
════════════════════════════════════════════════════════ */
async function runPush() {
  const toWrite = _validatedRows
    .filter(r => r.status === 'new')
    .map(r => r.entry);

  if (toWrite.length === 0) return;

  $('push-btn').disabled = true;
  $('push-status').innerHTML = '<span class="spinner"></span>Writing to Google Sheets…';

  try {
    const r = await fetch(API_WRITE, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(toWrite),
    });
    const result = await r.json();

    if (!r.ok) {
      $('push-status').textContent = `Error: ${result.error || r.status}`;
      return;
    }

    // Invalidate sheet cache for affected sheets
    const affected = new Set(toWrite.map(e => e.entry_type));
    affected.forEach(s => { delete _sheetCache[s]; });

    renderResults(result);
    $('push-status').textContent = '';
  } catch (err) {
    $('push-status').textContent = `Network error: ${err.message}`;
    $('push-btn').disabled = false;
  }
}

/* ── Render push results ───────────────────────────────── */
function renderResults(result) {
  const body = $('results-body');
  body.innerHTML = '';

  if (result.sessionId) {
    const sid = el('p', '', '');
    sid.innerHTML = `<strong style="color:var(--text-secondary);font-size:0.72rem;letter-spacing:0.06em;text-transform:uppercase">Session</strong> <code style="font-size:0.78rem">${esc(result.sessionId)}</code>`;
    sid.style.marginBottom = '1rem';
    body.appendChild(sid);
  }

  const sections = [
    { key: 'written', title: 'Written', cls: 'result-title-written' },
    { key: 'skipped', title: 'Skipped (duplicates)', cls: 'result-title-skipped' },
    { key: 'errors',  title: 'Errors', cls: 'result-title-error' },
  ];

  sections.forEach(({ key, title, cls }) => {
    const items = result[key] || [];
    if (items.length === 0) return;

    const section = el('div', 'result-section');
    const h = el('div', `result-section-title ${cls}`, `${title} (${items.length})`);
    section.appendChild(h);

    items.forEach(item => {
      const row = el('div', 'result-item');
      const sheetEl = el('span', 'result-sheet', item.sheet || item.entry_type || '');
      const idEl    = el('span', '', item.id || item.error || '');
      row.appendChild(sheetEl);
      row.appendChild(idEl);
      section.appendChild(row);
    });
    body.appendChild(section);
  });

  $('results-panel').classList.remove('hidden');
}

/* ════════════════════════════════════════════════════════
   VERIFY TAB
════════════════════════════════════════════════════════ */
let _verifyAllRows = [];
let _verifyHeaders = [];

async function loadVerifySheet() {
  const sheet = $('verify-sheet-select').value;
  if (!sheet) return;

  $('verify-count').textContent = '';
  $('verify-search').classList.add('hidden');
  $('verify-table-wrap').innerHTML = '<p class="verify-placeholder"><span class="spinner"></span>Loading…</p>';

  try {
    const r = await fetch(`${API_READ}?sheet=${sheet}`, { headers: authHeaders() });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);

    _verifyHeaders = data.headers;
    _verifyAllRows = data.rows;

    renderDataTable('verify-table-wrap', data.headers, data.rows);
    $('verify-count').textContent = `${data.count} row${data.count !== 1 ? 's' : ''}`;
    $('verify-search').classList.remove('hidden');
    $('verify-search').value = '';
  } catch (err) {
    $('verify-table-wrap').innerHTML = `<p class="verify-placeholder" style="color:var(--red)">Error: ${esc(err.message)}</p>`;
  }
}

function filterVerifyTable() {
  const q = $('verify-search').value.toLowerCase();
  document.querySelectorAll('#verify-table-wrap tbody tr').forEach(tr => {
    const match = !q || tr.textContent.toLowerCase().includes(q);
    tr.classList.toggle('filtered-out', !match);
  });
}

/* ════════════════════════════════════════════════════════
   AUDIT LOG TAB
════════════════════════════════════════════════════════ */
async function loadAuditLog() {
  $('audit-table-wrap').innerHTML = '<p class="verify-placeholder"><span class="spinner"></span>Loading…</p>';

  try {
    const r = await fetch(`${API_READ}?sheet=AUDIT_LOG`, { headers: authHeaders() });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);

    // Reverse chronological
    const rows = [...data.rows].reverse();
    renderDataTable('audit-table-wrap', data.headers, rows);
  } catch (err) {
    $('audit-table-wrap').innerHTML = `<p class="verify-placeholder" style="color:var(--red)">Error: ${esc(err.message)}</p>`;
  }
}

/* ════════════════════════════════════════════════════════
   SHARED — Render data table
════════════════════════════════════════════════════════ */
function renderDataTable(containerId, headers, rows) {
  const wrap = $(containerId);
  if (rows.length === 0) {
    wrap.innerHTML = '<p class="verify-placeholder">No rows found.</p>';
    return;
  }

  const table = el('table', 'data-table');
  const thead  = el('thead');
  const hrow   = el('tr');
  headers.forEach(h => hrow.appendChild(el('th', '', h)));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  rows.forEach(row => {
    const tr = el('tr');
    headers.forEach(h => {
      const td = el('td');
      td.textContent = row[h] ?? '';
      td.title = row[h] ?? '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.innerHTML = '';
  wrap.appendChild(table);
}
