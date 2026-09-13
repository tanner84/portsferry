import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const mouzon = require('../js/mouzon.js');
const manifest = JSON.parse(await readFile(
  new URL('../data/gis/mouzon-1775.json', import.meta.url),
  'utf8'
));

test('Mouzon manifest preserves the agreed authoritative source and measured fit', () => {
  assert.deepEqual(mouzon.validateManifest(manifest), []);
  assert.equal(manifest.source.digital_item_id, 'agdm:2583');
  assert.deepEqual(manifest.source.source_pixel_size, [11000, 7864]);
  assert.match(manifest.source.record_url, /collections\.lib\.uwm\.edu/);
  assert.equal(manifest.georeferencing.control_point_count, 17);
  assert.equal(manifest.georeferencing.controls.length, 17);
  assert.ok(manifest.georeferencing.fitted_rms_km < 15);
  assert.ok(manifest.georeferencing.maximum_fitted_residual_km < 30);
  assert.match(manifest.georeferencing.use_limit, /Regional historical context only/);
  assert.deepEqual(
    manifest.rendering.excluded_non_geographic_content,
    ['title cartouche', 'Port Royal harbor inset', 'Charlestown harbor inset']
  );
});

test('all sixteen fingerprinted panels exist and match their manifest hashes', async () => {
  assert.deepEqual(manifest.rendering.grid, [4, 4]);
  assert.equal(manifest.panels.length, 16);
  let totalBytes = 0;

  for (const panel of manifest.panels) {
    const path = new URL(`../${panel.url}`, import.meta.url);
    const bytes = await readFile(path);
    const details = await stat(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
    assert.equal(details.size, panel.bytes);
    assert.equal(digest, panel.sha256);
    assert.ok(panel.url.includes(digest.slice(0, 10)));
    totalBytes += details.size;
  }

  // Keep the complete regional backdrop practical on mobile and deploy previews.
  assert.ok(totalBytes < 8 * 1024 * 1024);
});

test('panel bounds form a gap-free 4 by 4 grid', () => {
  const grid = Array.from({ length: 4 }, () => Array(4));
  for (const panel of manifest.panels) {
    const match = /^r(\d)-c(\d)$/.exec(panel.id);
    assert.ok(match, `Unexpected panel id: ${panel.id}`);
    grid[Number(match[1])][Number(match[2])] = panel;
  }

  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const panel = grid[row][column];
      assert.ok(panel, `Missing panel r${row}-c${column}`);
      if (column > 0) {
        assert.equal(grid[row][column - 1].bounds[1][1], panel.bounds[0][1]);
      }
      if (row > 0) {
        assert.equal(grid[row - 1][column].bounds[0][0], panel.bounds[1][0]);
      }
    }
  }
});

test('viewport selection loads only nearby panels', () => {
  const crossCreekView = [-79.05, 34.95, -78.70, 35.18];
  const nearby = mouzon.panelsForBounds(manifest, crossCreekView);
  assert.ok(nearby.length >= 1 && nearby.length <= 4);
  assert.ok(nearby.length < manifest.panels.length);
  assert.equal(mouzon.panelsForBounds(manifest, [-100, 40, -99, 41]).length, 0);
});

test('Leaflet layer fetches the manifest and adds only local viewport images', async () => {
  const originalLeaflet = globalThis.L;
  const originalFetch = globalThis.fetch;
  const requested = [];

  class FakeEvented {
    constructor(...args) {
      this._events = new Map();
      if (typeof this.initialize === 'function') this.initialize(...args);
    }
    on(name, handler) {
      this._events.set(name, handler);
      return this;
    }
    fire(name, detail) {
      this._events.get(name)?.(detail);
      return this;
    }
  }

  class FakeImage extends FakeEvented {
    constructor(url, bounds, options) {
      super();
      this.url = url;
      this.bounds = bounds;
      this.options = options;
    }
    addTo(map) {
      map.layers.add(this);
      return this;
    }
    setOpacity(opacity) {
      this.options.opacity = opacity;
    }
  }

  const fakeMap = {
    layers: new Set(),
    bounds: [-79.05, 34.95, -78.70, 35.18],
    on() {},
    off() {},
    removeLayer(layer) { this.layers.delete(layer); },
    getBounds() {
      const [west, south, east, north] = this.bounds;
      return {
        pad() { return this; },
        getWest: () => west,
        getSouth: () => south,
        getEast: () => east,
        getNorth: () => north,
      };
    },
  };

  globalThis.L = {
    Layer: {
      extend(definition) {
        class Layer extends FakeEvented {}
        Object.assign(Layer.prototype, definition);
        return Layer;
      },
    },
    setOptions(target, options) {
      target.options = { ...target.options, ...options };
    },
    imageOverlay: (url, bounds, options) => new FakeImage(url, bounds, options),
  };
  globalThis.fetch = async url => {
    requested.push(url);
    return { ok: true, json: async () => manifest };
  };

  try {
    const layer = mouzon.createLayer({ manifestURL: '/manifest.json' });
    layer.onAdd(fakeMap);
    await layer._loadManifest();
    assert.deepEqual(requested, ['/manifest.json']);
    assert.ok(fakeMap.layers.size >= 1 && fakeMap.layers.size <= 4);
    assert.ok([...fakeMap.layers].every(image =>
      image.url.startsWith('/assets/maps/mouzon-1775/') && image.options.pane === 'tilePane'
    ));

    fakeMap.bounds = [-100, 40, -99, 41];
    layer._update();
    assert.equal(fakeMap.layers.size, 0);
    layer.onRemove(fakeMap);
  } finally {
    globalThis.L = originalLeaflet;
    globalThis.fetch = originalFetch;
  }
});

test('page loads the local Mouzon layer before map initialization', async () => {
  const [html, mapSource] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/map.js', import.meta.url), 'utf8'),
  ]);
  assert.ok(html.indexOf('js/mouzon.js') < html.indexOf('js/map.js'));
  assert.match(html, />\s*Modern map\s*</);
  assert.match(mapSource, /mouzonLayer\.addTo\(PF\.map\.instance\)/);
  assert.doesNotMatch(`${html}\n${mapSource}`, /MapWarper|Rumsey/);
});
