/**
 * Pure validation and Google Sheets request builders for admin corrections.
 * No network or environment access belongs in this module so it can be tested
 * without credentials.
 */

export function correctionSchema() {
  return {
    operations: new Set(['update', 'reassign', 'delete']),
    stableIds: {
      INDIVIDUALS: 'ind_id',
      CHURCHES: 'ch_id',
      PROPERTIES: 'prop_id',
      UNITS: 'unit_id',
      EVENTS: 'evt_id',
      SOURCES: 'src_id',
      BATTLES: 'battle_id',
      UNIT_POSITIONS: 'pos_id',
      BATTLE_PARTICIPANTS: 'bp_id',
      IND_CHURCH: 'link_id',
      IND_UNIT: 'link_id',
      IND_PROPERTY: 'link_id',
      IND_IND: 'edge_id',
      EVT_LINKS: 'link_id',
      WEATHER: 'weather_id',
      COUNTIES: 'county_id',
    },
    references: {
      ind_id: ['INDIVIDUALS', 'ind_id'],
      ind_id_a: ['INDIVIDUALS', 'ind_id'],
      ind_id_b: ['INDIVIDUALS', 'ind_id'],
      ch_id: ['CHURCHES', 'ch_id'],
      prop_id: ['PROPERTIES', 'prop_id'],
      unit_id: ['UNITS', 'unit_id'],
      evt_id: ['EVENTS', 'evt_id'],
      battle_id: ['BATTLES', 'battle_id'],
    },
    uniqueRelationships: {
      IND_CHURCH: ['ind_id', 'ch_id', 'date_from'],
      IND_UNIT: ['ind_id', 'unit_id', 'date_from'],
      IND_PROPERTY: ['ind_id', 'prop_id', 'date_from'],
      IND_IND: ['ind_id_a', 'ind_id_b', 'relationship'],
      EVT_LINKS: ['evt_id', 'linked_id'],
    },
  };
}

export function requiredSheetNames(operations) {
  const schema = correctionSchema();
  const names = new Set(['AUDIT_LOG']);

  for (const raw of Array.isArray(operations) ? operations : []) {
    if (typeof raw?.entry_type === 'string') names.add(raw.entry_type);
    const changes = isPlainObject(raw?.changes) ? raw.changes : {};
    for (const field of Object.keys(changes)) {
      const target = schema.references[field];
      if (target) names.add(target[0]);
    }
  }

  return [...names].filter(name => name === 'AUDIT_LOG' || schema.stableIds[name]);
}

