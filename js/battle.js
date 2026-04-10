/**
 * battle.js — Battle Mode state machine and unit position renderer
 * Ports Ferry Narrative GIS
 *
 * Battle Mode activates when a user enters a battle. The main community
 * timeline freezes; a phase-based battle timeline takes over. Unit
 * position pins animate between phases. The story panel shows the active
 * phase narrative, source confidence, and community network connections
 * (the men on the bridge are the same men from the church rolls).
 *
 * Only one battle may be active at a time. Call PF.battle.enter(battle)
 * to activate; PF.battle.exit() to return to community mode.
 *
 * Architecture:
 *   PF.battle.enter(battle)    — enter Battle Mode
 *   PF.battle.exit()           — exit Battle Mode
 *   PF.battle.setPhase(index)  — jump to phase (0-based), with animation
 *   PF.battle.stepBack()       — previous phase
 *   PF.battle.stepForward()    — next phase
 *   PF.battle.init()           — wire DOM controls (called from app.js)
 */

window.PF = window.PF || {};
PF.battle = {};

/* ================================================================
   State
   ================================================================ */
PF.battle._active       = false;
PF.battle._battle       = null;    // active BATTLES row
PF.battle._phases       = [];      // [{ phaseIndex, phaseLabel, positions }]
PF.battle._phaseIndex   = 0;       // 0-based index into _phases
PF.battle._layer        = null;    // L.LayerGroup for unit position pins
PF.battle._markers      = [];      // [{ pos, marker, lat, lng }]
PF.battle._weatherShown = false;   // weather popup shown this session?
PF.battle._weatherTimer = null;    // pending popup timeout

/* ================================================================
   Initialization — wire battle bar controls
   ================================================================ */
PF.battle.init = function () {
  document.getElementById('bb-back-btn').addEventListener('click', () => PF.battle.exit());
  document.getElementById('bb-step-back').addEventListener('click', () => PF.battle.stepBack());
  document.getElementById('bb-step-fwd').addEventListener('click',  () => PF.battle.stepForward());

  console.info('[PF.battle] Battle module initialised.');
};

/* ================================================================
   Enter / Exit
   ================================================================ */

/**
 * Enter Battle Mode for a given battle.
 * @param {Object} battle — BATTLES row
 */
PF.battle.enter = function (battle) {
  if (PF.battle._active) PF.battle.exit(true);

  const phases = PF.data.getBattlePhases(battle.battle_id);
  if (phases.length === 0) {
    console.warn('[PF.battle] No UNIT_POSITIONS for battle:', battle.battle_id);
    return false;
  }

  PF.battle._battle       = battle;
  PF.battle._phases       = phases;
  PF.battle._phaseIndex   = 0;
  PF.battle._active       = true;
  PF.battle._weatherShown = false;

  /* Freeze and hide main timeline */
  PF.timeline.pause();
  document.getElementById('timeline-bar').classList.add('hidden');
  document.getElementById('battle-bar').classList.remove('hidden');

  /* Ensure battle layer exists */
  if (!PF.battle._layer) {
    PF.battle._layer = L.layerGroup().addTo(PF.map.instance);
  }

  /* Clear community layers */
  PF.map.layers.individuals.clearLayers();
  PF.map.layers.assembly.clearLayers();
  PF.network.clear();

  /* Centre map on battle */
  const lat = PF.data._parseCoord(battle.lat);
  const lng = PF.data._parseCoord(battle.lng);
  if (lat !== null && lng !== null) {
    PF.map.instance.setView([lat, lng], 14, { animate: true, duration: 0.7 });
  }

  /* Render phase 1 without animation */
  _renderPhase(phases[0]);
  _updateBar();
  PF.panels.showBattlePhase(battle, phases[0]);

  /* Schedule weather popup — 2 s after entry, once per session */
  PF.battle._weatherTimer = setTimeout(() => {
    if (PF.battle._active && !PF.battle._weatherShown) {
      _showWeatherPopup(battle);
    }
  }, 2000);

  console.info('[PF.battle] Entered battle mode:', battle.name,
    `— ${phases.length} phases, ${phases.reduce((n, p) => n + p.positions.length, 0)} positions`);
  return true;
};

/**
 * Exit Battle Mode and return to community timeline.
 * @param {boolean} [silent] — skip story panel reset (used when switching battles)
 */
