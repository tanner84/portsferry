/**
 * map.js — Leaflet map initialization and marker management
 * Ports Ferry Narrative GIS
 */

window.PF = window.PF || {};
PF.map = {};

/* ================================================================
   CONFIGURATION
   ================================================================ */
const MAP_CONFIG = {
  /* Cumberland County, NC — approximate centroid */
  center: [35.05, -78.88],
  zoom:   10,
  minZoom: 6,
  maxZoom: 18,

  /* ── Historic map tile layer (MapWarper georectification) ──────
     Romans 1776 "A General Map of the Southern British Colonies"
     Georectified via MapWarper: https://mapwarper.net/maps/105527
     ─────────────────────────────────────────────────────────────── */
  rumseyTileURL:       'https://mapwarper.net/maps/tile/84681/{z}/{x}/{y}.png',
  rumseyAttribution:   'Historical map: <a href="https://mapwarper.net/maps/84681" target="_blank" rel="noopener">Historic map, via MapWarper</a>',
  rumseyOpacity:       0.85,

  /* OSM fallback */
  osmTileURL:         'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  osmAttribution:     '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

/* ================================================================
   Affiliation → marker fill color
   Ten-category taxonomy. Keys are stored affiliation field values
   (canonical mixed-case + lowercase for lookup safety).
   CSS custom properties in style.css must match these values exactly.
   ================================================================ */
const PIN_COLORS = {
  /* Patriot side — blue spectrum */
  'Continental Army':     '#1a3a6b',
  'continental army':     '#1a3a6b',
  'State Line':           '#2e6da4',
  'state line':           '#2e6da4',
  'Patriot Militia':      '#5b9bd5',
  'patriot militia':      '#5b9bd5',
  'Patriot Volunteer':    '#a8c8e8',
  'patriot volunteer':    '#a8c8e8',

  /* Loyalist / British side — red spectrum */
  'British Regular':      '#6b1a1a',
  'british regular':      '#6b1a1a',
  'Provincial Corps':     '#a43232',
  'provincial corps':     '#a43232',
  'Loyalist Militia':     '#c45c5c',
  'loyalist militia':     '#c45c5c',
  'Associated Loyalist':  '#d89090',
  'associated loyalist':  '#d89090',

  /* Neutral / Unknown */
  'Unknown':              '#888888',
  'unknown':              '#888888',
  'Neutral':              '#b8a882',
  'neutral':              '#b8a882',

  /* Legacy aliases — old seed data used bare "Loyalist" / "Patriot".
     Map to Loyalist Militia / Patriot Militia respectively.
     Remove once seed data and Sheets are updated to full taxonomy. */
  'Loyalist':             '#c45c5c',
  'loyalist':             '#c45c5c',
  'Patriot':              '#5b9bd5',
  'patriot':              '#5b9bd5',
};

/* Tier → pin size (diameter px) */
const PIN_SIZES = {
  Command:   15,
  Company:   10,
  Exception: 13,
};

/* ================================================================
   Initialization
   ================================================================ */
PF.map.init = function () {
  /* ── Base tile layers ───────────────────────────────────────── */
  const osmLayer = L.tileLayer(MAP_CONFIG.osmTileURL, {
    attribution: MAP_CONFIG.osmAttribution,
    maxZoom:     MAP_CONFIG.maxZoom,
  });

  const rumseyConfigured = MAP_CONFIG.rumseyTileURL !== 'RUMSEY_TILE_URL_PLACEHOLDER';

  const rumseyLayer = rumseyConfigured
    ? L.tileLayer(MAP_CONFIG.rumseyTileURL, {
        attribution: MAP_CONFIG.rumseyAttribution,
        maxZoom:     MAP_CONFIG.maxZoom,
        opacity:     MAP_CONFIG.rumseyOpacity,
      })
    : L.tileLayer(MAP_CONFIG.osmTileURL, {
        attribution:
          MAP_CONFIG.osmAttribution +
          ' &nbsp;|&nbsp; <em style="color:#aaa">Rumsey tile URL not yet configured</em>',
        maxZoom: MAP_CONFIG.maxZoom,
      });

  if (!rumseyConfigured) {
    console.info('[PF.map] Rumsey tile URL not configured — using OSM as placeholder. ' +
                 'Set MAP_CONFIG.rumseyTileURL in js/map.js once you have the endpoint.');
  }

  /* ── Map instance ───────────────────────────────────────────── */
  PF.map.instance = L.map('map', {
    center:     MAP_CONFIG.center,
    zoom:       MAP_CONFIG.zoom,
    minZoom:    MAP_CONFIG.minZoom,
    maxZoom:    MAP_CONFIG.maxZoom,
    layers:     [rumseyLayer],
    zoomControl: false,          // repositioned below to avoid panel overlap
  });

  L.control.zoom({ position: 'topright' }).addTo(PF.map.instance);

  /* ── Data layer groups ──────────────────────────────────────── */
  PF.map.layers = {
    rumsey:      rumseyLayer,
    osm:         osmLayer,
    churches:    L.layerGroup().addTo(PF.map.instance),
    individuals: L.layerGroup().addTo(PF.map.instance),
    network:     L.layerGroup().addTo(PF.map.instance),
    assembly:    L.layerGroup().addTo(PF.map.instance),
    routes:      L.layerGroup().addTo(PF.map.instance),
  };

  PF.map._activeBase = 'rumsey';

  /* ── Layer toggle button ────────────────────────────────────── */
  document.getElementById('layer-toggle').addEventListener('click', PF.map.toggleBaseLayer);

  /* ── Church burned-state sync on timeline tick ──────────────────
     timeline.js documents: "Other modules subscribe by replacing or
     wrapping this function." We wrap _onDateChange here so church
     markers update in real time as the slider moves, without touching
     any other module.
     Churches are re-rendered only when the church layer is actively
     shown (i.e. not in individual-only view and not in battle mode). */
  const _origOnDateChange = PF.timeline._onDateChange;
  PF.timeline._onDateChange = function (date) {
    _origOnDateChange.call(this, date);
    const inBattle = PF.battle && PF.battle._active;
    const view     = PF.panels && PF.panels._currentView;
    /* Suppress individual markers outside individual view —
       _origOnDateChange always calls renderIndividuals; undo it here. */
    if (view !== 'individual') {
      PF.map.layers.individuals.clearLayers();
    }
    if (!inBattle && view !== 'individual') {
      PF.map.renderChurches(PF.data.getMappableChurches(), date);
    }
  };

  console.info('[PF.map] Map initialized. Center:', MAP_CONFIG.center, 'Zoom:', MAP_CONFIG.zoom);
};

/* ================================================================
   Base layer toggle
   ================================================================ */
PF.map.toggleBaseLayer = function () {
  const { instance, layers, _activeBase } = PF.map;
  const btn = document.getElementById('layer-toggle');

  if (_activeBase === 'rumsey') {
    instance.removeLayer(layers.rumsey);
    instance.addLayer(layers.osm);
    PF.map._activeBase = 'osm';
    btn.textContent = 'Rumsey / OSM';
  } else {
    instance.removeLayer(layers.osm);
    instance.addLayer(layers.rumsey);
    PF.map._activeBase = 'rumsey';
    btn.textContent = 'OSM / Rumsey';
  }
};

/* ================================================================
   Marker factories
   ================================================================ */

/**
 * Circular div icon for individuals.
 * Command tier = larger; Exception tier = medium with dashed ring.
 */
PF.map.makeIndividualIcon = function (individual) {
  const color = PF.map.affiliationColor(individual.affiliation);
  const size  = PIN_SIZES[individual.tier] || PIN_SIZES.Company;
  const ring  = individual.tier === 'Exception'
    ? `outline: 2px dashed ${color}; outline-offset: 2px;`
    : '';

  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px; height:${size}px;
      background:${color};
      border: 2px solid rgba(255,255,255,0.55);
      border-radius: 50%;
      box-shadow: 0 1px 5px rgba(0,0,0,0.55);
      ${ring}
    "></div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor:[0, -size / 2 - 2],
  });
};

