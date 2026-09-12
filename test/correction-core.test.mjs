import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildMutationRequests,
  findConflicts,
  previewCorrections,
  requiredSheetNames,
  summarizeApplied,
} from '../netlify/functions/_shared/correction-core.mjs';

const operations = JSON.parse(await readFile(
  new URL('../data/corrections/indiantown-manual-corrections.json', import.meta.url),
  'utf8',
));

function sheet(headers, records) {
  return {
    headers,
    rows: records.map((values, rowIndex) => ({ rowIndex, values })),
  };
}

function fixtures() {
  return {
    IND_CHURCH: sheet(
      ['link_id', 'ind_id', 'ch_id', 'role', 'date_from', 'date_to', 'source_ids', 'notes'],
      [
        { link_id: 'ich_039', ind_id: 'ind_065', ch_id: 'ch_008', role: 'Unrelated retained link', date_from: '1778', date_to: '', source_ids: 'src_900', notes: 'Must not change.' },
        { link_id: 'ich_040', ind_id: 'ind_065', ch_id: 'ch_008', role: 'Founder', date_from: '1761', date_to: '1770', source_ids: 'src_901', notes: 'Original row.' },
        { link_id: 'ich_041', ind_id: 'ind_066', ch_id: 'ch_008', role: 'Member', date_from: '1765', date_to: '', source_ids: 'src_902', notes: 'Erroneous.' },
        { link_id: 'ich_047', ind_id: 'ind_067', ch_id: 'ch_008', role: 'Member', date_from: '1762', date_to: '1775', source_ids: 'src_903', notes: 'Dates unsupported.' },
      ],
    ),
    IND_IND: sheet(
      ['edge_id', 'ind_id_a', 'ind_id_b', 'relationship', 'source_ids', 'notes'],
      [
        { edge_id: 'iind_243', ind_id_a: 'ind_068', ind_id_b: 'ind_069', relationship: 'kin', source_ids: 'src_904', notes: 'Erroneous link; people remain.' },
      ],
    ),
    INDIVIDUALS: sheet(
      ['ind_id', 'full_name'],
      [
        { ind_id: 'ind_065', full_name: 'Unrelated retained individual' },
        { ind_id: 'ind_066', full_name: 'Person 66' },
        { ind_id: 'ind_067', full_name: 'Person 67' },
        { ind_id: 'ind_068', full_name: 'Joshua fixture' },
        { ind_id: 'ind_069', full_name: 'Person 69' },
        { ind_id: 'ind_112', full_name: 'Correct founder' },
      ],
    ),
    CHURCHES: sheet(
      ['ch_id', 'church_name'],
      [{ ch_id: 'ch_008', church_name: 'Indiantown Presbyterian Church' }],
    ),
    AUDIT_LOG: sheet(
      [
        'timestamp', 'session_id', 'entries_written', 'entries_overwritten',
        'entries_updated', 'entries_reassigned', 'entries_deleted',
        'entries_skipped', 'entry_types_affected', 'notes',
      ],
      [],
    ),
  };
}

test('the four pending operations preview by stable record ID', () => {
  const preview = previewCorrections(operations, fixtures());

  assert.equal(preview.valid, true);
  assert.equal(preview.items.length, 4);
  assert.deepEqual(preview.items.map(item => item.status), ['reassign', 'delete', 'update', 'delete']);
  assert.equal(preview.prepared.length, 4);

  const reassignment = preview.items[0];
  assert.equal(reassignment.before.link_id, 'ich_040');
  assert.equal(reassignment.before.ind_id, 'ind_065');
  assert.equal(reassignment.after.link_id, 'ich_040');
  assert.equal(reassignment.after.ind_id, 'ind_112');
  assert.equal(reassignment.after.ch_id, 'ch_008');
  assert.equal(reassignment.after.date_from, '1760');
  assert.equal(reassignment.after.date_to, '');

  const unknownDates = preview.items[2];
  assert.equal(unknownDates.after.date_from, '');
  assert.equal(unknownDates.after.date_to, '');
  assert.match(unknownDates.after.role, /membership dates unknown/);
});