PF.battle.exit = function (silent) {
  if (!PF.battle._active) return;

  if (PF.battle._layer) PF.battle._layer.clearLayers();
  PF.battle._markers    = [];
  PF.battle._active     = false;
  PF.battle._battle     = null;
  PF.battle._phases     = [];
  PF.battle._phaseIndex = 0;

  clearTimeout(PF.battle._weatherTimer);
  PF.battle._weatherTimer = null;
  PF.battle._weatherShown = false;
  _dismissWeatherPopup();

  document.getElementById('battle-bar').classList.add('hidden');
  document.getElementById('timeline-bar').classList.remove('hidden');

  /* Restore community layers */
  PF.map.renderIndividuals(PF.data.getIndividualsByDate(PF.timeline.currentDate));
  PF.map.renderChurches(PF.data.getMappableChurches());

  if (!silent) PF.panels.resetStory();

  console.info('[PF.battle] Exited battle mode.');
};

/* ================================================================
   Phase navigation
   ================================================================ */

/**
 * Jump to a phase by 0-based index.
 * @param {number} index
 * @param {boolean} [animate=true]
 */
PF.battle.setPhase = function (index, animate) {
  if (!PF.battle._active) return;
  const phases = PF.battle._phases;
  if (index < 0 || index >= phases.length) return;

  const prevPhase   = phases[PF.battle._phaseIndex];
  const targetPhase = phases[index];
  PF.battle._phaseIndex = index;

  _updateBar();

  if (animate !== false && prevPhase !== targetPhase) {
    _animateTransition(prevPhase, targetPhase, () => {
      PF.panels.showBattlePhase(PF.battle._battle, targetPhase);
    });
  } else {
    _renderPhase(targetPhase);
    PF.panels.showBattlePhase(PF.battle._battle, targetPhase);
  }
};

PF.battle.stepBack = function () {
  PF.battle.setPhase(PF.battle._phaseIndex - 1, true);
};

PF.battle.stepForward = function () {
  PF.battle.setPhase(PF.battle._phaseIndex + 1, true);
};

/* ================================================================
   Rendering — phase markers
   ================================================================ */

function _renderPhase(phase) {
  PF.battle._layer.clearLayers();
  PF.battle._markers = [];

  phase.positions.forEach(pos => {
    const m = _placeMarker(pos);
    if (m) PF.battle._markers.push({ pos, marker: m });
  });
}

/**
 * Animate unit position markers from one phase to the next.
 * Units present in both phases slide between coordinates.
 * New units fade in (opacity animation via CSS class).
 */
function _animateTransition(fromPhase, toPhase, onComplete) {
  const STEPS = 24;
  const DURATION_MS = 600;

  /* Build from-position lookup by unit_id */
  const fromMap = {};
  fromPhase.positions.forEach(p => { fromMap[p.unit_id] = p; });

  PF.battle._layer.clearLayers();
  PF.battle._markers = [];

  const moving = [];

  toPhase.positions.forEach(pos => {
    const toLat = PF.data._parseCoord(pos.lat);
    const toLng = PF.data._parseCoord(pos.lng);
    if (toLat === null || toLng === null) return;

    const marker = _placeMarker(pos);
    if (!marker) return;
    PF.battle._markers.push({ pos, marker });

    const fromPos = fromMap[pos.unit_id];
    if (fromPos) {
      const fromLat = PF.data._parseCoord(fromPos.lat);
      const fromLng = PF.data._parseCoord(fromPos.lng);
      if (fromLat !== null && fromLng !== null &&
          (Math.abs(fromLat - toLat) > 0.0001 || Math.abs(fromLng - toLng) > 0.0001)) {
        marker.setLatLng([fromLat, fromLng]);
        moving.push({ marker, fromLat, fromLng, toLat, toLng });
      }
    }
  });

  if (moving.length === 0) {
    if (onComplete) onComplete();
    return;
  }

  let step = 0;
  const iv = setInterval(() => {
    step++;
    const t = _easeInOut(step / STEPS);
    moving.forEach(a => {
      a.marker.setLatLng([
        a.fromLat + (a.toLat - a.fromLat) * t,
        a.fromLng + (a.toLng - a.fromLng) * t,
      ]);
    });
    if (step >= STEPS) {
      clearInterval(iv);
      if (onComplete) onComplete();
    }
  }, DURATION_MS / STEPS);
}

/** Ease-in-out cubic. */
function _easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ================================================================
   Marker factory
   ================================================================ */

/**
 * Place a unit position marker on the battle layer.
 * @param {Object} pos — UNIT_POSITIONS row
 * @returns {L.Marker|null}
 */