/**
 * Diamond icon for churches.
 * @param {boolean} [burned=false] — if true, render in destroyed/burned state
 */
PF.map.makeChurchIcon = function (burned) {
  if (burned) {
    /* Charcoal diamond with orange-red border and glow — burned/destroyed */
    return L.divIcon({
      className: '',
      html: `<div style="
        width:11px; height:11px;
        background:#1a0800;
        border: 2px solid #cc4400;
        transform: rotate(45deg);
        box-shadow: 0 0 6px rgba(200,60,0,0.65), 0 1px 3px rgba(0,0,0,0.7);
      "></div>`,
      iconSize:   [11, 11],
      iconAnchor: [5, 5],
      popupAnchor:[0, -8],
    });
  }
  /* Normal standing church */
  return L.divIcon({
    className: '',
    html: `<div style="
      width:11px; height:11px;
      background:#6b5528;
      border: 2px solid rgba(255,255,255,0.6);
      transform: rotate(45deg);
      box-shadow: 0 1px 5px rgba(0,0,0,0.55);
    "></div>`,
    iconSize:   [11, 11],
    iconAnchor: [5, 5],
    popupAnchor:[0, -8],
  });
};

/* ================================================================
   Render methods
   ================================================================ */

/**
 * Render church pins.
 * Clears and rebuilds PF.map.layers.churches.
 * @param {Array}  churches — CHURCHES rows
 * @param {Date}   [date]   — current timeline date; defaults to PF.timeline.currentDate
 */