export function previewCorrections(operations, sheets) {
  const schema = correctionSchema();
  const rawOperations = Array.isArray(operations) ? operations : [];
  const seenTargets = new Set();
  const items = [];

  if (!Array.isArray(operations) || operations.length === 0) {
    return {
      valid: false,
      items: [{ index: 0, status: 'invalid', errors: ['Expected a non-empty JSON array of correction operations.'] }],
      prepared: [],
    };
  }

  rawOperations.forEach((raw, index) => {
    const errors = [];
    const entryType = typeof raw?.entry_type === 'string' ? raw.entry_type : '';
    const operation = typeof raw?.operation === 'string' ? raw.operation.toLowerCase() : '';
    const stableIdField = schema.stableIds[entryType];
    const recordId = String(raw?.record_id ?? (stableIdField ? raw?.[stableIdField] ?? '' : ''));
    const changes = isPlainObject(raw?.changes) ? raw.changes : {};
    const reason = typeof raw?.reason === 'string' ? raw.reason : '';

    if (!stableIdField) errors.push(`Unknown or unsupported entry_type: "${entryType || '(missing)'}".`);
    if (!schema.operations.has(operation)) errors.push('operation must be update, reassign, or delete.');
    if (!recordId) errors.push('record_id is required and must be the stable row ID.');
    if (raw?.changes !== undefined && !isPlainObject(raw.changes)) errors.push('changes must be a JSON object.');
    if (operation !== 'delete' && Object.keys(changes).length === 0) errors.push(`${operation || 'This operation'} requires at least one field in changes.`);
    if (operation === 'delete' && Object.keys(changes).length > 0) errors.push('delete operations cannot include changes.');

    const targetKey = `${entryType}\u0000${recordId}`;
    if (entryType && recordId) {
      if (seenTargets.has(targetKey)) errors.push(`Duplicate correction target: ${entryType} ${recordId}.`);
      seenTargets.add(targetKey);
    }

    const sheet = sheets?.[entryType];
    if (stableIdField && !sheet) errors.push(`Sheet data was not loaded for ${entryType}.`);

    const headers = Array.isArray(sheet?.headers) ? sheet.headers : [];
    if (stableIdField && sheet && !headers.includes(stableIdField)) {
      errors.push(`${entryType} is missing its stable ID column (${stableIdField}).`);
    }

    const matches = Array.isArray(sheet?.rows)
      ? sheet.rows.filter(row => String(row.values?.[stableIdField] ?? '') === recordId)
      : [];
    if (stableIdField && sheet && matches.length === 0) errors.push(`${recordId} was not found in ${entryType}.`);
    if (matches.length > 1) errors.push(`${recordId} appears more than once in ${entryType}; no correction is safe.`);

    for (const [field, value] of Object.entries(changes)) {
      if (!headers.includes(field)) errors.push(`Unknown ${entryType} column: ${field}.`);
      if (field === stableIdField && String(value ?? '') !== recordId) {
        errors.push(`${stableIdField} is immutable; keep ${recordId} as the stable ID.`);
      }
      if (!isCellValue(value)) errors.push(`${field} must be a string, number, boolean, or null.`);
    }

    const reassignedFields = Object.keys(changes).filter(field => schema.references[field]);
    if (operation === 'reassign' && reassignedFields.length === 0) {
      errors.push('reassign requires at least one person, church, property, unit, event, or battle ID change.');
    }

    const matched = matches[0];
    const before = matched ? normalizeRow(headers, matched.values) : null;
    const after = before && operation !== 'delete'
      ? { ...before, ...normalizeChanges(changes), [stableIdField]: recordId }
      : null;

    if (after) {
      for (const field of reassignedFields) {
        const value = String(after[field] ?? '');
        const [targetSheetName, targetIdField] = schema.references[field];
        if (!value) {
          errors.push(`${field} cannot be blank.`);
          continue;
        }
        const targetSheet = sheets?.[targetSheetName];
        const exists = Array.isArray(targetSheet?.rows)
          && targetSheet.rows.some(row => String(row.values?.[targetIdField] ?? '') === value);
        if (!exists) errors.push(`${field} references missing ${targetSheetName} record ${value}.`);
      }
    }

    const changedFields = before && after
      ? headers.filter(field => String(before[field] ?? '') !== String(after[field] ?? ''))
      : [];
    if (before && after && changedFields.length === 0) errors.push('The proposed correction does not change the live row.');

    items.push({
      index,
      status: errors.length ? 'invalid' : operation,
      errors,
      entry_type: entryType,
      operation,
      record_id: recordId,
      stable_id_field: stableIdField || '',
      reason,
      headers,
      row_index: matched?.rowIndex,
      before,
      after,
      changed_fields: changedFields,
      changes: normalizeChanges(changes),
    });
  });

  flagRelationshipCollisions(items, sheets, schema);

  const valid = items.every(item => item.errors.length === 0);
  const prepared = valid
    ? items.map(item => ({
        entry_type: item.entry_type,
        operation: item.operation,
        record_id: item.record_id,
        changes: item.operation === 'delete' ? undefined : item.changes,
        reason: item.reason || undefined,
        expected: item.before,
      }))
    : [];

  return { valid, items, prepared };
}

export function findConflicts(prepared, previewItems) {
  const conflicts = [];

  previewItems.forEach((item, index) => {
    const expected = prepared?.[index]?.expected;
    if (!isPlainObject(expected)) {
      conflicts.push({
        index,
        entry_type: item.entry_type,
        record_id: item.record_id,
        error: 'Missing expected row snapshot. Preview the corrections again.',
      });
      return;
    }

    const changed = item.headers.some(header =>
      normalizeCell(expected[header]) !== normalizeCell(item.before?.[header])
    );
    if (changed) {
      conflicts.push({
        index,
        entry_type: item.entry_type,
        record_id: item.record_id,
        error: 'The row changed after preview. Nothing was written.',
        expected: normalizeRow(item.headers, expected),
        current: item.before,
      });
    }
  });

  return conflicts;
}