function _placeMarker(pos) {
  const unit = PF.data.getUnitById(pos.unit_id);
  const lat  = PF.data._parseCoord(pos.lat);
  const lng  = PF.data._parseCoord(pos.lng);
  if (lat === null || lng === null) return null;

  const icon   = _makeIcon(pos, unit);
  const marker = L.marker([lat, lng], {
    icon,
    zIndexOffset: 300,
    title: unit ? unit.name : pos.unit_id,
  });

  /* Tooltip */
  const hasStrength = pos.strength_estimated && pos.strength_estimated !== '0';
  const confNote    = _confidenceLabel(pos.confidence);
  const coordNote   = pos.coord_confidence && pos.coord_confidence !== 'Approximate'
    ? `Position: ${pos.coord_confidence}`
    : pos.coord_confidence === 'Approximate' ? 'Position approximate' : '';

  marker.bindTooltip(
    `<strong>${_esc(unit ? unit.name : pos.unit_id)}</strong>` +
    (hasStrength        ? `<br>~${_esc(pos.strength_estimated)} men`    : '') +
    (pos.facing         ? ` · facing ${_esc(pos.facing)}`               : '') +
    `<br>${_esc(pos.action || '')}` +
    (confNote  ? `<br><em style="color:#c08060">${confNote}</em>`  : '') +
    (coordNote ? `<br><em style="color:#9aafcc">${coordNote}</em>` : ''),
    { className: 'pf-tooltip', direction: 'top', offset: [0, -10] }
  );

  marker.on('click', () => {
    if (PF.battle._active) {
      PF.panels.showBattlePhase(
        PF.battle._battle,
        PF.battle._phases[PF.battle._phaseIndex]
      );
    }
  });

  marker.addTo(PF.battle._layer);
  return marker;
}

/**
 * Build a rectangular div icon styled by affiliation and confidence.
 *
 * Shape: wide rectangle (unit formation symbol).
 * Confidence is shown through opacity and a small badge:
 *   High     — full opacity, no badge
 *   Medium   — 85% opacity
 *   Low      — 55% opacity, "?" badge
 *   Inferred — 40% opacity, "?" badge, italic label color
 *
 * Avoids CSS dashed/dotted borders which render as noise at small sizes.
 */
function _makeIcon(pos, unit) {
  const color  = PF.map.affiliationColor(unit ? unit.affiliation : 'Unknown');
  const conf   = (pos.confidence || 'Medium').toLowerCase();
  const arrow  = _facingGlyph(pos.facing);
  const W = 30, H = 16;

  let opacity, badge;
  switch (conf) {
    case 'high':     opacity = 1.00; badge = '';  break;
    case 'medium':   opacity = 0.85; badge = '';  break;
    case 'low':      opacity = 0.55; badge = '?'; break;
    default:         opacity = 0.40; badge = '?'; break;  /* inferred */
  }

  /* Lighten the color slightly for the stroke */
  const innerHtml = badge
    ? `<span style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.9)">${badge}</span>`
    : arrow
      ? `<span style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.95)">${arrow}</span>`
      : '';

  return L.divIcon({
    className: '',
    html: `<div style="
      width:${W}px; height:${H}px;
      background:${color};
      opacity:${opacity};
      border-radius:2px;
      border: 1.5px solid rgba(255,255,255,0.5);
      box-shadow:0 2px 6px rgba(0,0,0,0.55);
      display:flex; align-items:center; justify-content:center;
      pointer-events:none;
    ">${innerHtml}</div>`,
    iconSize:    [W, H],
    iconAnchor:  [W / 2, H / 2],
    popupAnchor: [0, -H / 2 - 4],
  });
}

const _FACING_GLYPHS = { N:'↑', S:'↓', E:'→', W:'←', NE:'↗', NW:'↖', SE:'↘', SW:'↙' };
function _facingGlyph(facing) {
  return _FACING_GLYPHS[(facing || '').toUpperCase()] || '';
}

function _confidenceLabel(conf) {
  switch ((conf || '').toLowerCase()) {
    case 'low':      return 'Low confidence — position approximate';
    case 'inferred': return 'Inferred — no direct source for this position';
    default:         return '';
  }
}

/* ================================================================
   Battle bar and phase navigator UI update
   ================================================================ */