PF.map.renderChurches = function (churches, date) {
  const currentDate = date || (PF.timeline && PF.timeline.currentDate) || new Date();
  PF.map.layers.churches.clearLayers();

  churches.forEach(ch => {
    const lat = PF.data._parseCoord(ch.lat);
    const lng = PF.data._parseCoord(ch.lng);
    if (lat === null || lng === null) return;

    /* Determine burned state */
    const burnedAt = _parseBurnedDate(ch.burned_date);
    const burned   = burnedAt !== null && currentDate >= burnedAt;

    const marker = L.marker([lat, lng], {
      icon:  PF.map.makeChurchIcon(burned),
      title: ch.name || '',
      zIndexOffset: 100,
    });

    const burnedNote = burned
      ? `<br><em style="color:#e07040">Burned ${_mapEsc(ch.burned_date)}</em>`
      : '';

    marker.bindTooltip(
      `<strong>${_mapEsc(ch.name || 'Church')}</strong>` +
      `<br>${_mapEsc(ch.denomination || '')} · est. ${ch.founded_yr || '?'}` +
      burnedNote,
      { direction: 'top', offset: [0, -10], className: 'pf-tooltip' }
    );

    marker.on('click', () => PF.panels.showChurch(ch));
    PF.map.layers.churches.addLayer(marker);
  });
};

/**
 * Render individual pins for Command, Company, and Exception tier.
 * Clears and rebuilds PF.map.layers.individuals.
 * @param {Array} individuals — INDIVIDUALS rows
 */
PF.map.renderIndividuals = function (individuals) {
  PF.map.layers.individuals.clearLayers();
  PF.map._individualMarkers = new Map();   // ind_id → marker

  const renderTiers = new Set(['Command', 'Company', 'Exception']);

  individuals.forEach(ind => {
    if (!renderTiers.has(ind.tier)) return;

    const lat = PF.data._parseCoord(ind.lat);
    const lng = PF.data._parseCoord(ind.lng);
    if (lat === null || lng === null) return;

    const marker = L.marker([lat, lng], {
      icon:  PF.map.makeIndividualIcon(ind),
      title: ind.full_name || '',
    });

    marker.bindTooltip(
      `<strong>${_mapEsc(ind.full_name || 'Unknown')}</strong>` +
      `<br>${_mapEsc(ind.affiliation || 'Unknown')} · ${_mapEsc(ind.tier || '')}` +
      (ind.rank ? `<br><em>${_mapEsc(ind.rank)}</em>` : ''),
      { direction: 'top', offset: [0, -10], className: 'pf-tooltip' }
    );

    marker.on('click', () => {
      PF.panels.showIndividual(ind);
      PF.network.renderForIndividual(ind.ind_id);
    });

    PF.map.layers.individuals.addLayer(marker);
    PF.map._individualMarkers.set(ind.ind_id, marker);
  });
};

/**
 * Remove specific individual markers from the individuals layer.
 * Used by showChurch to hide congregation members before animation.
 * @param {Set<string>} indIds — set of ind_id values to hide
 */
PF.map.hideIndividuals = function (indIds) {
  if (!PF.map._individualMarkers) return;
  indIds.forEach(id => {
    const marker = PF.map._individualMarkers.get(id);
    if (marker) PF.map.layers.individuals.removeLayer(marker);
  });
};

/* ================================================================
   Map interactions
   ================================================================ */

/**
 * Pan and zoom to a coordinate.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [zoom=13]
 */
PF.map.focusOn = function (lat, lng, zoom) {
  PF.map.instance.setView([lat, lng], zoom || 13, { animate: true, duration: 0.6 });
};

/**
 * Draw a dashed circle around a church to indicate its parish area.
 * Replaces any previous highlight.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radius=2500] metres
 */
PF.map.highlightChurch = function (lat, lng, radius) {
  if (PF.map._churchHighlight) {
    PF.map.instance.removeLayer(PF.map._churchHighlight);
  }
  PF.map._churchHighlight = L.circle([lat, lng], {
    radius:      radius || 2500,
    color:       '#6b5528',
    fillColor:   '#6b5528',
    fillOpacity: 0.05,
    weight:      1.5,
    dashArray:   '5 4',
  }).addTo(PF.map.instance);
};

