# Dated locations and Quincy pilot
Click Follow Quincy, then Play. Next documented stop preserves same-day sequence; Day advances the calendar. Exit Quincy restores the general timeline. The pilot is a bundled, opt-in dataset, not a live Sheets import.

Add these Google Sheets tabs with exactly these headers before importing records:

PLACES: place_id,name,type,lat,lng,uncertainty_m,notes,source_ids,prop_id

IND_LOCATIONS: location_id,ind_id,place_id,date_from,date_to,date_precision,sequence,activity,evidence_status,source_ids,source_page,notes

Use existing person IDs in INDIVIDUALS and stable place IDs. Dates use YYYY-MM-DD; sequence orders observations on a day without inventing clock times. date_to is the last documented day, not an assumed departure. Proposed observations are excluded. Unknown coordinates remain blank. Missing observations retain a last-known label in the pilot; unresolved later stops withhold the marker. The general map resolves IND_LOCATIONS into coordinates rather than moving an individual's permanent record.

Read/write/admin/correction registries accept both tables. The importer now rejects unknown columns rather than discarding them. New spreadsheet tabs require creation before import; code deployment does not create them. Quincy pilot IDs are namespaced and must be reconciled with live individuals before importing.

Quincy source: https://www.colonialsociety.org/node/2791 manuscript pp. 41–42, 80–81. Harbor and town coordinates are approximate editorial reference points with uncertainty circles, not archival surveyed locations. No route is inferred. Peachtree is now the adopted identification of the March 20 stop, based on Tanner Port’s review of Lynch property records. Marked inferred: the journal does not name the property; exact property-record citations remain pending.
