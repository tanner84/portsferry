/**
 * basins.js — four-basin operational geography overlay
 * Geometry: locally bundled USGS Watershed Boundary Dataset derivative.
 */

window.PF = window.PF || {};
PF.basins = {
  data: null,
  layer: null,
  _legend: null,
  _fitOnFirstShow: true,
};

const BASIN_DATA_URL = 'data/gis/river-basins.geojson';
const BASIN_SOURCE_URL = 'https://www.usgs.gov/national-hydrography/watershed-boundary-dataset';

PF.basins.init = async function () {
  try {
    if (!window.PFBasinGeometry) {
      throw new Error('Basin geometry helper did not load');
    }

    const response = await fetch(BASIN_DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.type !== 'FeatureCollection' || data.features?.length !== 4) {
      throw new Error('Expected a four-feature basin GeoJSON collection');
    }

    PF.basins.data = data;

    if (!PF.map.instance.getPane('riverBasinsPane')) {
      const pane = PF.map.instance.createPane('riverBasinsPane');
      pane.style.zIndex = '330';
      pane.style.pointerEvents = 'auto';
    }
    if (!PF.map.instance.getPane('riverBasinLabelsPane')) {
      const labelPane = PF.map.instance.createPane('riverBasinLabelsPane');
      labelPane.style.zIndex = '340';
      labelPane.style.pointerEvents = 'none';
    }

    let boundaryLayer;
    boundaryLayer = L.geoJSON(data, {
      pane: 'riverBasinsPane',
      smoothFactor: 1.25,
      style: feature => PF.basins._style(feature),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(PF.basins._popup(feature.properties), {
          className: 'river-basin-popup',
          maxWidth: 340,
        });
        layer.bindTooltip(feature.properties.basin_name, {
          sticky: true,
          className: 'pf-tooltip river-basin-hover-label',
        });
        layer.on({
          mouseover: event => {
            event.target.setStyle({
              weight: 6,
              fillOpacity: 0.18,
              opacity: 1,
            });
            event.target.bringToFront();
          },
          mouseout: event => boundaryLayer.resetStyle(event.target),
        });
      },
    });

    const labels = L.layerGroup();
    data.features.forEach(feature => {
      const properties = feature.properties;
      L.marker([properties.label_lat, properties.label_lng], {
        pane: 'riverBasinLabelsPane',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'river-basin-label-marker',
          html: `<span style="--basin-color:${properties.color}">${PF.basins._escape(properties.basin_name)}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      }).addTo(labels);
    });

    PF.basins.layer = L.featureGroup([boundaryLayer, labels]);
    PF.map.layers.basins = PF.basins.layer;
    PF.map.registerOverlay(PF.basins.layer, 'Operational river basins <small>USGS WBD</small>');
    PF.basins._legend = PF.basins._createLegend(data.features);

    PF.map.instance.on('overlayadd', event => {
      if (event.layer !== PF.basins.layer) return;
      PF.basins._showLegend();
      if (PF.basins._fitOnFirstShow) {
        PF.basins._fitOnFirstShow = false;
        PF.map.instance.fitBounds(PF.basins.layer.getBounds(), {
          padding: [24, 24],
          maxZoom: 7,
          animate: true,
          duration: 0.65,
        });
      }
    });

    PF.map.instance.on('overlayremove', event => {
      if (event.layer === PF.basins.layer) PF.basins._hideLegend();
    });

    console.info('[PF.basins] River basin layer ready.', {
      basins: data.features.length,
      source: data.metadata?.source_dataset,
      sourceRefreshed: data.metadata?.source_refreshed,
    });
    return true;
  } catch (error) {
    console.warn('[PF.basins] River basin layer failed to load:', error.message);
    return false;
  }
};

PF.basins.lookup = function (lat, lng) {
  const feature = window.PFBasinGeometry?.findFeature(PF.basins.data, lat, lng);
  return feature ? feature.properties : null;
};

PF.basins._style = function (feature) {
  const color = feature.properties?.color || '#5b718c';
  return {
    pane: 'riverBasinsPane',
    color,
    weight: 4.5,
    opacity: 0.92,
    fillColor: color,
    fillOpacity: 0.1,
    lineCap: 'round',
    lineJoin: 'round',
  };
};

PF.basins._popup = function (properties) {
  const area = Math.round(Number(properties.area_sq_km || 0)).toLocaleString('en-US');
  const unitLabel = Number(properties.component_count) === 1 ? 'WBD subbasin' : 'WBD subbasins';
  return `
    <article class="river-basin-popup-content">
      <h3 style="--basin-color:${properties.color}">${PF.basins._escape(properties.basin_name)}</h3>
      <p>${PF.basins._escape(properties.scope)}</p>
      <dl>
        <div><dt>Modern area</dt><dd>${area} km²</dd></div>
        <div><dt>Geometry</dt><dd>${properties.component_count} ${unitLabel}</dd></div>
      </dl>
      <p class="river-basin-caveat">${PF.basins._escape(properties.historical_note)}</p>
      <a href="${BASIN_SOURCE_URL}" target="_blank" rel="noopener">USGS Watershed Boundary Dataset ↗</a>
    </article>`;
};

PF.basins._createLegend = function (features) {
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const container = L.DomUtil.create('section', 'river-basin-legend');
    container.setAttribute('aria-label', 'Operational river basin legend');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    container.innerHTML = `
      <strong>Operational river basins</strong>
      <ul>${features.map(feature => `
        <li><span style="--basin-color:${feature.properties.color}"></span>${PF.basins._escape(feature.properties.basin_name)}</li>
      `).join('')}</ul>
      <small>Modern USGS WBD boundaries</small>`;
    return container;
  };
  return legend;
};

PF.basins._showLegend = function () {
  if (!PF.basins._legend || PF.basins._legend._map) return;
  PF.basins._legend.addTo(PF.map.instance);
};

PF.basins._hideLegend = function () {
  if (PF.basins._legend?._map) PF.map.instance.removeControl(PF.basins._legend);
};

PF.basins._escape = function (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

