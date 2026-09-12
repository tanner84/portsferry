# Research corrections in admin

The admin accepts the existing flat JSON arrays (`entry_type`, IDs, fields, optional `overwrite: true`) and explicit correction operations. A server preview is required for every write. Editing the input invalidates its preview. Apply sends the original entries and a signed, 15-minute preview token; changed spreadsheet contents cause a conflict instead of applying an outdated preview.

## Existing imports

Paste the old JSON, select **Validate and preview**, inspect the before/after values, and select **Apply reviewed changes**. Duplicate additions are skipped. An overwrite whose target is missing is rejected instead of silently appending a replacement. Unknown fields are rejected rather than silently discarded. Blank dates are permitted; do not invent historical dates to satisfy a composite key.

## Correction format

```json
[
  {
    "entry_type": "IND_CHURCH",
    "action": "reassign",
    "record_id": "ich_040",
    "expected": { "ind_id": "ind_060", "ch_id": "ch_008" },
    "changes": { "ind_id": "ind_112" },
    "reason": "Correct person identity against the cited source."
  }
]
```

Actions:

- `add`: place row fields in `changes`. Provide the primary ID for entity tables. Relationship IDs may be allocated automatically after migration.
- `update`: use `record_id`, `changes`, and `reason`. Only submitted fields change. Use an empty string or null to clear a field.
- `reassign`: like update, limited to relationships; changes endpoints or dates while retaining the permanent link ID.
- `delete`: use `record_id` and `reason`, without `changes`. Limited to IND_CHURCH, IND_UNIT, IND_PROPERTY, IND_IND and EVT_LINKS. No cascade or person/church/property/source deletion.
- `migrate_ids`: use `entry_type` and `reason`. Preview shows each ID to be assigned. Do not combine migration and corrections to that table in one batch.

`expected` optionally records source-research-time field values. A mismatch blocks the batch even if the server's preview would otherwise be current. Stable IDs cannot themselves be changed. A target must resolve uniquely. Same-batch additions may reference each other, but duplicate relationships and references to missing people, churches, properties, units, battles, events or sources are rejected. Do not reference the same existing row twice in one batch.

Every submitted source ID must already exist or be added in the same batch. Preserve pipe-delimited source lists. Historical interpretation still requires source criticism: structural validation cannot prove kinship or church membership.

## Stable-ID migration

The public spreadsheet snapshot used during implementation has IDs on IND_CHURCH, IND_UNIT and IND_IND, but lacks link_id columns on IND_PROPERTY and EVT_LINKS. Under **Prepare permanent relationship IDs**, select one table and prepare/preview its migration. Review the column addition and each ID before applying. Migration appends the missing ID column and fills only missing IDs; all existing IDs and non-ID values remain untouched. It never renumbers rows or changes Cross Creek research assertions.

New relationship IDs use collision-checked random-seeded hashes, not row counts. They have forms such as `ip_4e41627ef12a9501`; existing numeric IDs remain valid. This prevents reuse after deletions and eliminates the observed row-count collision with iind_231. Duplicate existing stable IDs are reported for correction rather than silently choosing a row.

The four pending Indiantown fixes already use stable IDs and need no migration. [Their correction JSON](examples/indiantown-corrections.json) is ready to preview after deployment. Expected actions: one reassign, one update, and two deletes. This only repairs Indiantown links and an unsupported Joshua James kinship; it preserves person records and the Cross Creek church relationships. The earlier 19-update JSON remains a separate import. Neither file is applied by deployment.

## Audit and recovery

Each applied record change saves timestamp, session ID, sheet, stable ID, action, complete before/after row, reason and source IDs in AUDIT_LOG. Missing audit columns are appended; existing columns and historical log entries remain. Changes and audit rows are submitted in one Google Sheets spreadsheets.batchUpdate request: an invalid batch fails without partial application.

The Results panel downloads the result, original rows and recovery operations. In Audit Log, **Prepare restore** creates a draft import for an update/reassignment or a deleted relationship. It does not execute the restore. Validate and review it like any other correction; restoration checks expected post-change fields and refuses to overwrite newer data. A deleted row is restored by its original ID, not original row number. Additions and ID migrations are not automatically undone; do not remove an entity or ID that later relationships may depend on. Audit JSON always retains the migration's original values.

A network timeout can leave completion uncertain. Check Audit Log for the session before retrying. The UI consumes its apply token rather than automatically replaying a request.

## Deployment and access

The old sheets-write.js is replaced by sheets-write.mts at the same Netlify function URL. The existing googleapis dependency and four environment variables are reused: ADMIN_PASSWORD, GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY. No additional credential or public-page change is required. Deploy admin and backend together; old browser tabs should be refreshed. Direct callers of the endpoint must use `{ "mode": "preview", "entries": [...] }`, then `{ "mode": "apply", "entries": [...], "token": "..." }`. Raw arrays remain supported as admin input, not as a direct write request bypassing preview.

No live data migration, correction, or deletion runs during deployment. Read access uses the existing admin password. The public read endpoint and map are unchanged.

## Concurrency limit

Use one writer at a time, including direct spreadsheet edits. Snapshot checking catches edits made between preview and the final read. Google Sheets does not provide a compare-and-swap transaction for this API: simultaneous requests can still race between the final read and batch commit. The UI prevents overlapping local actions but is not a distributed lock. Shared concurrent editing would require a serialized write service or transactional database before promising stronger conflict guarantees. Audit and data are atomic within each submitted batch; that does not make the preceding read atomic with the write.

## Basin follow-on

This release establishes record correction and migration mechanics. It does not assign basins or reinterpret evidence zones. A subsequent explicit schema migration should add BASINS and basin-assignment records with permanent IDs, assignment type (home community, property location, operational activity), dates/uncertainty, citations and reasons. Do not overload existing zone fields or relocate a person's home community because of a battle location. Unknown basin fields currently produce validation errors, making missing schema visible rather than losing data.

## Verification

Run `npm test`. Ten automated tests pass, covering the Indiantown reassignment/deletion cases, blank dates, migration preserving values, collision-resistant IDs, legacy overwrite behavior, references, duplicates, stale/tampered previews, replay, recovery and atomic-request failure. The earlier 19-update import also passes the planner against the downloaded spreadsheet snapshot. Browser validation remains pending: the test browser download timed out in the implementation environment. Before merging, check the admin preview, input invalidation, apply, ID preparation and audit restore controls in a browser. Live Google/Netlify integration requires a deployed preview with credentials and an isolated test spreadsheet. The production spreadsheet must not be used as a test fixture.

Google API basis: https://developers.google.com/workspace/sheets/api/guides/batchupdate
