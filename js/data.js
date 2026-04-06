/**
 * data.js — Google Sheets data loader and client-side query engine
 * Ports Ferry Narrative GIS
 *
 * All 14 sheets are fetched on startup via the Sheets API v4 and stored
 * in PF.data.raw. All queries run against the in-memory cache.
 * Falls back to data/seed/*.json if SHEETS_ID is not yet configured.
 */

/* ================================================================
   CONFIGURATION — fill these in before connecting your spreadsheet
   ================================================================

   SHEETS_ID : The document ID from the Google Sheets URL.
               https://docs.google.com/spreadsheets/d/SHEETS_ID/edit

   API_KEY   : A Google Cloud API key restricted to:
               - Sheets API v4
               - HTTP referrers: your Netlify domain + localhost

   Both values must be set before live data will load.
   ================================================================ */
const SHEETS_CONFIG = {
  SHEETS_ID: 'YOUR_SHEETS_ID_HERE',
  API_KEY:   'YOUR_API_KEY_HERE',

  /* Sheet tab names — must match Google Sheets exactly (case-sensitive) */
  SHEET_NAMES: [
    'INDIVIDUALS',
    'CHURCHES',
    'PROPERTIES',
    'UNITS',
    'EVENTS',
    'SOURCES',
    'BATTLES',
    'UNIT_POSITIONS',
    'BATTLE_PARTICIPANTS',
    'IND_CHURCH',
    'IND_UNIT',
    'IND_PROPERTY',
    'IND_IND',
    'EVT_LINKS',
  ],
};

/* ================================================================
   Global namespace
   ================================================================ */
window.PF = window.PF || {};

PF.data = {
  raw:        {},    // { SHEET_NAME: [rowObject, …] }
  loaded:     false,
  loading:    false,
  loadErrors: [],    // [{ sheet, error }]
};

/* ================================================================
   Internal utilities
   ================================================================ */

/**
 * Fetch one sheet from the Sheets API v4.
 * Returns an array of plain objects, using the first row as headers.
 */
async function _fetchSheet(sheetName) {
  const base  = 'https://sheets.googleapis.com/v4/spreadsheets';
  const range = encodeURIComponent(sheetName);
  const url   = `${base}/${SHEETS_CONFIG.SHEETS_ID}/values/${range}?key=${SHEETS_CONFIG.API_KEY}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching sheet "${sheetName}"`);
  }

  const json = await resp.json();
  const rows = json.values || [];
  if (rows.length < 2) return [];          // empty or header-only

  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? String(row[i]).trim() : '';
    });
    return obj;
  });
}

/** Parse a pipe-delimited multi-value field into a trimmed array. */
function _parseList(val) {
  if (!val) return [];
  return String(val).split('|').map(s => s.trim()).filter(Boolean);
}

/** Parse a numeric coordinate; returns null if not a finite number. */
function _parseCoord(val) {
  const n = parseFloat(val);
  return isFinite(n) ? n : null;
}

/* ================================================================
   Loader — public entry point
   ================================================================ */

/**
 * PF.data.load()
 * Fetches all 14 sheets and stores results in PF.data.raw.
 * Uses seed data if SHEETS_ID is not yet configured.
 * Returns a Promise that resolves when loading is complete.
 */
PF.data.load = async function () {
  if (PF.data.loading || PF.data.loaded) return;
  PF.data.loading = true;

  const unconfigured =
    !SHEETS_CONFIG.SHEETS_ID ||
    SHEETS_CONFIG.SHEETS_ID === 'YOUR_SHEETS_ID_HERE';

  if (unconfigured) {
    console.info('[PF.data] SHEETS_ID not configured — loading seed data from data/seed/.');
    await PF.data._loadSeedData();
  } else {
    await PF.data._loadSheets();
  }

  PF.data.loading = false;
  PF.data.loaded  = true;
  console.info('[PF.data] Data load complete.', {
    sheets: Object.keys(PF.data.raw).map(k => `${k}:${PF.data.raw[k].length}`),
    errors: PF.data.loadErrors,
  });
};

/** Fetch all sheets from Google Sheets in parallel. */
PF.data._loadSheets = async function () {
  await Promise.all(
    SHEETS_CONFIG.SHEET_NAMES.map(async name => {
      try {
        PF.data.raw[name] = await _fetchSheet(name);
        console.info(`[PF.data] ${name}: ${PF.data.raw[name].length} rows`);
      } catch (err) {
        console.error(`[PF.data] ${err.message}`);
        PF.data.loadErrors.push({ sheet: name, error: err.message });
        PF.data.raw[name] = [];
      }
    })
  );
};