/**
 * Animate congregation assembly.
 * Fades in member markers, scattered around the church if they
 * have no coordinates of their own, staggered over time.
 *
 * @param {Array}  members    — INDIVIDUALS rows
 * @param {number} churchLat
 * @param {number} churchLng
 */
PF.map.animateAssembly = function (members, churchLat, churchLng) {
  PF.map.layers.assembly.clearLayers();

  members.forEach((ind, i) => {
    let lat = PF.data._parseCoord(ind.lat);
    let lng = PF.data._parseCoord(ind.lng);

    /* Scatter individuals without coords around the church */
    if (lat === null || lng === null) {
      const angle = (i / Math.max(members.length, 1)) * 2 * Math.PI;
      const r     = 0.008 + (i % 5) * 0.004;
      lat = churchLat + r * Math.sin(angle);
      lng = churchLng + r * Math.cos(angle);
    }

    const color = PF.map.affiliationColor(ind.affiliation);

    const marker = L.circleMarker([lat, lng], {
      radius:      5,
      color:       color,
      fillColor:   color,
      fillOpacity: 0,
      weight:      1.5,
      opacity:     0,
    });

    marker.addTo(PF.map.layers.assembly);
    marker.bindTooltip(
      `${_mapEsc(ind.full_name || 'Unknown')}<br><em>${_mapEsc(ind.affiliation || '')}</em>`,
      { className: 'pf-tooltip' }
    );
    marker.on('click', () => PF.panels.showIndividual(ind));

    /* Staggered CSS transition emulated with setTimeout */
    setTimeout(() => {
      marker.setStyle({ fillOpacity: 0.85, opacity: 1 });
    }, i * 45 + 80);
  });
};

/**
 * Clear the assembly animation layer.
 */
PF.map.clearAssembly = function () {
  PF.map.layers.assembly.clearLayers();
};

/* ================================================================
   Property markers — layers.routes
   Square div icons in amber/tan, rendered per selected individual.
   ================================================================ */

const PROPERTY_COLOR = '#c8a86b';

/**
 * Render property markers for the currently-selected individual.
 * Each marker is a small rotated square (distinct from circle pins
 * and church diamonds). All go into layers.routes.
 *
 * @param {Array} propLinks — result of PF.data.getIndividualProperties()
 */
PF.map.renderProperties = function (propLinks) {
  PF.map.layers.routes.clearLayers();
  PF.map._propertyMarkers = new Map();   // prop_id → marker

  propLinks.forEach(({ property, relationship, date_from, date_to }) => {
    const lat = _parseCoord(property.lat);
    const lng = _parseCoord(property.lng);
    if (lat === null || lng === null) return;

    const size = 10;
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        width:${size}px; height:${size}px;
        background:${PROPERTY_COLOR};
        border: 2px solid rgba(255,255,255,0.55);
        transform: rotate(45deg);
        box-shadow: 0 1px 5px rgba(0,0,0,0.55);
        transition: filter 0.15s;
      "></div>`,
      iconSize:    [size, size],
      iconAnchor:  [size / 2, size / 2],
      popupAnchor: [0, -size / 2 - 2],
    });

    const acreageLine = property.acreage
      ? `<br>${_mapEsc(property.acreage)} acres` : '';
    const relLine = relationship
      ? `<br><em>${_mapEsc(relationship)}</em>` : '';

    const marker = L.marker([lat, lng], {
      icon,
      title: property.name || property.prop_id,
      zIndexOffset: 200,
    });

    marker.bindTooltip(
      `<strong>${_mapEsc(property.name || property.prop_id)}</strong>` +
      (property.type ? `<br>${_mapEsc(property.type)}` : '') +
      acreageLine +
      relLine,
      { direction: 'top', offset: [0, -10], className: 'pf-tooltip' }
    );

    marker.on('click', () => PF.panels.showProperty(property, relationship));
    PF.map.layers.routes.addLayer(marker);
    PF.map._propertyMarkers.set(property.prop_id, marker);
  });
};

/**
 * Briefly pulse a property marker to help the user locate it after
 * clicking its row in the story panel.
 * @param {string} prop_id
 */
PF.map.pulseProperty = function (prop_id) {
  if (!PF.map._propertyMarkers) return;
  const marker = PF.map._propertyMarkers.get(prop_id);
  if (!marker) return;
  const el = marker.getElement();
  if (!el) return;
  const inner = el.querySelector('div');
  if (!inner) return;
  inner.style.filter = 'brightness(2.2) drop-shadow(0 0 5px #c8a86b)';
  setTimeout(() => { inner.style.filter = ''; }, 700);
};

