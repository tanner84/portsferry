/**
 * basins.js — USGS Watershed Boundary Dataset overlay
 * Port's Ferry Narrative GIS
 *
 * Research-region boundaries are derived from official WBD hydrologic units,
 * not hand-drawn polygons. The four displayed regions intentionally mix WBD
 * hierarchy levels because the dissertation's chapter regions do not map to
 * one uniform HUC level:
 *   - Cape Fear: HUC4 0303
 *   - Pee Dee: HUC4 0304
 *   - Santee: HUC6 030501
 *   - Charleston Harbor / Lowcountry: HUC8 03050201 + 03050202
 *
 * WBD is modern hydrology. It is a spatial reference layer, not evidence that
 * every 1775 drainage feature matched the modern geometry. The Mouzon layer is
 * the historical check, especially around the Santee-Cooper system.
 */

window.PF = window.PF || {};
PF.basins = PF.basins || {};

PF.basins.SERVICE = 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer';

PF.basins.REGIONS = [
  {
    key: 'cape-fear',
    label: 'Cape Fear',
    layer: 2,
    field: 'huc4',
    codes: ['0303'],
  },
  {
    key: 'pee-dee',
    label: 'Pee Dee',
    layer: 2,
    field: 'huc4',
    codes: ['0304'],
  },
  {
    key: 'santee',
    label: 'Santee',
    layer: 3,
    field: 'huc6',
    codes: ['030501'],
  },
  {
    key: 'charleston-lowcountry',
    label: 'Charleston Harbor / Lowcountry',
    layer: 4,
    field: 'huc8',
    codes: ['03050201', '03050202'],
  },
];

PF.basins._loaded = false;
PF.basins._loading = null;
PF.basins._visible = false;
PF.basins._group = null;
PF.basins._bounds = null;

PF.basins._queryUrl = function (region) {
  const quoted = region.codes.map(code => `'${code}'`).join(',');
  const params = new URLSearchParams({
    where: `${region.field} IN (${quoted})`,
    outFields: `${region.field},name,states`,
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '5',
    f: 'geojson',
  });
  return `${PF.basins.SERVICE}/${region.layer}/query?${params.toString()}`;
};

PF.basins._style = function () {
  return {
    color: '#c39a58',
    weight: 4,
    opacity: 0.95,
    fillColor: '#c39a58',
    fillOpacity: 0.035,
    lineJoin: 'round',
  };
};

PF.basins._esc = function (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

PF.basins._addRegion = function (region, geojson) {
  if (!geojson || !Array.isArray(geojson.features)) {
    throw new Error(`USGS returned invalid GeoJSON for ${region.label}`);
  }

  geojson.features.forEach(feature => {
    feature.properties = feature.properties || {};
    feature.properties.pf_region = region.label;
    feature.properties.pf_region_key = region.key;
    feature.properties.pf_huc_field = region.field;
  });

  const layer = L.geoJSON(geojson, {
    style: PF.basins._style,
    interactive: true,
    onEachFeature: (feature, featureLayer) => {
      const p = feature.properties || {};
      const huc = p[region.field] || '';
      const unitName = p.name || region.label;
      featureLayer.bindTooltip(
        `<strong>${PF.basins._esc(region.label)}</strong>` +
        `<br><span class="basin-tooltip-unit">USGS WBD: ${PF.basins._esc(unitName)}${huc ? ` · ${PF.basins._esc(huc)}` : ''}</span>`,
        { sticky: true, className: 'pf-tooltip basin-tooltip' }
      );
    },
  });

  PF.basins._group.addLayer(layer);
  const bounds = layer.getBounds();
  if (bounds && bounds.isValid()) {
    PF.basins._bounds = PF.basins._bounds
      ? PF.basins._bounds.extend(bounds)
      : L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
  }
};

PF.basins.load = async function () {
  if (PF.basins._loaded) return;
  if (PF.basins._loading) return PF.basins._loading;

  PF.basins._loading = (async () => {
    const results = await Promise.all(PF.basins.REGIONS.map(async region => {
      const response = await fetch(PF.basins._queryUrl(region), {
        headers: { Accept: 'application/geo+json, application/json' },
      });
      if (!response.ok) {
        throw new Error(`${region.label}: USGS WBD request failed (${response.status})`);
      }
      return { region, geojson: await response.json() };
    }));

    results.forEach(({ region, geojson }) => PF.basins._addRegion(region, geojson));
    PF.basins._loaded = true;
    PF.basins._loading = null;
    console.info('[PF.basins] Loaded USGS WBD research regions.');
  })().catch(err => {
    PF.basins._loading = null;
    throw err;
  });

  return PF.basins._loading;
};

PF.basins._setButtonState = function (state, message) {
  const btn = document.getElementById('basin-toggle');
  if (!btn) return;
  btn.classList.toggle('active', state === 'active');
  btn.classList.toggle('loading', state === 'loading');
  btn.setAttribute('aria-pressed', state === 'active' ? 'true' : 'false');
  if (message) btn.title = message;
  btn.textContent = state === 'loading' ? 'Basins…' : 'Basins';
};

PF.basins.show = async function (fitAll) {
  PF.basins._setButtonState('loading', 'Loading USGS Watershed Boundary Dataset…');
  try {
    await PF.basins.load();
    if (!PF.map.instance.hasLayer(PF.basins._group)) {
      PF.basins._group.addTo(PF.map.instance);
    }
    PF.basins._visible = true;
    PF.basins._setButtonState(
      'active',
      'River-basin boundaries from USGS WBD. Shift-click to fit all four research regions.'
    );
    if (fitAll && PF.basins._bounds && PF.basins._bounds.isValid()) {
      PF.map.instance.fitBounds(PF.basins._bounds, { padding: [24, 24], maxZoom: 7 });
    }
  } catch (err) {
    console.error('[PF.basins] Could not load WBD overlay:', err);
    PF.basins._setButtonState('idle', `Basin layer failed: ${err.message}`);
    const btn = document.getElementById('basin-toggle');
    if (btn) btn.classList.add('error');
  }
};

PF.basins.hide = function () {
  if (PF.basins._group && PF.map.instance.hasLayer(PF.basins._group)) {
    PF.map.instance.removeLayer(PF.basins._group);
  }
  PF.basins._visible = false;
  PF.basins._setButtonState(
    'idle',
    'Toggle river-basin boundaries from the USGS Watershed Boundary Dataset.'
  );
};

PF.basins.toggle = function (event) {
  const fitAll = !!(event && event.shiftKey);
  if (PF.basins._visible) {
    PF.basins.hide();
  } else {
    PF.basins.show(fitAll);
  }
};

PF.basins.init = function () {
  PF.basins._group = L.layerGroup();
  const btn = document.getElementById('basin-toggle');
  if (!btn) return;
  btn.addEventListener('click', PF.basins.toggle);
  PF.basins._setButtonState(
    'idle',
    'Toggle river-basin boundaries from the USGS Watershed Boundary Dataset. Shift-click to fit all regions.'
  );
};
