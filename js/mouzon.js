/**
 * mouzon.js — lazy local-image layer for the georeferenced Mouzon 1775 map
 * Ports Ferry Narrative GIS
 */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PF = root.PF || {};
  root.PF.mouzon = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DEFAULT_MANIFEST_URL = 'data/gis/mouzon-1775.json?v=20260913';
  const ATTRIBUTION = [
    'Historical map: Henry Mouzon et al., 1775',
    '<a href="https://collections.lib.uwm.edu/digital/collection/agdm/id/2583"',
    ' target="_blank" rel="noopener">UWM AGSL</a>',
    '(regional georeferencing)',
  ].join(' ');

  function validateManifest(manifest) {
    const errors = [];
    if (!manifest || typeof manifest !== 'object') {
      return ['Manifest must be an object'];
    }
    if (manifest.id !== 'mouzon-1775') errors.push('Unexpected manifest id');
    if (!Array.isArray(manifest.panels) || manifest.panels.length === 0) {
      errors.push('Manifest has no panels');
      return errors;
    }

    const ids = new Set();
    manifest.panels.forEach((panel, index) => {
      if (!panel || typeof panel !== 'object') {
        errors.push(`Panel ${index} is not an object`);
        return;
      }
      if (!panel.id || ids.has(panel.id)) errors.push(`Panel ${index} has a missing or duplicate id`);
      ids.add(panel.id);
      if (!/^assets\/maps\/mouzon-1775\/panel-.+-[a-f0-9]{10}\.webp$/.test(panel.url || '')) {
        errors.push(`Panel ${panel.id || index} has an invalid fingerprinted URL`);
      }
      const bounds = panel.bounds;
      if (!Array.isArray(bounds) || bounds.length !== 2 ||
          !bounds.every(pair => Array.isArray(pair) && pair.length === 2 &&
            pair.every(Number.isFinite))) {
        errors.push(`Panel ${panel.id || index} has invalid bounds`);
      } else if (bounds[0][0] >= bounds[1][0] || bounds[0][1] >= bounds[1][1]) {
        errors.push(`Panel ${panel.id || index} has inverted bounds`);
      }
    });
    return errors;
  }

  /**
   * Return manifest panels intersecting [west, south, east, north].
   * Kept DOM-free so coverage and lazy-loading behavior can be unit tested.
   */
  function panelsForBounds(manifest, bounds) {
    if (!manifest || !Array.isArray(manifest.panels) || !Array.isArray(bounds)) return [];
    const [west, south, east, north] = bounds;
    return manifest.panels.filter(panel => {
      const [[panelSouth, panelWest], [panelNorth, panelEast]] = panel.bounds;
      return panelWest <= east && panelEast >= west &&
        panelSouth <= north && panelNorth >= south;
    });
  }

  function createLayer(options) {
    const L = root.L;
    if (!L) throw new Error('Leaflet must be loaded before the Mouzon layer');

    const MouzonLayer = L.Layer.extend({
      options: {
        manifestURL: DEFAULT_MANIFEST_URL,
        opacity: 0.9,
        preloadPadding: 0.18,
        pane: 'tilePane',
      },

      initialize: function (layerOptions) {
        L.setOptions(this, layerOptions);
        this._manifest = null;
        this._manifestPromise = null;
        this._panelLayers = new Map();
        this._map = null;
      },

      onAdd: function (map) {
        this._map = map;
        map.on('moveend zoomend resize', this._update, this);
        this._loadManifest();
      },

      onRemove: function (map) {
        map.off('moveend zoomend resize', this._update, this);
        this._panelLayers.forEach(layer => map.removeLayer(layer));
        this._panelLayers.clear();
        this._map = null;
      },

      getAttribution: function () {
        return ATTRIBUTION;
      },

      getMetadata: function () {
        return this._manifest;
      },

      setOpacity: function (opacity) {
        this.options.opacity = opacity;
        this._panelLayers.forEach(layer => layer.setOpacity(opacity));
        return this;
      },

      _loadManifest: function () {
        if (this._manifest) {
          this._update();
          return Promise.resolve(this._manifest);
        }
        if (this._manifestPromise) return this._manifestPromise;

        this._manifestPromise = root.fetch(this.options.manifestURL, { cache: 'no-cache' })
          .then(response => {
            if (!response.ok) throw new Error(`Mouzon manifest request failed (${response.status})`);
            return response.json();
          })
          .then(manifest => {
            const errors = validateManifest(manifest);
            if (errors.length) throw new Error(`Invalid Mouzon manifest: ${errors.join('; ')}`);
            this._manifest = manifest;
            this._manifestPromise = null;
            this._update();
            this.fire('manifestload', { manifest });
            return manifest;
          })
          .catch(error => {
            this._manifestPromise = null;
            this.fire('loaderror', { error });
            throw error;
          });

        // The error is surfaced through loaderror; avoid an unhandled rejection.
        this._manifestPromise.catch(() => {});
        return this._manifestPromise;
      },

      _update: function () {
        if (!this._map || !this._manifest) return;
        const view = this._map.getBounds().pad(this.options.preloadPadding);
        const bbox = [view.getWest(), view.getSouth(), view.getEast(), view.getNorth()];
        const neededPanels = panelsForBounds(this._manifest, bbox);
        const neededIds = new Set(neededPanels.map(panel => panel.id));

        this._panelLayers.forEach((layer, id) => {
          if (!neededIds.has(id)) {
            this._map.removeLayer(layer);
            this._panelLayers.delete(id);
          }
        });

        neededPanels.forEach(panel => {
          if (this._panelLayers.has(panel.id)) return;
          const image = L.imageOverlay(`/${panel.url.replace(/^\/+/, '')}`, panel.bounds, {
            pane: this.options.pane,
            opacity: this.options.opacity,
            alt: 'Georeferenced Henry Mouzon map of North and South Carolina, 1775',
            className: 'pf-mouzon-panel',
            interactive: false,
          });
          image.on('error', event => {
            this.fire('panelerror', { panel, originalEvent: event });
          });
          image.addTo(this._map);
          this._panelLayers.set(panel.id, image);
        });
      },
    });

    return new MouzonLayer(options);
  }

  return {
    DEFAULT_MANIFEST_URL,
    ATTRIBUTION,
    createLayer,
    panelsForBounds,
    validateManifest,
  };
}));