export function buildMutationRequests(items, sheets, sheetIds, auditContext) {
  const mutationRequests = [];
  const deletions = [];

  for (const item of items) {
    const sheetId = sheetIds[item.entry_type];
    if (!Number.isInteger(sheetId)) throw new Error(`Missing numeric sheet ID for ${item.entry_type}.`);

    if (item.operation === 'delete') {
      deletions.push({ sheetId, rowIndex: item.row_index, item });
      continue;
    }

    mutationRequests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: item.row_index + 1,
          endRowIndex: item.row_index + 2,
          startColumnIndex: 0,
          endColumnIndex: item.headers.length,
        },
        rows: [{ values: item.headers.map(header => cellData(item.after[header])) }],
        fields: 'userEnteredValue',
      },
    });
  }

  deletions
    .sort((a, b) => a.sheetId === b.sheetId ? b.rowIndex - a.rowIndex : a.sheetId - b.sheetId)
    .forEach(({ sheetId, rowIndex }) => {
      mutationRequests.push({
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex + 1,
            endIndex: rowIndex + 2,
          },
        },
      });
    });

  const auditSheet = sheets.AUDIT_LOG;
  const auditSheetId = sheetIds.AUDIT_LOG;
  if (!auditSheet || !Number.isInteger(auditSheetId)) {
    throw new Error('AUDIT_LOG is required for atomic correction writes.');
  }

  const auditHeaders = auditSheet.headers;
  const missingAuditHeaders = ['timestamp', 'session_id', 'notes']
    .filter(header => !auditHeaders.includes(header));
  if (missingAuditHeaders.length > 0) {
    throw new Error(`AUDIT_LOG is missing required columns: ${missingAuditHeaders.join(', ')}.`);
  }
  const auditValues = buildAuditValues(auditHeaders, items, auditContext);
  mutationRequests.push({
    appendCells: {
      sheetId: auditSheetId,
      rows: [{ values: auditValues.map(cellData) }],
      fields: 'userEnteredValue',
    },
  });

  return mutationRequests;
}

export function summarizeApplied(items) {
  const summary = { updated: [], reassigned: [], deleted: [] };
  for (const item of items) {
    const result = {
      sheet: item.entry_type,
      id: item.record_id,
      changed_fields: item.changed_fields,
    };
    if (item.operation === 'delete') delete result.changed_fields;
    summary[item.operation === 'update' ? 'updated' : item.operation === 'reassign' ? 'reassigned' : 'deleted'].push(result);
  }
  return summary;
}

function flagRelationshipCollisions(items, sheets, schema) {
  for (const item of items) {
    if (item.errors.length || !item.after) continue;
    const fields = schema.uniqueRelationships[item.entry_type];
    if (!fields) continue;

    const proposed = compoundKey(fields, item.after);
    const stableIdField = item.stable_id_field;
    const rows = sheets[item.entry_type]?.rows || [];
    const collision = rows.some(row => {
      const rowId = String(row.values?.[stableIdField] ?? '');
      return rowId !== item.record_id && compoundKey(fields, row.values || {}) === proposed;
    });
    if (collision) item.errors.push(`The corrected row would duplicate another ${item.entry_type} relationship.`);

    const peerCollision = items.some(peer =>
      peer !== item
      && peer.entry_type === item.entry_type
      && peer.after
      && compoundKey(fields, peer.after) === proposed
    );
    if (peerCollision) item.errors.push(`Two proposed corrections would create the same ${item.entry_type} relationship.`);
    if (item.errors.length) item.status = 'invalid';
  }
}

function buildAuditValues(headers, items, context) {
  const counts = {
    updated: items.filter(item => item.operation === 'update').length,
    reassigned: items.filter(item => item.operation === 'reassign').length,
    deleted: items.filter(item => item.operation === 'delete').length,
  };
  const details = items.map(item => ({
    operation: item.operation,
    sheet: item.entry_type,
    record_id: item.record_id,
    reason: item.reason || '',
    before: item.before,
    after: item.after,
  }));
  const notes = JSON.stringify({ correction_operations: details });
  if (notes.length > 48000) throw new Error('Correction audit detail exceeds the Google Sheets cell limit. Split the batch.');

  const values = {
    timestamp: context.timestamp,
    session_id: context.sessionId,
    entries_written: '0',
    entries_overwritten: String(counts.updated + counts.reassigned),
    entries_updated: String(counts.updated),
    entries_reassigned: String(counts.reassigned),
    entries_deleted: String(counts.deleted),
    entries_skipped: '0',
    entry_types_affected: [...new Set(items.map(item => item.entry_type))].join(', '),
    notes,
  };

  return headers.map(header => values[header] ?? '');
}

function normalizeRow(headers, values) {
  const row = {};
  for (const header of headers) row[header] = normalizeCell(values?.[header]);
  return row;
}

function normalizeChanges(changes) {
  const result = {};
  for (const [field, value] of Object.entries(changes || {})) result[field] = normalizeCell(value);
  return result;
}

function normalizeCell(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function compoundKey(fields, row) {
  return fields.map(field => normalizeCell(row?.[field])).join('\u0000');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCellValue(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function cellData(value) {
  return { userEnteredValue: { stringValue: normalizeCell(value) } };
}
