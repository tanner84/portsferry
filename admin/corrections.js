/**
 * corrections.js — correction/reassignment/deletion UI for Port's Ferry admin
 * Loaded after admin.js so it shares the existing authenticated session.
 */

'use strict';

const API_CORRECT = '/.netlify/functions/sheets-correct';

let _correctionOps = [];
let _correctionPreview = null;

function cEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function correctionHeaders() {
  const pw = sessionStorage.getItem('pf_admin_pw');
  return {
    'x-admin-password': pw || '',
    'Content-Type': 'application/json',
  };
}

function parseCorrectionInput() {
  const raw = document.getElementById('correction-textarea').value.trim();
  if (!raw) throw new Error('Paste a correction JSON array first.');
  const parsed = JSON.parse(raw);
  const ops = Array.isArray(parsed) ? parsed : parsed.operations;
  if (!Array.isArray(ops)) throw new Error('Expected a JSON array, or an object containing an operations array.');
  if (ops.length === 0) throw new Error('The correction array is empty.');
  return ops;
}

function correctionBadge(label, cls) {
  return `<span class="row-badge ${cls}">${cEsc(label)}</span>`;
}

function renderCorrectionSummary(summary) {
  const el = document.getElementById('correction-summary');
  if (!summary) { el.innerHTML = ''; return; }
  const bits = [correctionBadge(`${summary.valid} valid`, 'badge-new')];
  if (summary.updates) bits.push(correctionBadge(`${summary.updates} update`, 'badge-overwrite'));
  if (summary.reassignments) bits.push(correctionBadge(`${summary.reassignments} reassign`, 'badge-warn'));
  if (summary.deletes) bits.push(correctionBadge(`${summary.deletes} delete`, 'badge-invalid'));
  if (summary.invalid) bits.push(correctionBadge(`${summary.invalid} invalid`, 'badge-invalid'));
  el.innerHTML = bits.join(' ');
}

