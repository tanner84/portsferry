/**
 * timeline.js — Timeline slider and date-driven layer management
 * Ports Ferry Narrative GIS
 *
 * Prototype uses a lightweight HTML range input rather than the full
 * Leaflet.TimeDimension control, keeping the dependency surface small.
 * The TimeDimension library is loaded (see index.html) for Phase 3
 * when animated troop movements are added.
 *
 * Date arithmetic uses year-only precision at this stage; the resolution
 * selector extends to month/day for battle-phase views.
 */

window.PF = window.PF || {};
PF.timeline = {};

/* ================================================================
   Configuration
   ================================================================ */
const TL = {
  START:   1758,
  END:     1783,
  DEFAULT: 1770,

  /* Anchor events that suggest a resolution change.
     Phase 3: these will snap the TimeDimension step to minutes. */
  ANCHORS: [
    { year: 1776, month: 2,  day: 27, label: "Moore's Creek Bridge",       resolution: 'day'   },
    { year: 1775, month: 9,  day: 9,  label: 'Cumberland Co. militia appts.', resolution: 'month' },
    { year: 1780, month: 9,  day: 29, label: 'Battle of Wahab\'s Plantation', resolution: 'day'   },
  ],
};

/* ================================================================
   State
   ================================================================ */
PF.timeline.currentDate  = new Date(TL.DEFAULT, 0, 1);
PF.timeline.resolution   = 'year';
PF.timeline.playing      = false;
PF.timeline._playTimer   = null;
PF.timeline._slider      = null;

/* ================================================================
   Init
   ================================================================ */
PF.timeline.init = function () {
  const container = document.getElementById('tl-slider-container');

  /* Build range input */
  const slider = document.createElement('input');
  slider.type       = 'range';
  slider.id         = 'tl-range';
  slider.min        = TL.START;
  slider.max        = TL.END;
  slider.value      = TL.DEFAULT;
  slider.step       = 1;
  slider.setAttribute('aria-label', 'Timeline year');
  container.appendChild(slider);
  PF.timeline._slider = slider;

  /* Tick marks via datalist (visual hint at anchor events) */
  const list = document.createElement('datalist');
  list.id = 'tl-ticks';
  TL.ANCHORS.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.year;
    opt.label = a.label;
    list.appendChild(opt);
  });
  container.appendChild(list);
  slider.setAttribute('list', 'tl-ticks');

  /* Events */
  slider.addEventListener('input', () => {
    PF.timeline.setYear(parseInt(slider.value));
  });

  document.getElementById('tl-play').addEventListener('click',      PF.timeline.play);
  document.getElementById('tl-pause').addEventListener('click',     PF.timeline.pause);
  document.getElementById('tl-step-back').addEventListener('click', () => PF.timeline.step(-1));
  document.getElementById('tl-step-fwd').addEventListener('click',  () => PF.timeline.step(1));

  document.getElementById('tl-resolution').addEventListener('change', function () {
    PF.timeline.resolution = this.value;
  });

  PF.timeline.setYear(TL.DEFAULT);
  console.info('[PF.timeline] Timeline initialised. Range:', TL.START, '–', TL.END);
};

/* ================================================================
   Year setter — single source of truth for date changes
   ================================================================ */
PF.timeline.setYear = function (year) {
  const clamped = Math.max(TL.START, Math.min(TL.END, year));
  PF.timeline.currentDate = new Date(clamped, 0, 1);

  if (PF.timeline._slider) PF.timeline._slider.value = clamped;
  document.getElementById('tl-date-display').textContent = clamped;

  PF.timeline._onDateChange(PF.timeline.currentDate);
};

/* ================================================================
   Step and playback
   ================================================================ */
PF.timeline.step = function (delta) {
  PF.timeline.setYear(PF.timeline.currentDate.getFullYear() + delta);
};

PF.timeline.play = function () {
  if (PF.timeline.playing) return;
  PF.timeline.playing = true;
  document.getElementById('tl-play').classList.add('hidden');
  document.getElementById('tl-pause').classList.remove('hidden');

  PF.timeline._playTimer = setInterval(() => {
    if (PF.timeline.currentDate.getFullYear() >= TL.END) {
      PF.timeline.pause();
      return;
    }
    PF.timeline.step(1);
  }, 550);
};

PF.timeline.pause = function () {
  PF.timeline.playing = false;
  clearInterval(PF.timeline._playTimer);
  PF.timeline._playTimer = null;
  document.getElementById('tl-play').classList.remove('hidden');
  document.getElementById('tl-pause').classList.add('hidden');
};

/* ================================================================
   Date change handler — triggers map re-render
   Other modules subscribe by replacing or wrapping this function.
   ================================================================ */
PF.timeline._onDateChange = function (date) {
  if (!PF.data || !PF.data.loaded) return;

  /* Re-render individual layer against the new date */
  const visibleInds = PF.data.getIndividualsByDate(date);
  PF.map.renderIndividuals(visibleInds);

  /* Notify panels if they have registered a hook */
  if (typeof PF.panels.onDateChange === 'function') {
    PF.panels.onDateChange(date);
  }
};
