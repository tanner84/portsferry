/**
 * network.js — IND_IND social network edge rendering
 * Ports Ferry Narrative GIS
 *
 * Draws polylines on the map for each social tie attached to the
 * currently-selected individual, styled by relationship type.
 */

window.PF = window.PF || {};
PF.network = {};

/* ================================================================
   Relationship type → polyline style
   Extend this table as new relationship types are added to IND_IND.
   ================================================================ */
const EDGE_STYLES = {
  kin:        { color: '#8a6b3a', weight: 1.8, opacity: 0.75, dashArray: null },
  sibling:    { color: '#8a6b3a', weight: 2,   opacity: 0.80, dashArray: null },
  spouse:     { color: '#8a6b3a', weight: 2,   opacity: 0.80, dashArray: null },
  military:   { color: '#b03020', weight: 1.8, opacity: 0.65, dashArray: '5 3' },
  congregant: { color: '#6b5528', weight: 1.2, opacity: 0.55, dashArray: '2 4' },
  business:   { color: '#1f5f96', weight: 1.5, opacity: 0.55, dashArray: '6 3' },
  neighbor:   { color: '#555',    weight: 1,   opacity: 0.40, dashArray: '2 5' },
  witness:    { color: '#5a8060', weight: 1.2, opacity: 0.50, dashArray: '3 4' },
  _default:   { color: '#777',    weight: 1,   opacity: 0.35, dashArray: null },
};

/**
 * Draw all network edges for a given individual (by ind_id).
 * Clears any previous network overlay first.
 * Lines run from the focal individual to each neighbor.
 *
 * @param {string} ind_id
 */
PF.network.renderForIndividual = function (ind_id) {
  PF.map.layers.network.clearLayers();

  const focal = PF.data.getIndividualById(ind_id);
  if (!focal) return;

  const fLat = PF.data._parseCoord(focal.lat);
  const fLng = PF.data._parseCoord(focal.lng);
  if (fLat === null || fLng === null) return;

  const neighbors = PF.data.getNetworkNeighbors(ind_id);
  if (neighbors.length === 0) return;

  neighbors.forEach(({ individual: neighbor, relationship }) => {
    const nLat = PF.data._parseCoord(neighbor.lat);
    const nLng = PF.data._parseCoord(neighbor.lng);
    if (nLat === null || nLng === null) return;

    const relKey = (relationship || '').toLowerCase().trim();
    const style  = EDGE_STYLES[relKey] || EDGE_STYLES._default;

    const line = L.polyline(
      [[fLat, fLng], [nLat, nLng]],
      {
        color:     style.color,
        weight:    style.weight,
        opacity:   style.opacity,
        dashArray: style.dashArray,
        interactive: true,
      }
    );

    line.bindTooltip(
      `${_netEsc(focal.full_name || '?')} ↔ ${_netEsc(neighbor.full_name || '?')}` +
      `<br><em>${_netEsc(relationship || 'connection')}</em>`,
      { sticky: true, className: 'pf-tooltip' }
    );

    /* Click edge → open the neighbor's record */
    line.on('click', () => {
      PF.panels.showIndividual(neighbor);
      PF.network.renderForIndividual(neighbor.ind_id);
    });

    PF.map.layers.network.addLayer(line);
  });
};

/**
 * Remove all network edges from the map.
 */
PF.network.clear = function () {
  if (PF.map.layers && PF.map.layers.network) {
    PF.map.layers.network.clearLayers();
  }
};

function _netEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