/** Load seed JSON files from data/seed/ as fallback. */
PF.data._loadSeedData = async function () {
  const seedMap = {
    INDIVIDUALS:        'data/seed/individuals.json',
    CHURCHES:           'data/seed/churches.json',
    PROPERTIES:         'data/seed/properties.json',
    UNITS:              'data/seed/units.json',
    EVENTS:             'data/seed/events.json',
    SOURCES:            'data/seed/sources.json',
    BATTLES:            'data/seed/battles.json',
    UNIT_POSITIONS:     'data/seed/unit_positions.json',
    BATTLE_PARTICIPANTS:'data/seed/battle_participants.json',
    IND_CHURCH:         'data/seed/ind_church.json',
    IND_UNIT:           'data/seed/ind_unit.json',
    IND_PROPERTY:       'data/seed/ind_property.json',
    IND_IND:            'data/seed/ind_ind.json',
    EVT_LINKS:          'data/seed/evt_links.json',
  };

  await Promise.all(
    Object.entries(seedMap).map(async ([sheet, path]) => {
      try {
        const resp = await fetch(path);
        if (resp.ok) {
          PF.data.raw[sheet] = await resp.json();
        } else {
          PF.data.raw[sheet] = [];   // seed file not yet created — normal for stubs
        }
      } catch {
        PF.data.raw[sheet] = [];
      }
    })
  );
};

/* ================================================================
   Query API
   All functions are pure reads against PF.data.raw.
   ================================================================ */

/**
 * Individuals visible at a given date.
 * Visibility is controlled by optional date_from and date_to fields
 * (compared as years). Absence of a bound means open-ended.
 *
 * @param {Date|string} date
 * @returns {Array}
 */
PF.data.getIndividualsByDate = function (date) {
  const year = (date instanceof Date ? date : new Date(date)).getFullYear();
  return (PF.data.raw.INDIVIDUALS || []).filter(ind => {
    const from = ind.date_from ? parseInt(ind.date_from) : null;
    const to   = ind.date_to   ? parseInt(ind.date_to)   : null;
    if (from !== null && year < from) return false;
    if (to   !== null && year > to)   return false;
    return true;
  });
};

/**
 * All individuals with parseable lat/lng coordinates.
 * @returns {Array}
 */
PF.data.getMappableIndividuals = function () {
  return (PF.data.raw.INDIVIDUALS || []).filter(
    ind => _parseCoord(ind.lat) !== null && _parseCoord(ind.lng) !== null
  );
};

/**
 * Church members for a given ch_id (via IND_CHURCH junction).
 * @param {string} ch_id
 * @returns {Array} INDIVIDUALS rows
 */
PF.data.getChurchMembers = function (ch_id) {
  const indIds = new Set(
    (PF.data.raw.IND_CHURCH || [])
      .filter(row => row.ch_id === ch_id)
      .map(row => row.ind_id)
  );
  return (PF.data.raw.INDIVIDUALS || []).filter(ind => indIds.has(ind.ind_id));
};

/**
 * All IND_IND edges involving an individual (either endpoint).
 * @param {string} ind_id
 * @returns {Array} IND_IND rows
 */
PF.data.getNetworkEdges = function (ind_id) {
  return (PF.data.raw.IND_IND || []).filter(
    row => row.ind_id_a === ind_id || row.ind_id_b === ind_id
  );
};

/**
 * Resolved network neighbors with relationship metadata.
 * @param {string} ind_id
 * @returns {Array} [{ individual, relationship, source_ids, edge }]
 */
PF.data.getNetworkNeighbors = function (ind_id) {
  return PF.data.getNetworkEdges(ind_id).reduce((acc, edge) => {
    const otherId = edge.ind_id_a === ind_id ? edge.ind_id_b : edge.ind_id_a;
    const other   = PF.data.getIndividualById(otherId);
    if (other) {
      acc.push({
        individual:   other,
        relationship: edge.relationship || '',
        source_ids:   _parseList(edge.source_ids),
        edge,
      });
    }
    return acc;
  }, []);
};

/**
 * Events filtered by type string.
 * Pass null/undefined to return all events.
 * @param {string|null} type
 * @returns {Array}
 */
PF.data.getEventsByType = function (type) {
  if (!type) return PF.data.raw.EVENTS || [];
  return (PF.data.raw.EVENTS || []).filter(evt => evt.type === type);
};

/**
 * Events within an inclusive year range.
 * @param {number} startYear
 * @param {number} endYear
 * @returns {Array}
 */
PF.data.getEventsByDateRange = function (startYear, endYear) {
  return (PF.data.raw.EVENTS || []).filter(evt => {
    const y = parseInt(evt.date);
    return !isNaN(y) && y >= startYear && y <= endYear;
  });
};

/**
 * Sources by evidence zone (1 = primary archival through 4 = tertiary).
 * @param {number|string} zone
 * @returns {Array}
 */
PF.data.getSourcesByZone = function (zone) {
  return (PF.data.raw.SOURCES || []).filter(src => src.zone === String(zone));
};

/**
 * Unit members at Command/Company/Exception tier.
 * @param {string} unit_id
 * @returns {Array}
 */
