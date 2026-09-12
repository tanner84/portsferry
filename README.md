# Ports Ferry — Narrative GIS

**A digital history of the Highland Scots Loyalist community at Cross Creek, Cumberland County, NC, 1758–1783**

PhD dissertation research infrastructure. Deployed at [portsferry.com](https://portsferry.com).

---

## Architecture

Pure static site — no build step, no server, no bundler. Deployable to Netlify free tier directly from this repository.

| Layer | Technology |
|---|---|
| Map engine | Leaflet.js 1.9.4 |
| Historical base tiles | David Rumsey georeferenced maps (tile URL configured in `js/map.js`) |
| Modern fallback tiles | OpenStreetMap |
| Operational basin layer | Four dissolved USGS WBD polygons with coordinate-derived assignment |
| Database | Google Sheets (public JSON via Sheets API v4) |
| Timeline | Custom range slider + Leaflet.TimeDimension (loaded for Phase 3) |
| Network graph | IND_IND junction table → Leaflet polylines |
| Route animation | Leaflet.Motion (Phase 3) |
| KMZ support | Leaflet Omnivore (Phase 3) |
| Document hosting | Cloudinary or Google Drive (URLs stored in SOURCES sheet) |

## Repository structure

```
portsferry/
├── index.html            Main application shell
├── netlify.toml          Netlify deployment config
├── .gitignore
├── css/
│   └── style.css         All styles — dark map, light panels, EB Garamond prose
├── js/
│   ├── app.js            Entry point — startup orchestration
│   ├── data.js           Google Sheets loader + client-side query API
│   ├── map.js            Leaflet initialization, tile layers, markers
│   ├── basins.js         River-basin overlay, legend, labels, lookups
│   ├── basin-geometry.js Point-in-polygon helper
│   ├── network.js        IND_IND social network edge rendering
│   ├── timeline.js       Timeline slider, date-driven layer refresh
│   └── panels.js         Left browser, right story panel, source tray
└── data/
    ├── gis/              Generated USGS WBD river-basin GeoJSON
    └── seed/             Prototype seed data (JSON) used when Sheets not configured
        ├── individuals.json
        ├── churches.json
        ├── events.json
        ├── sources.json
        ├── battles.json
        ├── ind_ind.json        Network edges
        ├── ind_church.json     Church membership
        └── [9 stub files]      Remaining sheets — populate as research progresses
```

## Configuration

Before connecting live data, set two values:

### 1. Google Sheets ID — `js/data.js`

```js
const SHEETS_CONFIG = {
  SHEETS_ID: 'YOUR_SHEETS_ID_HERE',   // ← replace
  API_KEY:   'YOUR_API_KEY_HERE',     // ← replace
  ...
};
```

The Sheets ID is in the document URL:
`https://docs.google.com/spreadsheets/d/**SHEETS_ID**/edit`

Create a Google Cloud API key restricted to:
- Sheets API v4
- HTTP referrers: `portsferry.com`, `*.netlify.app`, `localhost`

### 2. David Rumsey tile URL — `js/map.js`

```js
const MAP_CONFIG = {
  rumseyTileURL: 'RUMSEY_TILE_URL_PLACEHOLDER',   // ← replace
  ...
};
```

Provide the WMTS or tile endpoint for your selected period map
(e.g., Mouzon 1775 or Price & Strother 1808).

---

## Google Sheets database schema

The spreadsheet must have exactly these 14 sheet tabs (case-sensitive):

### Core entity sheets

| Sheet | Key fields |
|---|---|
| INDIVIDUALS | ind_id, full_name, birth_year, death_year, lat, lng, affiliation, tier, rank, evidence_type, battles_present, pension_filed, source_ids, date_from, date_to |
| CHURCHES | ch_id, name, denomination, lat, lng, founded_yr, status, record_repository, source_ids |
| PROPERTIES | prop_id, name, owner_id, lat, lng, type, acreage, grant_year, source_ids |
| UNITS | unit_id, name, side, commander_id, formed_date, disbanded_date, source_ids |
| EVENTS | evt_id, name, type, date, lat, lng, description, source_ids |
| SOURCES | src_id, title, type, repository, digitized, url, record_system, zone, evidence_type |
| BATTLES | battle_id, name, date, lat, lng, location, description, source_ids |
| UNIT_POSITIONS | pos_id, unit_id, battle_id, phase, lat, lng, notes |
| BATTLE_PARTICIPANTS | bp_id, battle_id, unit_id, side, role, source_ids |

### Junction sheets

| Sheet | Key fields |
|---|---|
| IND_CHURCH | link_id, ind_id, ch_id, role, date_from, date_to, source_ids |
| IND_UNIT | link_id, ind_id, unit_id, rank, date_from, date_to, source_ids |
| IND_PROPERTY | link_id, ind_id, prop_id, relationship, source_ids |
| IND_IND | edge_id, ind_id_a, ind_id_b, relationship, source_ids, notes |
| EVT_LINKS | link_id, evt_id, entity_type, entity_id, role, source_ids |

**Multi-value fields** use pipe delimiter: `src_001|src_002|src_003`

**Tier values**: `Command` (BG/Col/LTC), `Company` (Major/Capt/Lt), `Exception` (non-military public figures)

**Affiliation values**: `Loyalist`, `Patriot`, `Unknown`

**Evidence zones**: 1 = primary archival, 2 = primary published, 3 = secondary, 4 = inferred/oral

---

## Safe admin corrections

The admin ingest box accepts a correction array as well as ordinary new-entry JSON:

```json
[
  {
    "entry_type": "IND_CHURCH",
    "operation": "reassign",
    "record_id": "ich_040",
    "reason": "Source-qualified correction",
    "changes": {
      "ind_id": "ind_112",
      "date_from": ""
    }
  }
]
```

Supported operations are `update`, `reassign`, and `delete`. Relationship corrections are located by their stable `link_id` or `edge_id`, never a sheet row number or a changeable person/church/date combination. Validation loads the live row, checks referenced entities, and displays a before → after preview. Apply rechecks the complete original row; if it changed after preview, the entire batch is rejected with no writes. Updates, deletions, and their full before/after audit record are submitted in one Google Sheets batch.

The four pending Indiantown manual operations are staged in `data/corrections/indiantown-manual-corrections.json`. Staged means ready to preview, not applied.

---

## Deployment

### Initial setup (one time)

```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/portsferry.git
git add .
git commit -m "Initial repository structure"
git push -u origin main
```

Connect the repository in the Netlify dashboard. Set publish directory to `.` (repository root). No build command.

### Subsequent deploys

```bash
git add -p          # stage changes selectively
git commit -m "..."
git push
```

Netlify deploys automatically on push to `main`.

---

## Four map views

| View | Trigger | What renders |
|---|---|---|
| **Church** | Click church pin | Congregation assembles spatially; affiliation breakdown in panel |
| **Individual** | Click person pin | Property, parish, unit area; social network edges from IND_IND |
| **Unit** | Unit view mode | Company commanders as pins; churches that fed the unit |
| **Battle** | Click battle marker | Unit positions per phase; commanders cross-referenced to community network |

## Operational river basins

The map's GIS layer control includes four modern hydrologic reference polygons:
Cape Fear, Pee Dee, Santee, and Charleston Harbor / Lowcountry. Checking the
layer fits the map to the full framework; hovering identifies a basin and
clicking explains its research scope and source. Entity tooltips derive their
basin from coordinates against the same polygons rather than a manually entered
zone.

The bundled geometry comes from the USGS Watershed Boundary Dataset and can be
regenerated with `npm run gis:basins`. Santee and Cooper boundaries carry an
explicit caveat because the modern WBD reflects the Santee–Cooper diversion and
later impoundments. See `data/gis/README.md` for the exact HUC aggregation.

---

## Data flags

- `COORDINATES ARE APPROXIMATE` in a `note` field = verify before publication
- `evidence_type: Inferred` = assertion requires explicit caveat in narrative prose
- `digitized: N` in SOURCES = document not yet accessible remotely

---

## Seed data included

Prototype individuals: Donald MacDonald (BG), Donald MacLeod (LTC), Allan MacDonald, Flora MacDonald, Thomas Rutherford (Col), Alexander McAlister (LTC), Duncan McNeill (1st Maj), Alexander McDonald (2nd Maj).

Anchor church: Old Bluff / Bluff Presbyterian Church (~35.1833, -78.7167 — coordinates require verification).

Anchor battle: Moore's Creek Bridge, Feb. 27, 1776 (34.4600, -78.1092).

Sources: 8 seed records spanning TNA, NRS, NCSA, NCCR, PHS.

---

*Research infrastructure for a PhD dissertation on the Highland Scots Loyalist community of Cross Creek, Cumberland County, NC, during the American Revolution.*