function _updateBar() {
  const battle = PF.battle._battle;
  const phases = PF.battle._phases;
  const idx    = PF.battle._phaseIndex;
  const phase  = phases[idx];
  if (!battle || !phase) return;

  /* Slim title bar */
  const titleEl = document.getElementById('bb-battle-title');
  if (titleEl) titleEl.textContent = battle.name + ' · ' + (battle.date || '');

  const confEl = document.getElementById('bb-confidence');
  if (confEl) {
    const conf = battle.reconstruction_confidence || 'Medium';
    confEl.textContent = conf + ' confidence';
    confEl.className   = 'bb-confidence bb-conf-' + conf.toLowerCase();
  }

  /* Phase dot track — rebuild nodes */
  const track = document.getElementById('bb-phase-track');
  if (track) {
    track.innerHTML = phases.map((ph, i) => `
      <div class="bb-phase-node${i === idx ? ' active' : ''}"
           data-phase-idx="${i}" role="button" tabindex="0"
           title="Phase ${ph.phaseIndex}: ${_esc(ph.phaseLabel)}">
        <div class="bb-phase-dot">${ph.phaseIndex}</div>
      </div>`).join('');

    track.querySelectorAll('.bb-phase-node').forEach(node => {
      const go = () => PF.battle.setPhase(parseInt(node.dataset.phaseIdx), true);
      node.addEventListener('click', go);
      node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(); });
    });
  }

  /* Phase label in the right portion of row 2 */
  const labelEl = document.getElementById('bb-phase-label-float');
  if (labelEl) {
    labelEl.textContent = `Phase ${phase.phaseIndex} of ${phases.length}  ·  ${phase.phaseLabel}`;
  }

  /* Step button enable/disable */
  const backBtn = document.getElementById('bb-step-back');
  const fwdBtn  = document.getElementById('bb-step-fwd');
  if (backBtn) backBtn.disabled = idx === 0;
  if (fwdBtn)  fwdBtn.disabled  = idx === phases.length - 1;
}

/* ================================================================
   Weather popup
   ================================================================ */

const _WEATHER_ICONS = {
  fog:      '🌫️',
  rain:     '🌧️',
  clear:    '☀️',
  snow:     '🌨️',
  overcast: '☁️',
  wind:     '💨',
  sleet:    '🌦️',
  storm:    '⛈️',
};

function _showWeatherPopup(battle) {
  const row = (PF.data.raw.WEATHER || []).find(w => w.battle_id === battle.battle_id);
  if (!row) return;

  PF.battle._weatherShown = true;

  const dateStr   = _formatWeatherDate(battle.date || '');
  const icon      = _WEATHER_ICONS[(row.icon || '').toLowerCase()] || '🌡️';
  const conf      = row.confidence || 'Medium';
  const confClass = conf.toLowerCase();

  const popup = document.createElement('div');
  popup.id = 'weather-popup';
  popup.innerHTML = `
    <button id="weather-popup-close" aria-label="Dismiss weather">×</button>
    <div class="wp-location">${_esc(battle.name || '')}</div>
    <div class="wp-date">${_esc(dateStr)}</div>
    <div class="wp-main">
      <div class="wp-icon">${icon}</div>
      <div class="wp-temp">${_esc(row.temp_estimate || '')}</div>
    </div>
    <div class="wp-condition">${_esc(row.condition_label || '')}</div>
    ${row.narrative ? `<p class="wp-narrative">${_esc(row.narrative)}</p>` : ''}
    ${row.seasonal_context ? `<p class="wp-seasonal">${_esc(row.seasonal_context)}</p>` : ''}
    <div class="wp-footer">
      <span class="battle-pos-confidence confidence-${confClass}">${_esc(conf)} confidence</span>
      ${row.primary_ref ? `<span class="wp-source">${_esc(row.primary_ref)}</span>` : ''}
    </div>`;

  document.body.appendChild(popup);

  /* X button is the only dismiss — no click-outside, Leaflet map events would fire it */
  document.getElementById('weather-popup-close').addEventListener('click', e => {
    e.stopPropagation();
    _dismissWeatherPopup();
  });
}

function _dismissWeatherPopup() {
  const el = document.getElementById('weather-popup');
  if (el) el.remove();
}

function _formatWeatherDate(dateStr) {
  /* Accepts "1776-02-27", "February 27, 1776", or bare year */
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (iso) {
    const m = parseInt(iso[2]) - 1;
    return `${MONTHS[m] || ''} ${parseInt(iso[3])} ${iso[1]}`;
  }
  return dateStr;
}

/* ================================================================
   Internal helpers
   ================================================================ */
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
