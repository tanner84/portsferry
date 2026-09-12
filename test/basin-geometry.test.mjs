import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const geometry = require('../js/basin-geometry.js');
const data = JSON.parse(await readFile(
  new URL('../data/gis/river-basins.geojson', import.meta.url),
  'utf8'
));

function basinAt(lat, lng) {
  return geometry.findFeature(data, lat, lng)?.properties?.basin_name || null;
}

test('generated WBD layer contains the four agreed operational basins', () => {
  assert.equal(data.type, 'FeatureCollection');
  assert.deepEqual(
    data.features.map(feature => feature.properties.basin_name),
    ['Cape Fear', 'Pee Dee', 'Santee', 'Charleston Harbor / Lowcountry']
  );
  assert.ok(data.features.every(feature =>
    ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)
  ));
});

test('Cape Fear aggregation includes Haw and excludes the separate New River unit', () => {
  const capeFear = data.features.find(feature => feature.properties.basin_id === 'cape-fear');
  const codes = capeFear.properties.source_hucs.split('|');
  assert.ok(codes.includes('03030002'));
  assert.ok(!codes.includes('03030001'));
  assert.equal(codes.length, 6);
});

test('known project coordinates derive the expected operational basin', () => {
  assert.equal(basinAt(35.0527, -78.8784), 'Cape Fear'); // Cross Creek / Fayetteville
  assert.equal(basinAt(36.1320, -79.8430), 'Cape Fear'); // Guilford Courthouse / Haw
  assert.equal(basinAt(34.2465, -80.6070), 'Santee'); // Camden
  assert.equal(basinAt(32.7765, -79.9311), 'Charleston Harbor / Lowcountry');
});

test('coordinates outside the four-basin framework are not manually assigned', () => {
  assert.equal(basinAt(40.7128, -74.0060), null);
});

test('polygon holes are respected and boundary points count as inside', () => {
  const polygon = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
      ],
    },
  };
  assert.equal(geometry.containsCoordinate(polygon, 2, 2), true);
  assert.equal(geometry.containsCoordinate(polygon, 5, 5), false);
  assert.equal(geometry.containsCoordinate(polygon, 0, 5), true);
});

