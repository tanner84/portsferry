/**
 * basin-geometry.js — dependency-free GeoJSON point-in-polygon helpers
 * Shared by the browser layer and Node tests.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PFBasinGeometry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPSILON = 1e-10;

  function _pointOnSegment(point, start, end) {
    const [x, y] = point;
    const [x1, y1] = start;
    const [x2, y2] = end;
    const cross = (y - y1) * (x2 - x1) - (x - x1) * (y2 - y1);
    if (Math.abs(cross) > EPSILON) return false;

    return x >= Math.min(x1, x2) - EPSILON &&
      x <= Math.max(x1, x2) + EPSILON &&
      y >= Math.min(y1, y2) - EPSILON &&
      y <= Math.max(y1, y2) + EPSILON;
  }

  function pointInRing(point, ring) {
    if (!Array.isArray(ring) || ring.length < 4) return false;
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const start = ring[j];
      const end = ring[i];
      if (_pointOnSegment(point, start, end)) return true;

      const intersects = (end[1] > y) !== (start[1] > y) &&
        x < ((start[0] - end[0]) * (y - end[1])) / (start[1] - end[1]) + end[0];
      if (intersects) inside = !inside;
    }

    return inside;
  }

  function pointInPolygon(point, rings) {
    if (!Array.isArray(rings) || !rings.length || !pointInRing(point, rings[0])) {
      return false;
    }
    return !rings.slice(1).some(hole => pointInRing(point, hole));
  }

  function containsCoordinate(feature, lat, lng) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!feature?.geometry || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return false;
    }

    const point = [longitude, latitude];
    const { type, coordinates } = feature.geometry;
    if (type === 'Polygon') return pointInPolygon(point, coordinates);
    if (type === 'MultiPolygon') {
      return coordinates.some(polygon => pointInPolygon(point, polygon));
    }
    return false;
  }

  function findFeature(collection, lat, lng) {
    if (!Array.isArray(collection?.features)) return null;
    return collection.features.find(feature => containsCoordinate(feature, lat, lng)) || null;
  }

  return Object.freeze({
    containsCoordinate,
    findFeature,
    pointInPolygon,
    pointInRing,
  });
}));

