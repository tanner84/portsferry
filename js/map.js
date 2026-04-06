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

  /* ── David Rumsey tile endpoint ─────────────────────────────────
     TODO: Replace RUMSEY_TILE_URL_PLACEHOLDER with the actual tile URL.
     The Rumsey WMTS / tile endpoint format is typically one of:
       a) Via GeoReferencer (map-specific):
          https://maps.georeferencer.com/georeferences/{ID}/YYYY-MM-DDTHHMMSSZ/map/{z}/{x}/{y}.png?key={KEY}
       b) Via Rumsey's own WMTS service:
          https://rumsey.geogarage.com/maps/{mapID}/map/{z}/{x}/{y}.png
     Supply the correct URL for the period map you have selected
     (e.g., the Price & Strother 1808 NC map or the Mouzon 1775 map).
     ─────────────────────────────────────────────────────────────── */
  rumseyTileURL:       'RUMSEY_TILE_URL_PLACEHOLDER',
  rumseyAttribution:   'Historical map tiles: <a href="https://www.davidrumsey.com" target="_blank" rel="noopener">David Rumsey Map Collection</a>',
  rumseyOpacity:       0.85,

  /* OSM fallback */
  osmTileURL:         'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  osmAttribution:     '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

/* Affiliation → marker fill color */
const PIN_COLORS = {
  Loyalist:  '#b03020',
  loyalist:  '#b03020',
  Patriot:   '#1f5f96',
  patriot:   '#1f5f96',
  Unknown:   '#6e6e72',
  unknown:   '#6e6e72',
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
  const color = PIN_COLORS[individual.affiliation] || PIN_COLORS.unknown;
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
 */
PF.map.makeChurchIcon = function () {
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
 * @param {Array} churches — CHURCHES rows
 */
PF.map.renderChurches = function (churches) {
  PF.map.layers.churches.clearLayers();

  churches.forEach(ch => {
    const lat = PF.data._parseCoord(ch.lat);
    const lng = PF.data._parseCoord(ch.lng);
    if (lat === null || lng === null) return;

    const marker = L.marker([lat, lng], {
      icon:  PF.map.makeChurchIcon(),
      title: ch.name || '',
      zIndexOffset: 100,
    });

    marker.bindTooltip(
      `<strong>${_mapEsc(ch.name || 'Church')}</strong>` +
      `<br>${_mapEsc(ch.denomination || '')} · est. ${ch.founded_yr || '?'}`,
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

    const color = PIN_COLORS[ind.affiliation] || PIN_COLORS.unknown;

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

/* Internal HTML escape for tooltip strings */
function _mapEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