function renderCorrectionPreview(data) {
  const body = document.getElementById('correction-preview-body');
  body.innerHTML = '';
  renderCorrectionSummary(data.summary);

  for (const item of data.items || []) {
    const card = document.createElement('div');
    card.className = `correction-operation${item.valid ? '' : ' invalid'}`;

    const header = document.createElement('div');
    header.className = 'correction-op-header';
    const opCls = item.valid
      ? (item.operation === 'delete' ? 'badge-invalid' : item.operation === 'reassign' ? 'badge-warn' : 'badge-overwrite')
      : 'badge-invalid';
    header.innerHTML =
      `${correctionBadge(item.operation || 'invalid', opCls)}` +
      `<strong>${cEsc(item.entry_type || 'UNKNOWN')}</strong>` +
      `<code>${cEsc(item.record_id || '')}</code>`;
    card.appendChild(header);

    if (!item.valid) {
      const err = document.createElement('div');
      err.className = 'correction-errors';
      err.innerHTML = (item.errors || ['Unknown validation error'])
        .map(e => `• ${cEsc(e)}`)
        .join('<br>');
      card.appendChild(err);
    } else {
      const table = document.createElement('table');
      table.className = 'correction-diff-table';
      table.innerHTML = '<thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>';
      const tbody = document.createElement('tbody');

      const diffs = item.diffs || [];
      for (const diff of diffs) {
        const tr = document.createElement('tr');
        const afterText = item.operation === 'delete' ? '(deleted)' : (diff.after ?? '');
        tr.innerHTML =
          `<td><code>${cEsc(diff.field)}</code></td>` +
          `<td class="correction-before">${cEsc(diff.before ?? '')}</td>` +
          `<td class="correction-after${item.operation === 'delete' ? ' correction-delete' : ''}">${cEsc(afterText)}</td>`;
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      card.appendChild(table);
    }

    if (item.reason) {
      const reason = document.createElement('div');
      reason.className = 'correction-reason';
      reason.innerHTML = `<strong>Reason:</strong> ${cEsc(item.reason)}`;
      card.appendChild(reason);
    }

    body.appendChild(card);
  }

  document.getElementById('correction-preview-card').classList.remove('hidden');
  const allValid = data.summary && data.summary.invalid === 0 && data.summary.valid > 0;
  document.getElementById('correction-apply-btn').disabled = !allValid;
}

async function previewCorrections() {
  const status = document.getElementById('correction-status');
  const applyStatus = document.getElementById('correction-apply-status');
  document.getElementById('correction-apply-btn').disabled = true;
  document.getElementById('correction-results-card').classList.add('hidden');
  applyStatus.textContent = '';

  let ops;
  try {
    ops = parseCorrectionInput();
  } catch (err) {
    status.textContent = `JSON error: ${err.message}`;
    return;
  }

  status.innerHTML = '<span class="spinner"></span>Previewing live rows…';
  try {
    const response = await fetch(API_CORRECT, {
      method: 'POST',
      headers: correctionHeaders(),
      body: JSON.stringify({ mode: 'preview', operations: ops }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    _correctionOps = ops;
    _correctionPreview = data;
    renderCorrectionPreview(data);
    status.textContent = data.summary.invalid
      ? 'Preview contains validation errors. Nothing can be applied until they are fixed.'
      : 'Preview is current. Review every before → after value before applying.';
  } catch (err) {
    status.textContent = `Preview error: ${err.message}`;
  }
}

function renderCorrectionApplyResults(data) {
  const card = document.getElementById('correction-results-card');
  const body = document.getElementById('correction-results-body');
  body.innerHTML = '';

  if (data.sessionId) {
    const p = document.createElement('div');
    p.className = 'correction-result-line';
    p.innerHTML = `<strong>Session:</strong> <code>${cEsc(data.sessionId)}</code>`;
    body.appendChild(p);
  }

  for (const item of data.applied || []) {
    const p = document.createElement('div');
    p.className = 'correction-result-line';
    p.innerHTML = `${correctionBadge(item.operation, item.operation === 'delete' ? 'badge-invalid' : item.operation === 'reassign' ? 'badge-warn' : 'badge-overwrite')} ` +
      `<strong>${cEsc(item.entry_type)}</strong> <code>${cEsc(item.record_id)}</code>`;
    body.appendChild(p);
  }

  for (const warning of data.warnings || []) {
    const p = document.createElement('div');
    p.className = 'correction-result-line';
    p.style.color = 'var(--orange)';
    p.textContent = `Warning: ${warning}`;
    body.appendChild(p);
  }

  card.classList.remove('hidden');
}

async function applyCorrections() {
  if (!_correctionPreview || !_correctionOps.length) return;
  if (_correctionPreview.summary.invalid > 0) return;

  const btn = document.getElementById('correction-apply-btn');
  const status = document.getElementById('correction-apply-status');
  btn.disabled = true;
  status.innerHTML = '<span class="spinner"></span>Re-checking live rows and applying…';

  const previewByIndex = new Map((_correctionPreview.items || []).map(item => [item.index, item]));
  const operations = _correctionOps.map((op, index) => ({
    ...op,
    expected: previewByIndex.get(index) ? previewByIndex.get(index).before : undefined,
  }));

  try {
    const response = await fetch(API_CORRECT, {
      method: 'POST',
      headers: correctionHeaders(),
      body: JSON.stringify({ mode: 'apply', operations }),
    });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 409 && data.items) {
        _correctionPreview = { summary: data.summary, items: data.items };
        renderCorrectionPreview(_correctionPreview);
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    renderCorrectionApplyResults(data);
    status.textContent = `Applied ${data.applied.length} correction${data.applied.length === 1 ? '' : 's'}. Preview again before any further changes.`;
    _correctionPreview = null;
    _correctionOps = [];
    delete window._sheetCache;
  } catch (err) {
    status.textContent = `Apply error: ${err.message}`;
  }
}

function clearCorrections() {
  document.getElementById('correction-textarea').value = '';
  document.getElementById('correction-status').textContent = '';
  document.getElementById('correction-apply-status').textContent = '';
  document.getElementById('correction-preview-body').innerHTML = '';
  document.getElementById('correction-summary').innerHTML = '';
  document.getElementById('correction-preview-card').classList.add('hidden');
  document.getElementById('correction-results-card').classList.add('hidden');
  document.getElementById('correction-apply-btn').disabled = true;
  _correctionOps = [];
  _correctionPreview = null;
}

document.addEventListener('DOMContentLoaded', () => {
  const previewBtn = document.getElementById('correction-preview-btn');
  if (!previewBtn) return;
  previewBtn.addEventListener('click', previewCorrections);
  document.getElementById('correction-clear-btn').addEventListener('click', clearCorrections);
  document.getElementById('correction-apply-btn').addEventListener('click', applyCorrections);
});
