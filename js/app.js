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

/* ================================================================
   Mobile tab navigation
   No-op on desktop (guard: window.innerWidth > 767).
   Exposes PF.mob.switchTab(tab) for panels.js to call when an
   entity is selected — switches to STORY tab automatically.
   ================================================================ */
window.PF = window.PF || {};
PF.mob = {
  active: 'map',
  switchTab: function (tab) {
    if (window.innerWidth > 767) return;
    const app = document.getElementById('app');
    app.classList.remove('mob-browse', 'mob-story');
    if (tab === 'browse') app.classList.add('mob-browse');
    if (tab === 'story')  app.classList.add('mob-story');
    PF.mob.active = tab;
    document.querySelectorAll('.mob-tab').forEach(btn => {
      btn.classList.toggle('mob-tab-active', btn.dataset.tab === tab);
    });
    /* When switching away from a drawer, invalidate map size */
    if (tab === 'map') setTimeout(() => PF.map.instance.invalidateSize(), 50);
  },
};

function _initMobileNav() {
  if (window.innerWidth > 767) return;
  document.querySelectorAll('.mob-tab').forEach(btn => {
    btn.addEventListener('click', () => PF.mob.switchTab(btn.dataset.tab));
  });
  PF.mob.switchTab('map');   // default state
}

(async function portsFerryInit() {
  'use strict';

  window.PF = window.PF || {};

  const loadingEl = document.getElementById('loading-indicator');
  loadingEl.classList.remove('hidden');

  try {
    /* ── 1. Map ─────────────────────────────────────────────── */
    PF.map.init();
    PF.map.initCountyOriginLayer();   // county origin lines — Table 2, off by default

    /* ── 2. Data ────────────────────────────────────────────── */
    await PF.data.load();

    if (PF.data.loadErrors.length > 0) {
      console.warn('[PF] Sheet load errors:', PF.data.loadErrors);
    }

    /* ── 3. Timeline ────────────────────────────────────────── */
    PF.timeline.init();

    /* ── 4. Battle module ───────────────────────────────────── */
    PF.battle.init();

    /* ── 5. Panels ──────────────────────────────────────────── */
    PF.panels.init();

    /* ── 5a. Mobile tab nav (no-op above 767px) ─────────────── */
    _initMobileNav();

    /* ── 6. Initial render ──────────────────────────────────── */
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
      { individuals:    (PF.data.raw.INDIVIDUALS    || []).length,
        churches:       (PF.data.raw.CHURCHES       || []).length,
        events:         (PF.data.raw.EVENTS         || []).length,
        sources:        (PF.data.raw.SOURCES        || []).length,
        battles:        (PF.data.raw.BATTLES        || []).length,
        unit_positions: (PF.data.raw.UNIT_POSITIONS || []).length,
      }
    );

  } catch (err) {
    console.error('[PF] Fatal startup error:', err);
    const statusEl = document.getElementById('map-status');
    statusEl.innerHTML = `<p><strong>Startup error:</strong> ${err.message || err}</p>
      <p style="font-size:0.8rem;margin-top:0.5rem;color:#aaa;">
        Open browser DevTools → Console for the full stack trace.
      </p>`;
    statusEl.classList.remove('hidden');

  } finally {
    loadingEl.classList.add('hidden');
  }

}());
