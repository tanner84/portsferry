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
  $('ingest-textarea').addEventListener('input', invalidatePreview);
  $('prepare-ids-btn').addEventListener('click', prepareIds);

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
let _preview = null;
let _busy = false;
let _validationSequence = 0;
function invalidatePreview() {
  _validationSequence++;
  _preview = null;
  $('push-btn').disabled = true;
  $('preview-panel').classList.add('hidden');
}
function busy(value) {
  _busy = value;
  for (const id of ['validate-btn','clear-btn','prepare-ids-btn','ingest-textarea','migration-sheet']) $(id).disabled = value;
  if (value) $('push-btn').disabled = true;
}
function prepareIds() {
  if (_busy) return;
  $('ingest-textarea').value = JSON.stringify([{
    entry_type: $('migration-sheet').value, action: 'migrate_ids',
    reason: 'Assign permanent relationship IDs while preserving existing data.'
  }], null, 2);
  invalidatePreview();
  $('validate-status').textContent = 'Prepared ID migration. Validate to inspect every affected row.';
}
async function runValidation() {
  if (_busy) return;
  invalidatePreview();
  const version = _validationSequence;
  const raw = $('ingest-textarea').value.trim();
  $('results-panel').classList.add('hidden');
  $('push-status').textContent = '';
  busy(true);
  $('validate-status').textContent = 'Reading current records and preparing preview…';
  try {
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error('Expected a JSON array.');
    const response = await fetch(API_WRITE, { method:'POST', headers:authHeaders(), body:JSON.stringify({mode:'preview',entries}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Preview failed.');
    if (version !== _validationSequence) return;
    _preview = { ...result, entries, raw };
    renderPreview(result.operations);
    $('validate-status').textContent = 'Preview ready. Expires in 15 minutes.';
    $('push-btn').textContent = result.summary.delete ? 'Apply changes including deletions' : 'Apply reviewed changes';
    $('push-btn').disabled = !result.operations.some(o=>o.action!=='skip');
  } catch (error) { $('validate-status').textContent = error.message; }
  finally { busy(false); }
}
function renderPreview(operations) {
  const counts = operations.reduce((a,o)=>(a[o.action]=(a[o.action]||0)+1,a),{});
  $('preview-summary').textContent = Object.entries(counts).map(([k,v])=>`${v} ${k}`).join(' · ');
  const wrap = $('preview-tables'); wrap.replaceChildren();
  for (const op of operations) {
    const detail = el('details','correction-preview');
    detail.open = operations.length <= 4;
    detail.appendChild(el('summary','',`${op.action.toUpperCase()} — ${op.sheet} / ${op.id}`));
    detail.appendChild(el('p','',op.reason || ''));
    if (op.action==='migrate_ids') {
      detail.appendChild(el('p','',`${op.rows.length} records receive IDs${op.addHeader ? '; adds an ID column' : ''}. Existing data is preserved.`));
      for(const r of op.rows) appendDiff(detail,r.before,r.after,[op.id]);
    } else if (op.action!=='skip') {
      if(op.action==='delete') detail.appendChild(el('p','delete-warning','This relationship row will be removed. Its original contents will remain in Audit Log.'));
      appendDiff(detail,op.before,op.after,op.changed || Object.keys(op.before || {}));
    }
    wrap.appendChild(detail);
  }
  $('preview-panel').classList.remove('hidden');
}
function appendDiff(wrap,before,after,fields) {
  const table=el('table','correction-diff');
  const head=el('tr');for(const label of ['Field','Before','After'])head.appendChild(el('th','',label));
  const thead=el('thead');thead.appendChild(head);table.appendChild(thead);
  const body=el('tbody');
  for(const field of fields) {
    const tr=el('tr');
    for(const value of [field,before ? before[field] ?? '' : '(new)',after ? after[field] ?? '' : '(deleted)'])tr.appendChild(el('td','',String(value)));
    body.appendChild(tr);
  }
  table.appendChild(body);wrap.appendChild(table);
}
function clearIngest() {
  if(_busy)return;
  $('ingest-textarea').value='';invalidatePreview();
  for(const id of ['validate-status','push-status'])$(id).textContent='';
  $('results-panel').classList.add('hidden');
}
function downloadJson(filename,data) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=el('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function runPush() {
  if(_busy || !_preview)return;
  if($('ingest-textarea').value.trim()!==_preview.raw) {invalidatePreview();return;}
  const preview=_preview;
  busy(true);$('push-status').textContent='Applying reviewed changes and audit records…';
  // Consume the local preview even on uncertain failures. Never automatically repeat a write.
  _preview=null;
  try {
    const response=await fetch(API_WRITE,{method:'POST',headers:authHeaders(),body:JSON.stringify({mode:'apply',entries:preview.entries,token:preview.token})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error || 'Apply failed.');
    const body=$('results-body');body.replaceChildren();
    body.appendChild(el('p','',`Applied ${result.applied} audited record/schema changes. Session: ${result.sessionId}`));
    const button=el('button','btn-primary','Download result and recovery JSON');
    button.addEventListener('click',()=>downloadJson(`${result.sessionId}.json`,result));body.appendChild(button);
    $('results-panel').classList.remove('hidden');$('push-status').textContent='Complete. Use Verify to read back the records.';
  } catch(error) { $('push-status').textContent=`${error.message} Check Audit Log before validating again if the result is uncertain.`; }
  finally {busy(false);$('push-btn').disabled=true;}
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
    const exportButton=el('button','btn-ghost','Download audit records');
    exportButton.addEventListener('click',()=>downloadJson('portsferry-audit.json',rows));
    $('audit-table-wrap').prepend(exportButton);
    const table=$('audit-table-wrap').querySelector('table');
    if(table) {
      table.querySelector('thead tr').appendChild(el('th','','Recovery'));
      [...table.querySelectorAll('tbody tr')].forEach((tr,index)=>{
        const record=rows[index],td=el('td');tr.appendChild(td);
        if(!['update','reassign','delete'].includes(record.action)||!record.before_json)return;
        const button=el('button','btn-ghost','Prepare restore');td.appendChild(button);
        button.addEventListener('click',()=>{
          if(_busy)return;
          try {
            const before=JSON.parse(record.before_json),after=JSON.parse(record.after_json);
            const entry={entry_type:record.sheet,action:record.action==='delete'?'add':'update',reason:`Restore before ${record.session_id}`};
            if(entry.action==='update'){entry.record_id=record.record_id;entry.expected=after;entry.changes=Object.fromEntries(Object.keys(before).filter(k=>before[k]!==after[k]).map(k=>[k,before[k]]));}
            else entry.changes=before;
            $('ingest-textarea').value=JSON.stringify([entry],null,2);invalidatePreview();switchTab('ingest');
            $('validate-status').textContent='Restore prepared. Validate against current records before applying.';
          }catch{button.textContent='Invalid recovery data';button.disabled=true;}
        });
      });
    }
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