/**
 * Remove all property markers from the map.
 */
PF.map.clearProperties = function () {
  PF.map.layers.routes.clearLayers();
};

/* ================================================================
   affiliationClass(str)
   Converts a stored affiliation value to its CSS class slug.
   "Patriot Militia" → "patriot-militia"
   "Continental Army" → "continental-army"
   Unknown values fall back to "unknown".
   Used by panels.js and any module that builds dot/badge classes.
   ================================================================ */
const AFFIL_CLASS_MAP = {
  'Continental Army':     'continental-army',
  'State Line':           'state-line',
  'Patriot Militia':      'patriot-militia',
  'Patriot Volunteer':    'patriot-volunteer',
  'British Regular':      'british-regular',
  'Provincial Corps':     'provincial-corps',
  'Loyalist Militia':     'loyalist-militia',
  'Associated Loyalist':  'associated-loyalist',
  'Unknown':              'unknown',
  'Neutral':              'neutral',
  /* Legacy */
  'Loyalist':             'loyalist-militia',
  'Patriot':              'patriot-militia',
};

PF.map.affiliationClass = function (affiliation) {
  if (!affiliation) return 'unknown';
  return AFFIL_CLASS_MAP[affiliation]
    || AFFIL_CLASS_MAP[affiliation.trim()]
    || affiliation.toLowerCase().replace(/\s+/g, '-');
};

/* Resolve pin color with fallback */
PF.map.affiliationColor = function (affiliation) {
  if (!affiliation) return PIN_COLORS.unknown;
  return PIN_COLORS[affiliation]
    || PIN_COLORS[affiliation.toLowerCase()]
    || PIN_COLORS.unknown;
};

/* Internal HTML escape for tooltip strings */
function _mapEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Parse a burned_date string to a Date object.
 * Accepts: "1779", "1780", "5/1/1779", "April 1781", ISO strings, etc.
 * Always extracts at minimum the year; returns null if unparseable.
 */
function _parseBurnedDate(str) {
  if (!str || !String(str).trim()) return null;
  const s = String(str).trim();

  /* Pure 4-digit year — most common case */
  if (/^\d{4}$/.test(s)) return new Date(parseInt(s, 10), 0, 1);

  /* Try native Date parse (handles "5/1/1779", "April 1, 1781", ISO) */
  const native = new Date(s);
  if (!isNaN(native.getTime()) &&
      native.getFullYear() >= 1600 && native.getFullYear() <= 1900) {
    return native;
  }

  /* Fallback: pull first 4-digit year out of any string ("April 1781") */
  const m = /\b(1[6-9]\d{2})\b/.exec(s);
  if (m) return new Date(parseInt(m[1], 10), 0, 1);

  return null;
}

/* ================================================================
   County Origin Lines — Table 2 Cowpens Network
   Weighted polylines from NC county centroids → Cowpens battlefield.
   Data: data/static/table2_county_coords.json
   Called from app.js after PF.map.init().
   ================================================================ */
PF.map.initCountyOriginLayer = function () {
  const DATA_URL = 'data/static/table2_county_coords.json';

  /* Layer group starts off the map — user toggles it on via the control */
  const countyLayer = L.layerGroup();

  fetch(DATA_URL)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      const battleLat = data.battle_lat;
      const battleLng = data.battle_lng;

      (data.counties || []).forEach(county => {
        const isZone3 = county.zone === 3;
        const isZone4 = county.zone === 4;

        const color     = isZone3 ? '#c0392b' : isZone4 ? '#e67e22' : '#95a5a6';
        const weight    = Math.max(1, county.pensioners / 4);
        const opts      = { color, weight, opacity: 0.85 };
        if (!isZone3 && !isZone4) opts.dashArray = '4,6';

        const line = L.polyline(
          [[county.lat, county.lng], [battleLat, battleLng]],
          opts
        );

        line.bindTooltip(
          `${_mapEsc(county.county)} County — ${county.pensioners} pensioners`,
          { sticky: true, className: 'pf-tooltip' }
        );

        countyLayer.addLayer(line);
      });

      /* Control added only after data loads — no widget appears if fetch fails */
      L.control.layers(null, { 'NC Cowpens Origins (Table 2)': countyLayer }, {
        position:  'bottomright',
        collapsed: false,
      }).addTo(PF.map.instance);

      console.info('[PF.map] County origin layer ready.',
        (data.counties || []).length, 'counties.');
    })
    .catch(err => {
      console.warn('[PF.map] County origin layer: failed to load data:', err.message);
    });
};
