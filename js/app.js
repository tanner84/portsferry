/**
 * app.js — Application entry point and startup orchestration
 * Ports Ferry Narrative GIS
 *
 * Initialization order:
 *   1. Map (no data needed — renders immediately)
 *   2. Data load (Google Sheets or seed fallback)
 *   3. Timeline
 *   4. Panels (populates browser lists once data is available)
 *   5. Initial render
 */

(async function portsFerryInit() {
  'use strict';

  window.PF = window.PF || {};

  const loadingEl = document.getElementById('loading-indicator');
  loadingEl.classList.remove('hidden');

  try {
    /* ── 1. Map ─────────────────────────────────────────────── */
    PF.map.init();

    /* ── 2. Data ────────────────────────────────────────────── */
    await PF.data.load();

    if (PF.data.loadErrors.length > 0) {
      console.warn('[PF] Sheet load errors:', PF.data.loadErrors);
    }

    /* ── 3. Timeline ────────────────────────────────────────── */
    PF.timeline.init();

    /* ── 4. Panels ──────────────────────────────────────────── */
    PF.panels.init();

    /* ── 5. Initial render ──────────────────────────────────── */
    const initialDate = PF.timeline.currentDate;
    PF.map.renderChurches(PF.data.getMappableChurches());
    PF.map.renderIndividuals(PF.data.getIndividualsByDate(initialDate));

    /* Auto-highlight Old Bluff Church if present in seed data */
    const oldBluff = (PF.data.raw.CHURCHES || []).find(ch =>
      (ch.name || '').toLowerCase().includes('bluff')
    );
    if (oldBluff) {
      const lat = PF.data._parseCoord(oldBluff.lat);
      const lng = PF.data._parseCoord(oldBluff.lng);
      if (lat !== null && lng !== null) {
        PF.map.highlightChurch(lat, lng, 3500);
      }
    }

    console.info('[PF] Startup complete.',
      { individuals: (PF.data.raw.INDIVIDUALS || []).length,
        churches:    (PF.data.raw.CHURCHES    || []).length,
        events:      (PF.data.raw.EVENTS      || []).length,
        sources:     (PF.data.raw.SOURCES     || []).length,
      }
    );

  } catch (err) {
    console.error('[PF] Fatal startup error:', err);
    document.getElementById('map-status').classList.remove('hidden');

  } finally {
    loadingEl.classList.add('hidden');
  }

}());