PF.data.getUnitMembers = function (unit_id) {
  const indIds = new Set(
    (PF.data.raw.IND_UNIT || [])
      .filter(row => row.unit_id === unit_id)
      .map(row => row.ind_id)
  );
  const commandTiers = new Set(['Command', 'Company', 'Exception']);
  return (PF.data.raw.INDIVIDUALS || []).filter(
    ind => indIds.has(ind.ind_id) && commandTiers.has(ind.tier)
  );
};

/**
 * All churches with parseable lat/lng.
 * @returns {Array}
 */
PF.data.getMappableChurches = function () {
  return (PF.data.raw.CHURCHES || []).filter(
    ch => _parseCoord(ch.lat) !== null && _parseCoord(ch.lng) !== null
  );
};

/* ── Single-record lookups ───────────────────────────────────── */

PF.data.getIndividualById = function (ind_id) {
  return (PF.data.raw.INDIVIDUALS || []).find(r => r.ind_id === ind_id) || null;
};

PF.data.getChurchById = function (ch_id) {
  return (PF.data.raw.CHURCHES || []).find(r => r.ch_id === ch_id) || null;
};

PF.data.getSourceById = function (src_id) {
  return (PF.data.raw.SOURCES || []).find(r => r.src_id === src_id) || null;
};

PF.data.getUnitById = function (unit_id) {
  return (PF.data.raw.UNITS || []).find(r => r.unit_id === unit_id) || null;
};

PF.data.getBattleById = function (battle_id) {
  return (PF.data.raw.BATTLES || []).find(r => r.battle_id === battle_id) || null;
};

/**
 * Resolve source_ids field on any entity row.
 * @param {Object} row — any entity with a source_ids field
 * @returns {Array} SOURCES rows
 */
PF.data.getSourcesForEntity = function (row) {
  if (!row || !row.source_ids) return [];
  return _parseList(row.source_ids)
    .map(id => PF.data.getSourceById(id))
    .filter(Boolean);
};

/**
 * Full-text search across individuals, churches, and events.
 * Minimum 2 characters. Returns up to 20/10/10 results per type.
 *
 * @param {string} query
 * @returns {{ individuals: Array, churches: Array, events: Array }}
 */
PF.data.search = function (query) {
  if (!query || query.length < 2) return { individuals: [], churches: [], events: [] };
  const q = query.toLowerCase();

  return {
    individuals: (PF.data.raw.INDIVIDUALS || [])
      .filter(r => (r.full_name || '').toLowerCase().includes(q))
      .slice(0, 20),
    churches: (PF.data.raw.CHURCHES || [])
      .filter(r => (r.name || '').toLowerCase().includes(q))
      .slice(0, 10),
    events: (PF.data.raw.EVENTS || [])
      .filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      )
      .slice(0, 10),
  };
};

/* ================================================================
   Organizational context queries (used by Step 3 story panel)
   ================================================================ */

/**
 * All IND_UNIT memberships for an individual, sorted by date_from.
 * Most individuals have one; some will have multiple if they
 * changed units or served in multiple capacities.
 *
 * @param {string} ind_id
 * @returns {Array} IND_UNIT rows
 */
PF.data.getUnitMemberships = function (ind_id) {
  return (PF.data.raw.IND_UNIT || [])
    .filter(link => link.ind_id === ind_id)
    .sort((a, b) => (a.date_from || '0') < (b.date_from || '0') ? -1 : 1);
};

/**
 * Command chain for an individual: immediate unit → parent → grandparent → …
 * Returns an object with the primary membership and an ordered unit array
 * (index 0 = closest to the individual).
 *
 * @param {string} ind_id
 * @returns {{ membership: Object|null, chain: Array }}
 */
PF.data.getCommandChain = function (ind_id) {
  const memberships = PF.data.getUnitMemberships(ind_id);
  if (!memberships.length) return { membership: null, chain: [] };

  const membership = memberships[0];   // primary (earliest) unit
  const chain  = [];
  const visited = new Set();
  let currentId = membership.unit_id;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const unit = PF.data.getUnitById(currentId);
    if (!unit) break;
    chain.push(unit);
    currentId = unit.parent_unit || null;
    if (chain.length > 8) break;       // guard against malformed data
  }

  return { membership, chain };
};

/**
 * Lateral coordination edges for an individual.
 * These are IND_IND rows whose relationship type indicates cross-institutional
 * contact rather than kinship or command — the horizontal network layer.
 *
 * Relationship types treated as lateral:
 *   'intelligence contact', 'coordination contact', 'supply contact'
 *
 * @param {string} ind_id
 * @returns {Array} [{ individual, relationship, source_ids, edge }]
 */
PF.data.getLateralCoordination = function (ind_id) {
  const LATERAL = new Set([
    'intelligence contact',
    'coordination contact',
    'supply contact',
  ]);
  return PF.data.getNetworkNeighbors(ind_id).filter(
    ({ relationship }) => LATERAL.has((relationship || '').toLowerCase())
  );
};

/* Expose parse helpers for use in other modules */
PF.data._parseCoord = _parseCoord;
PF.data._parseList  = _parseList;