test('referenced people and churches must exist', () => {
  const bad = structuredClone(operations);
  bad[0].changes.ind_id = 'ind_999';

  const preview = previewCorrections(bad, fixtures());
  assert.equal(preview.valid, false);
  assert.match(preview.items[0].errors.join(' '), /missing INDIVIDUALS record ind_999/);
});

test('stable IDs cannot be changed by a correction', () => {
  const bad = structuredClone(operations);
  bad[0].changes.link_id = 'ich_999';

  const preview = previewCorrections(bad, fixtures());
  assert.equal(preview.valid, false);
  assert.match(preview.items[0].errors.join(' '), /link_id is immutable/);
});

test('a changed row causes a conflict before any write', () => {
  const originalSheets = fixtures();
  const originalPreview = previewCorrections(operations, originalSheets);
  assert.equal(originalPreview.valid, true);

  const changedSheets = fixtures();
  changedSheets.IND_CHURCH.rows[1].values.notes = 'Another researcher edited this row.';
  const currentPreview = previewCorrections(originalPreview.prepared, changedSheets);
  assert.equal(currentPreview.valid, true);

  const conflicts = findConflicts(originalPreview.prepared, currentPreview.items);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].record_id, 'ich_040');
  assert.match(conflicts[0].error, /Nothing was written/);
});

test('one atomic batch contains updates, descending deletes, and the full audit snapshot', () => {
  const sheets = fixtures();
  const preview = previewCorrections(operations, sheets);
  const requests = buildMutationRequests(
    preview.items,
    sheets,
    { IND_CHURCH: 20, IND_IND: 21, AUDIT_LOG: 99 },
    { sessionId: 'corr_test', timestamp: '2026-09-12T00:00:00.000Z' },
  );

  assert.equal(requests.filter(request => request.updateCells).length, 2);
  assert.equal(requests.filter(request => request.deleteDimension).length, 2);
  assert.equal(requests.filter(request => request.appendCells).length, 1);

  const audit = requests.at(-1).appendCells.rows[0].values;
  const notesIndex = sheets.AUDIT_LOG.headers.indexOf('notes');
  const notes = JSON.parse(audit[notesIndex].userEnteredValue.stringValue);
  assert.equal(notes.correction_operations.length, 4);
  assert.equal(notes.correction_operations[1].record_id, 'ich_041');
  assert.equal(notes.correction_operations[1].before.notes, 'Erroneous.');
  assert.equal(notes.correction_operations[1].after, null);

  assert.deepEqual(summarizeApplied(preview.items), {
    updated: [{ sheet: 'IND_CHURCH', id: 'ich_047', changed_fields: ['role', 'date_from', 'date_to'] }],
    reassigned: [{ sheet: 'IND_CHURCH', id: 'ich_040', changed_fields: ['ind_id', 'role', 'date_from', 'date_to'] }],
    deleted: [
      { sheet: 'IND_CHURCH', id: 'ich_041' },
      { sheet: 'IND_IND', id: 'iind_243' },
    ],
  });
});

test('required sheet loading includes targets and reference tables', () => {
  assert.deepEqual(
    new Set(requiredSheetNames(operations)),
    new Set(['AUDIT_LOG', 'IND_CHURCH', 'INDIVIDUALS', 'CHURCHES', 'IND_IND']),
  );
});

test('a correction batch cannot run without an audit notes column', () => {
  const sheets = fixtures();
  const preview = previewCorrections(operations, sheets);
  sheets.AUDIT_LOG.headers = ['timestamp', 'session_id'];

  assert.throws(
    () => buildMutationRequests(
      preview.items,
      sheets,
      { IND_CHURCH: 20, IND_IND: 21, AUDIT_LOG: 99 },
      { sessionId: 'corr_test', timestamp: '2026-09-12T00:00:00.000Z' },
    ),
    /AUDIT_LOG is missing required columns: notes/,
  );
});
