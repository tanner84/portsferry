/**
 * panels.js — Left entity browser and right story panel
 * Ports Ferry Narrative GIS
 *
 * The story panel renders authored narrative HTML with live database
 * values inserted. Each showX() function is the narrative entry point
 * for one entity type. Source references open the source tray inline.
 *
 * HTML escaping: all data values pass through h() before insertion.
 */

window.PF = window.PF || {};
PF.panels = {};

/* ================================================================
   HTML escape — used throughout this file
   ================================================================ */
function h(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ================================================================
   Initialization
   ================================================================ */
PF.panels.init = function () {
  /* Search */
  document.getElementById('entity-search').addEventListener('input', function () {
    _renderBrowser();
  });

  /* Filter chips */
  _initFilterChips();

  /* Initial render */
  _renderBrowser();

  /* View switcher */
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      PF.panels.setView(this.dataset.view);
    });
  });

  /* Story panel controls */
  document.getElementById('story-close').addEventListener('click', PF.panels.resetStory);
  document.getElementById('source-tray-close').addEventListener('click', () => {
    document.getElementById('source-tray').classList.add('hidden');
  });

  console.info('[PF.panels] Panels initialised.');
};

/* ================================================================
   Entity browser — smart search + filter chips
   ================================================================ */

/* Affiliation chip → matching affiliation strings */
const _CHIP_AFFILS = {
  patriot:  ['Continental Army', 'State Line', 'Patriot Militia', 'Patriot Volunteer'],
  loyalist: ['Provincial Corps', 'Loyalist Militia', 'Associated Loyalist'],
  british:  ['British Regular'],
  unknown:  ['Unknown', 'Neutral'],
};

PF.panels._activeChips = new Set();

function _initFilterChips() {
  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', function () {
      const key = this.dataset.chip;
      if (PF.panels._activeChips.has(key)) {
        PF.panels._activeChips.delete(key);
        this.classList.remove('chip-active');
      } else {
        PF.panels._activeChips.add(key);
        this.classList.add('chip-active');
      }
      _renderBrowser();
      _applyChipFiltersToMap();
    });
  });
}

function _chipMatchesAffil(aff) {
  if (PF.panels._activeChips.size === 0) return true;
  const normAff = (aff || 'Unknown');
  for (const key of PF.panels._activeChips) {
    if ((_CHIP_AFFILS[key] || []).includes(normAff)) return true;
  }
  return false;
}

function _applyChipFiltersToMap() {
  /* Re-render map markers filtered to active chips, or restore all */
  const view = PF.panels._currentView || 'church';
  if (view === 'individual' || view === 'unit') {
    const allInds = PF.data.getIndividualsByDate(PF.timeline.currentDate);
    const filtered = PF.panels._activeChips.size === 0
      ? allInds
      : allInds.filter(ind => _chipMatchesAffil(ind.affiliation));
    PF.map.renderIndividuals(filtered);
  }
}

function _searchAllEntities(q) {
  const lower = q.toLowerCase();
  const results = { churches: [], individuals: [], units: [], battles: [], events: [] };

  (PF.data.raw.CHURCHES || []).forEach(ch => {
    if ((ch.name || '').toLowerCase().includes(lower) ||
        (ch.ch_id || '').toLowerCase().includes(lower)) {
      results.churches.push(ch);
    }
  });

  (PF.data.raw.INDIVIDUALS || []).forEach(ind => {
    if (!_chipMatchesAffil(ind.affiliation)) return;
    if ((ind.full_name || '').toLowerCase().includes(lower) ||
        (ind.rank      || '').toLowerCase().includes(lower) ||
        (ind.ind_id    || '').toLowerCase().includes(lower)) {
      results.individuals.push(ind);
    }
  });

  (PF.data.raw.UNITS || []).forEach(unit => {
    if (!_chipMatchesAffil(unit.affiliation)) return;
    if ((unit.name    || '').toLowerCase().includes(lower) ||
        (unit.unit_id || '').toLowerCase().includes(lower)) {
      results.units.push(unit);
    }
  });

  (PF.data.raw.BATTLES || []).forEach(b => {
    if ((b.name      || '').toLowerCase().includes(lower) ||
        (b.battle_id || '').toLowerCase().includes(lower)) {
      results.battles.push(b);
    }
  });

  (PF.data.raw.EVENTS || []).forEach(evt => {
    if ((evt.name   || '').toLowerCase().includes(lower) ||
        (evt.evt_id || '').toLowerCase().includes(lower)) {
      results.events.push(evt);
    }
  });

  return results;
}

function _getFocalEntities() {
  const view = PF.panels._currentView || 'church';
  const res  = { churches: [], individuals: [], units: [], battles: [], events: [] };
  const chips = PF.panels._activeChips;

  if (view === 'church') {
    res.churches = PF.data.getMappableChurches();
  } else if (view === 'individual') {
    res.individuals = (PF.data.raw.INDIVIDUALS || [])
      .filter(ind => _chipMatchesAffil(ind.affiliation));
  } else if (view === 'unit') {
    res.units = (PF.data.raw.UNITS || [])
      .filter(u => _chipMatchesAffil(u.affiliation));
    res.individuals = (PF.data.raw.INDIVIDUALS || [])
      .filter(ind => _chipMatchesAffil(ind.affiliation) && !ind.tier);
  } else if (view === 'battle') {
    res.battles = PF.data.raw.BATTLES || [];
  }
  return res;
}

function _buildResultRow(entity, type) {
  const li = document.createElement('div');
  li.className = 'sr-item';
  li.setAttribute('role', 'button');
  li.setAttribute('tabindex', '0');

  let dot = '';
  let name = '';
  let meta = '';

  if (type === 'church') {
    dot  = `<span class="dot dot-church"></span>`;
    name = h(entity.name || entity.ch_id);
    meta = h(entity.founded_yr || '');
  } else if (type === 'individual') {
    const affCls = PF.map.affiliationClass(entity.affiliation);
    dot  = `<span class="dot dot-${affCls}"></span>`;
    name = h(entity.full_name || entity.ind_id);
    meta = h(entity.rank || entity.affiliation || '');
  } else if (type === 'unit') {
    const affCls = PF.map.affiliationClass(entity.affiliation);
    dot  = `<span class="dot dot-${affCls}"></span>`;
    name = h(entity.name || entity.unit_id);
    meta = h(entity.affiliation || '');
  } else if (type === 'battle') {
    dot  = `<span style="width:8px;height:8px;background:#8b2020;border-radius:1px;transform:rotate(45deg);display:inline-block;flex-shrink:0"></span>`;
    name = h(entity.name || entity.battle_id);
    meta = h(entity.date || '');
  } else if (type === 'event') {
    dot  = `<span class="dot" style="background:#777;border-radius:1px;width:6px;height:6px;flex-shrink:0"></span>`;
    name = h(entity.name || entity.evt_id);
    meta = h(entity.date || '');
  }

  li.innerHTML = `${dot}<span style="flex:1;min-width:0">${name}</span>${meta ? `<span class="sr-item-meta">${meta}</span>` : ''}`;
  li.addEventListener('click', () => _openEntity(entity, type));
  li.addEventListener('keydown', e => { if (e.key === 'Enter') _openEntity(entity, type); });
  return li;
}

function _openEntity(entity, type) {
  /* Mark active */
  document.querySelectorAll('#browser-results .sr-item').forEach(el => el.classList.remove('active'));

  if (type === 'church') {
    PF.panels.showChurch(entity);
  } else if (type === 'individual') {
    PF.panels.showIndividual(entity);
    PF.network.renderForIndividual(entity.ind_id);
    const lat = PF.data._parseCoord(entity.lat);
    const lng = PF.data._parseCoord(entity.lng);
    if (lat !== null && lng !== null) PF.map.focusOn(lat, lng, 12);
  } else if (type === 'unit') {
    PF.panels.showUnit(entity);
  } else if (type === 'battle') {
    PF.panels.showBattle(entity);
  } else if (type === 'event') {
    PF.panels.showEvent(entity);
  }
}

function _renderBrowser() {
  const container = document.getElementById('browser-results');
  if (!container) return;

  const q = (document.getElementById('entity-search').value || '').trim();
  const entities = q.length >= 2 ? _searchAllEntities(q) : _getFocalEntities();

  const GROUPS = [
    { key: 'churches',    label: 'Churches',     type: 'church'     },
    { key: 'individuals', label: 'Individuals',  type: 'individual' },
    { key: 'units',       label: 'Units',        type: 'unit'       },
    { key: 'battles',     label: 'Battles',      type: 'battle'     },
    { key: 'events',      label: 'Events',       type: 'event'      },
  ];

  container.innerHTML = '';
  let totalCount = 0;

  GROUPS.forEach(({ key, label, type }) => {
    const items = entities[key] || [];
    if (items.length === 0) return;
    totalCount += items.length;

    const group = document.createElement('div');
    group.className = 'sr-group';

    const groupLabel = document.createElement('div');
    groupLabel.className = 'sr-group-label';
    groupLabel.textContent = `${label} (${items.length})`;
    group.appendChild(groupLabel);

    items.forEach(entity => {
      group.appendChild(_buildResultRow(entity, type));
    });

    container.appendChild(group);
  });

  if (totalCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'sr-empty';
    empty.textContent = q.length >= 2
      ? `No results for "${q}"`
      : 'No entities to display for current view and filters.';
    container.appendChild(empty);
  }
}

PF.panels._onSearch = function () { _renderBrowser(); };

/* ================================================================
   Left panel — Battle Mode phase-locked roster
   ================================================================ */

const _PATRIOT_AFFILS_SET = new Set([
  'Continental Army', 'State Line', 'Patriot Militia', 'Patriot Volunteer',
]);
const _ROSTER_FACING = { N:'↑', S:'↓', E:'→', W:'←', NE:'↗', NW:'↖', SE:'↘', SW:'↙' };

PF.panels._inBattleRoster = false;

function _enterBattlePanel(battle) {
  if (!PF.panels._inBattleRoster) {
    PF.panels._inBattleRoster = true;

    /* Hide normal search elements */
    const search = document.getElementById('entity-search');
    const chips  = document.getElementById('filter-chips');
    const h2     = document.querySelector('#panel-left .panel-header h2');
    if (search) search.style.display = 'none';
    if (chips)  chips.style.display  = 'none';
    if (h2)     h2.style.display     = 'none';

    /* Inject battle meta header into the panel-header */
    if (!document.getElementById('battle-panel-meta')) {
      const meta = document.createElement('div');
      meta.id    = 'battle-panel-meta';
      const hdr  = document.querySelector('#panel-left .panel-header');
      if (hdr) hdr.appendChild(meta);
    }
  }

  /* Update battle name every time (handles battle-to-battle switch) */
  const meta = document.getElementById('battle-panel-meta');
  if (meta) {
    meta.innerHTML =
      `<div class="broster-battle-name">${h(battle.name || 'Battle')}</div>` +
      (battle.date ? `<div class="broster-battle-date">${h(battle.date)}</div>` : '');
  }
}

function _exitBattlePanel() {
  if (!PF.panels._inBattleRoster) return;
  PF.panels._inBattleRoster = false;

  /* Restore normal search elements */
  const search = document.getElementById('entity-search');
  const chips  = document.getElementById('filter-chips');
  const h2     = document.querySelector('#panel-left .panel-header h2');
  if (search) search.style.display = '';
  if (chips)  chips.style.display  = '';
  if (h2)     h2.style.display     = '';

  const meta = document.getElementById('battle-panel-meta');
  if (meta) meta.remove();

  _renderBrowser();
}

function _renderBattleRoster(phase) {
  const container = document.getElementById('browser-results');
  if (!container) return;

  /* Group positions by side */
  const patriot = [];
  const british = [];
  phase.positions.forEach(pos => {
    const unit = PF.data.getUnitById(pos.unit_id);
    const aff  = unit ? (unit.affiliation || 'Unknown') : 'Unknown';
    if (_PATRIOT_AFFILS_SET.has(aff)) {
      patriot.push({ pos, unit });
    } else {
      british.push({ pos, unit });
    }
  });

  /* Fade out existing rows, then swap content */
  container.querySelectorAll('.broster-row').forEach(el => { el.style.opacity = '0'; });

  setTimeout(() => {
    container.innerHTML = '';
    if (patriot.length > 0) container.appendChild(_buildRosterGroup('PATRIOT', patriot, 'patriot'));
    if (british.length > 0) container.appendChild(_buildRosterGroup('BRITISH / LOYALIST', british, 'british'));
    if (patriot.length === 0 && british.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sr-empty';
      empty.textContent = 'No units recorded for this phase.';
      container.appendChild(empty);
    }
    /* Fade in */
    requestAnimationFrame(() => {
      container.querySelectorAll('.broster-row').forEach(el => { el.style.opacity = '1'; });
    });
  }, 80);
}

function _buildRosterGroup(label, items, side) {
  const group = document.createElement('div');
  group.className = `broster-group broster-group-${side}`;

  const header = document.createElement('div');
  header.className = `broster-group-label broster-label-${side}`;
  header.textContent = label;
  group.appendChild(header);

  items.forEach(({ pos, unit }) => {
    const row = document.createElement('div');
    row.className   = 'broster-row';
    row.role        = 'button';
    row.tabIndex    = 0;
    row.dataset.unitId = pos.unit_id;

    const affCls   = unit ? PF.map.affiliationClass(unit.affiliation) : 'unknown';
    const facing   = _ROSTER_FACING[(pos.facing || '').toUpperCase()] || '';
    const strength = pos.strength_estimated && pos.strength_estimated !== '0'
      ? `~${h(pos.strength_estimated)}`
      : '';

    row.innerHTML =
      `<span class="dot dot-${affCls}" style="flex-shrink:0"></span>` +
      `<span class="broster-unit-name">${h(unit ? unit.name : pos.unit_id)}</span>` +
      (facing   ? `<span class="broster-facing" title="Facing ${h(pos.facing)}">${facing}</span>` : '') +
      (strength ? `<span class="broster-strength">${strength}</span>` : '');

    const go = () => _rosterRowClick(pos, unit, row);
    row.addEventListener('click', go);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(); });

    group.appendChild(row);
  });

  return group;
}

function _rosterRowClick(pos, unit, rowEl) {
  /* Highlight row */
  document.querySelectorAll('#browser-results .broster-row').forEach(r => r.classList.remove('active'));
  rowEl.classList.add('active');

  /* Pan to unit position on map */
  const lat = PF.data._parseCoord(pos.lat);
  const lng = PF.data._parseCoord(pos.lng);
  if (lat !== null && lng !== null) PF.map.focusOn(lat, lng, 15);

  /* Open a dismissible popup on the corresponding battle marker */
  const hasStrength = pos.strength_estimated && pos.strength_estimated !== '0';
  const popupHtml =
    `<strong>${h(unit ? unit.name : pos.unit_id)}</strong>` +
    (hasStrength ? `<br>~${h(pos.strength_estimated)} men` : '') +
    (pos.facing  ? ` · facing ${h(pos.facing)}` : '') +
    (pos.action  ? `<br><span style="font-size:0.78rem;color:#504940">${h(pos.action)}</span>` : '');

  (PF.battle._markers || []).forEach(({ pos: mpos, marker }) => {
    if (mpos.unit_id === pos.unit_id) {
      marker.unbindPopup().bindPopup(popupHtml, { maxWidth: 260 }).openPopup();
    }
  });

  /* Load unit record in right panel */
  if (unit) PF.panels.showUnit(unit);
}

/* (old _renderOrderOfBattle removed — replaced by smart search) */
PF.panels._renderOrderOfBattle = function (filterQuery) {
  const container = document.getElementById('browser-tob');
  if (!container) return;

  const q = filterQuery ? filterQuery.toLowerCase() : null;

  /* ── Build unit → members index ───────────────────────────── */
  const unitMemberMap = {};   // unit_id → [{ ind, rank }]
  const inAnyUnit     = new Set();

  (PF.data.raw.IND_UNIT || []).forEach(link => {
    const ind = PF.data.getIndividualById(link.ind_id);
    if (!ind) return;
    if (!unitMemberMap[link.unit_id]) unitMemberMap[link.unit_id] = [];
    unitMemberMap[link.unit_id].push({ ind, rank: link.rank || ind.rank || '' });
    inAnyUnit.add(link.ind_id);
  });

  /* ── Gather relevant individuals ──────────────────────────── */
  const renderTiers = new Set(['Command', 'Company', 'Exception']);
  const allInds = (PF.data.raw.INDIVIDUALS || [])
    .filter(ind => renderTiers.has(ind.tier));

  /* Apply search filter across name, rank, affiliation */
  const matchesFilter = ind => {
    if (!q) return true;
    return (ind.full_name  || '').toLowerCase().includes(q)
        || (ind.rank       || '').toLowerCase().includes(q)
        || (ind.affiliation|| '').toLowerCase().includes(q);
  };

  /* ── Determine affiliation order ──────────────────────────── */
  const AFFIL_ORDER = [
    'Continental Army',
    'State Line',
    'Patriot Militia',
    'Patriot Volunteer',
    'British Regular',
    'Provincial Corps',
    'Loyalist Militia',
    'Associated Loyalist',
    'Unknown',
    'Neutral',
  ];

  /* ── Build affiliation → units map ────────────────────────── */
  const affiliationUnits = {};   // affiliation → [UNITS rows]
  (PF.data.raw.UNITS || []).forEach(unit => {
    const aff = unit.affiliation || 'Unknown';
    if (!affiliationUnits[aff]) affiliationUnits[aff] = [];
    affiliationUnits[aff].push(unit);
  });

  /* Also collect unattached individuals per affiliation */
  const unattachedByAffil = {};
  allInds
    .filter(ind => !inAnyUnit.has(ind.ind_id) && ind.tier !== 'Exception')
    .forEach(ind => {
      const aff = ind.affiliation || 'Unknown';
      if (!unattachedByAffil[aff]) unattachedByAffil[aff] = [];
      unattachedByAffil[aff].push(ind);
    });

  /* Exception tier individuals */
  const exceptions = allInds.filter(ind => ind.tier === 'Exception' && matchesFilter(ind));

  /* ── Render ────────────────────────────────────────────────── */
  const allAffiliations = [...new Set([
    ...AFFIL_ORDER,
    ...Object.keys(affiliationUnits),
    ...Object.keys(unattachedByAffil),
  ])].filter(aff => affiliationUnits[aff] || unattachedByAffil[aff]);

  let html = '';

  allAffiliations.forEach(aff => {
    const units       = affiliationUnits[aff]   || [];
    const unattached  = unattachedByAffil[aff]  || [];
    const affCls      = PF.map.affiliationClass(aff);
    const affColor    = PF.map.affiliationColor(aff);

    /* Filter units to those with at least one matching member */
    const filteredUnits = units.map(unit => {
      const members = (unitMemberMap[unit.unit_id] || [])
        .filter(({ ind }) => matchesFilter(ind));
      return { unit, members };
    }).filter(({ members, unit }) =>
      members.length > 0
      || !q
      || (unit.name || '').toLowerCase().includes(q)
    );

    const filteredUnattached = unattached.filter(matchesFilter);

    if (filteredUnits.length === 0 && filteredUnattached.length === 0) return;

    html += `
    <details class="tob-group" open>
      <summary class="tob-group-header">
        <span class="tob-affil-swatch" style="background:${affColor}"></span>
        <span class="tob-affil-label">${h(aff)}</span>
        <span class="tob-chevron">&#9658;</span>
      </summary>`;

    /* Units with members */
    filteredUnits.forEach(({ unit, members }) => {
      /* Sort members: Command tier first, then Company */
      members.sort((a, b) => {
        const tierOrder = { Command: 0, Company: 1, Exception: 2 };
        const aOrd = tierOrder[a.ind.tier] ?? 9;
        const bOrd = tierOrder[b.ind.tier] ?? 9;
        return aOrd - bOrd;
      });

      html += `
        <details class="tob-unit" open>
          <summary class="tob-unit-header">
            <span class="tob-chevron">&#9658;</span>
            <span class="tob-unit-name">${h(unit.name || unit.unit_id)}</span>
          </summary>
          <ul class="tob-members">
            ${members.map(({ ind, rank }) => `
              <li class="tob-ind-row" data-ind-id="${h(ind.ind_id)}" role="button" tabindex="0">
                <span class="dot dot-${affCls}" style="flex-shrink:0"></span>
                <span class="tob-ind-name">${h(ind.full_name || 'Unknown')}</span>
                <span class="tob-ind-rank">${h(rank)}</span>
              </li>`).join('')}
          </ul>
        </details>`;
    });

    /* Unattached individuals (in this affiliation but not in any unit) */
    if (filteredUnattached.length > 0) {
      html += `<ul class="tob-members">
        ${filteredUnattached.map(ind => `
          <li class="tob-ind-row" data-ind-id="${h(ind.ind_id)}" role="button" tabindex="0">
            <span class="dot dot-${affCls}" style="flex-shrink:0"></span>
            <span class="tob-ind-name">${h(ind.full_name || 'Unknown')}</span>
            <span class="tob-ind-rank">${h(ind.rank || '')}</span>
          </li>`).join('')}
      </ul>`;
    }

    html += `</details>`;
  });

  /* Exception individuals */
  if (exceptions.length > 0) {
    html += `
    <div class="tob-exception-section">
      <div class="tob-exception-header">
        <span class="tob-exception-label">Exception individuals</span>
      </div>
      ${exceptions.map(ind => `
        <div class="tob-exception-row" data-ind-id="${h(ind.ind_id)}" role="button" tabindex="0">
          <span class="dot dot-${PF.map.affiliationClass(ind.affiliation)}" style="flex-shrink:0;margin-top:3px"></span>
          <div>
            <div class="tob-exception-name">${h(ind.full_name || 'Unknown')}</div>
            <div class="tob-exception-reason">${h(ind.rank || '')}</div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  if (!html) {
    html = `<div style="padding:0.75rem 1rem;font-size:0.8rem;color:var(--text-muted);font-style:italic;">No results.</div>`;
  }

  container.innerHTML = html;

  /* ── Wire click handlers ──────────────────────────────────── */
  container.querySelectorAll('[data-ind-id]').forEach(el => {
    const activate = () => {
      const ind = PF.data.getIndividualById(el.dataset.indId);
      if (!ind) return;
      PF.panels.showIndividual(ind);
      PF.network.renderForIndividual(ind.ind_id);
      const lat = PF.data._parseCoord(ind.lat);
      const lng = PF.data._parseCoord(ind.lng);
      if (lat !== null && lng !== null) PF.map.focusOn(lat, lng, 12);
      /* Highlight active row */
      container.querySelectorAll('.tob-ind-row, .tob-exception-row')
        .forEach(r => r.classList.remove('active'));
      el.classList.add('active');
    };
    el.addEventListener('click', activate);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') activate(); });
  });
};

PF.panels._renderEventList = function () {
  const list  = document.getElementById('event-list');
  const items = (PF.data.raw.EVENTS || []).slice(0, 25);

  list.innerHTML = items.map(evt => {
    const isBattle = evt.type === 'battle';
    const dot = isBattle
      ? `<span style="width:8px;height:8px;background:#8b2020;border-radius:1px;transform:rotate(45deg);display:inline-block;flex-shrink:0"></span>`
      : `<span class="dot" style="background:#777;border-radius:1px;width:6px;height:6px;"></span>`;
    return `
      <li role="button" tabindex="0" data-evt-id="${h(evt.evt_id)}" data-evt-type="${h(evt.type || '')}">
        ${dot}
        <span>${h(evt.name || evt.evt_id)}</span>
        <span class="entity-meta">${h(evt.date || '')}</span>
      </li>`;
  }).join('');

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const evt = (PF.data.raw.EVENTS || []).find(e => e.evt_id === li.dataset.evtId);
      if (!evt) return;

      /* Battle-type events: find matching BATTLES record and enter Battle Mode */
      if (li.dataset.evtType === 'battle') {
        const battle = (PF.data.raw.BATTLES || []).find(b =>
          b.name === evt.name ||
          b.date === evt.date ||
          (Math.abs(PF.data._parseCoord(b.lat) - PF.data._parseCoord(evt.lat)) < 0.01 &&
           Math.abs(PF.data._parseCoord(b.lng) - PF.data._parseCoord(evt.lng)) < 0.01)
        );
        if (battle) { PF.panels.showBattle(battle); return; }
      }

      PF.panels.showEvent(evt);
    });
  });
};

PF.panels._renderBattleList = function () {
  const list = document.getElementById('battle-list');
  if (!list) return;
  const battles = PF.data.raw.BATTLES || [];
  list.innerHTML = battles.map(b => `
    <li role="button" tabindex="0" data-battle-id="${h(b.battle_id)}">
      <span style="width:8px;height:8px;background:#8b2020;border-radius:1px;transform:rotate(45deg);display:inline-block;flex-shrink:0"></span>
      <span>${h(b.name || b.battle_id)}</span>
      <span class="entity-meta">${h(b.date || '')}</span>
    </li>`).join('');

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const b = (PF.data.raw.BATTLES || []).find(x => x.battle_id === li.dataset.battleId);
      if (b) PF.panels.showBattle(b);
    });
  });
};

PF.panels._filterBrowser = function (view) {
  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  };

  show('panel-section-churches', view === 'church');
  show('browser-tob',            view === 'individual' || view === 'unit');
  show('panel-section-battles',  view === 'battle');
  show('panel-section-events',   false);   // Option B: events not shown in any mode
};

/* ================================================================
   Search
   ================================================================ */
PF.panels._onSearch = function (query) {
  if (!query || query.length < 2) {
    PF.panels._buildBrowser();
    return;
  }
  const results = PF.data.search(query);
  PF.panels._renderChurchList(results.churches);
  PF.panels._renderOrderOfBattle(query);
  PF.panels._filterBrowser(PF.panels._currentView || 'church');
};

/* ================================================================
   View switching
   ================================================================ */
PF.panels.setView = function (view) {
  PF.panels._currentView = view;
  PF.network.clear();

  const allInds  = PF.data.getIndividualsByDate(PF.timeline.currentDate);
  const churches = PF.data.getMappableChurches();

  switch (view) {
    case 'church':
      PF.map.layers.individuals.clearLayers();
      PF.map.renderChurches(churches);
      break;

    case 'individual':
      PF.map.layers.churches.clearLayers();
      PF.map.renderIndividuals(allInds);
      break;

    case 'unit':
      PF.map.renderIndividuals(allInds);
      PF.map.renderChurches(churches);
      break;

    case 'battle':
      PF.map.layers.individuals.clearLayers();
      PF.map.renderChurches(churches);
      PF.panels._renderBattleMarkers();
      /* Fit map to show all battle sites */
      PF.panels._fitBattles();
      break;
  }

  _renderBrowser();
};

PF.panels._renderBattleMarkers = function () {
  (PF.data.raw.BATTLES || []).forEach(b => {
    const lat = PF.data._parseCoord(b.lat);
    const lng = PF.data._parseCoord(b.lng);
    if (lat === null || lng === null) return;

    /* X-shaped battle site marker using divIcon */
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        width:18px; height:18px;
        position:relative; display:flex;
        align-items:center; justify-content:center;
      ">
        <div style="
          position:absolute;
          width:14px; height:3px;
          background:#8b2020;
          border-radius:1px;
          transform:rotate(45deg);
          box-shadow:0 1px 4px rgba(0,0,0,0.5);
        "></div>
        <div style="
          position:absolute;
          width:14px; height:3px;
          background:#8b2020;
          border-radius:1px;
          transform:rotate(-45deg);
          box-shadow:0 1px 4px rgba(0,0,0,0.5);
        "></div>
      </div>`,
      iconSize:   [18, 18],
      iconAnchor: [9, 9],
      popupAnchor:[0, -12],
    });

    const m = L.marker([lat, lng], { icon, title: b.name || b.battle_id, zIndexOffset: 50 });
    m.addTo(PF.map.layers.individuals);

    m.bindTooltip(
      `<strong>${h(b.name || b.battle_id)}</strong><br>${h(b.date || '')}` +
      `<br><em style="color:#9aafcc">Click to enter Battle Mode</em>`,
      { className: 'pf-tooltip' }
    );
    m.on('click', () => PF.panels.showBattle(b));
  });
};

PF.panels._fitBattles = function () {
  const battles = (PF.data.raw.BATTLES || []).filter(b =>
    PF.data._parseCoord(b.lat) !== null && PF.data._parseCoord(b.lng) !== null
  );
  if (battles.length === 0) return;

  if (battles.length === 1) {
    const b = battles[0];
    PF.map.focusOn(PF.data._parseCoord(b.lat), PF.data._parseCoord(b.lng), 12);
    return;
  }

  const lats = battles.map(b => PF.data._parseCoord(b.lat));
  const lngs = battles.map(b => PF.data._parseCoord(b.lng));
  PF.map.instance.fitBounds(
    [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
    { padding: [60, 60], maxZoom: 12, animate: true, duration: 0.7 }
  );
};

/* ================================================================
   Story panel — INDIVIDUAL
   ================================================================ */
PF.panels.showIndividual = function (ind) {
  _setActive('browser-tob', `[data-ind-id="${ind.ind_id}"]`);

  const sources  = PF.data.getSourcesForEntity(ind);
  const aff      = ind.affiliation || 'Unknown';
  const affCls   = PF.map.affiliationClass(aff);

  /* Split social neighbors: lateral coordination vs regular social */
  const LATERAL_TYPES = new Set(['intelligence contact', 'coordination contact', 'supply contact']);
  const allNeighbors  = PF.data.getNetworkNeighbors(ind.ind_id);
  const socialNeighbors  = allNeighbors.filter(({ relationship }) =>
    !LATERAL_TYPES.has((relationship || '').toLowerCase())
  );
  const lateralNeighbors = allNeighbors.filter(({ relationship }) =>
    LATERAL_TYPES.has((relationship || '').toLowerCase())
  );

  const propLinks = PF.data.getIndividualProperties(ind.ind_id);

  const html = `
    <div class="story-section">
      <div class="story-name">
        ${h(ind.full_name || 'Unknown')}
        <span class="affil-badge badge-${affCls}">${h(aff)}</span>
      </div>
      <div class="story-role">
        ${h(ind.tier || '')}${ind.rank ? ' · ' + h(ind.rank) : ''}
      </div>
    </div>

    <div class="story-section">
      <div class="story-section-label">Biographical</div>
      ${_dataRow('Lived', `${h(ind.birth_year || '?')} – ${h(ind.death_year || '?')}`)}
      ${ind.evidence_type ? _dataRow('Evidence', h(ind.evidence_type)) : ''}
      ${ind.pension_filed === 'Y' ? _dataRow('Pension', 'Filed pension application') : ''}
    </div>

    ${ind.ind_id === 'ind_006' ? `
    <div class="story-section" style="border-left:3px solid #c8a86b;padding-left:0.75rem">
      <p class="story-prose">Co-trustee of Old Bluff Presbyterian Church (1761–) and co-executor of Bluff Hector McNeill&#8217;s estate &#8212; while simultaneously representing Cumberland County at the Hillsboro Convention as a Patriot in 1776.</p>
    </div>` : ''}

    ${_buildOrgContext(ind, lateralNeighbors)}

    ${ind.battles_present ? `
    <div class="story-section">
      <div class="story-section-label">Military record</div>
      <p class="story-prose">${h(ind.battles_present)}</p>
    </div>` : ''}

    ${ind.exception_reason ? `
    <div class="story-section">
      <div class="story-section-label">Exception criteria</div>
      <p class="story-prose">${h(ind.exception_reason)}</p>
    </div>` : ''}

    ${socialNeighbors.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Social network — ${socialNeighbors.length} connection${socialNeighbors.length !== 1 ? 's' : ''}</div>
      <ul class="conn-list">
        ${socialNeighbors.slice(0, 14).map(({ individual: n, relationship }) => `
          <li data-ind-id="${h(n.ind_id)}" role="button" tabindex="0">
            <span class="dot dot-${PF.map.affiliationClass(n.affiliation)}"></span>
            ${h(n.full_name || 'Unknown')}
            <span class="conn-rel">${h(relationship)}</span>
          </li>`).join('')}
        ${socialNeighbors.length > 14
          ? `<li style="font-style:italic;color:var(--text-muted)">…and ${socialNeighbors.length - 14} more</li>`
          : ''}
      </ul>
    </div>` : ''}

    ${_buildPropertyHoldings(propLinks)}

    ${sources.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Sources</div>
      ${sources.map(src => _srcCitation(src)).join('')}
    </div>` : ''}
  `;

  _showEntity(ind.full_name || 'Individual', html);

  /* Wire social neighbor clicks */
  document.querySelectorAll('#story-entity .conn-list li[data-ind-id]').forEach(li => {
    const go = () => {
      const neighbor = PF.data.getIndividualById(li.dataset.indId);
      if (!neighbor) return;
      PF.panels.showIndividual(neighbor);
      PF.network.renderForIndividual(neighbor.ind_id);
    };
    li.addEventListener('click', go);
    li.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });

  /* Wire lateral coordination clicks */
  document.querySelectorAll('#story-entity .lateral-list li[data-ind-id]').forEach(li => {
    li.addEventListener('click', () => {
      const n = PF.data.getIndividualById(li.dataset.indId);
      if (n) { PF.panels.showIndividual(n); PF.network.renderForIndividual(n.ind_id); }
    });
  });

  /* Wire command chain unit clicks */
  document.querySelectorAll('#story-entity .cmd-chain-node[data-unit-id]').forEach(node => {
    node.addEventListener('click', () => {
      const unit = PF.data.getUnitById(node.dataset.unitId);
      if (unit) PF.panels.showUnit(unit);
    });
  });

  /* Wire property row clicks — pan to marker and pulse it */
  document.querySelectorAll('#story-entity .prop-holdings-list li[data-prop-id]').forEach(li => {
    li.addEventListener('click', () => {
      const lat = PF.data._parseCoord(li.dataset.propLat);
      const lng = PF.data._parseCoord(li.dataset.propLng);
      if (lat !== null && lng !== null) PF.map.focusOn(lat, lng, 14);
      PF.map.pulseProperty(li.dataset.propId);
    });
  });

  /* Render property markers for this individual */
  PF.map.clearProperties();
  if (propLinks.length > 0) PF.map.renderProperties(propLinks);
};

/**
 * Build the Organizational Context section HTML for an individual.
 * Shows: command chain diagram, affiliation/service timeline, lateral coordination.
 *
 * @param {Object} ind        — INDIVIDUALS row
 * @param {Array}  lateralNeighbors — pre-filtered lateral coordination neighbors
 * @returns {string} HTML
 */
function _buildOrgContext(ind, lateralNeighbors) {
  const { membership, chain } = PF.data.getCommandChain(ind.ind_id);
  const allMemberships = PF.data.getUnitMemberships(ind.ind_id);

  /* ── Command chain diagram ───────────────────────────────── */
  let chainHtml = '';
  if (chain.length === 0) {
    chainHtml = `<div class="cmd-chain-empty">No unit record in database.</div>`;
  } else {
    chainHtml = `<div class="cmd-chain">`;
    chain.forEach((unit, i) => {
      const affCls   = PF.map.affiliationClass(unit.affiliation);
      const affColor = PF.map.affiliationColor(unit.affiliation);
      const dateStr  = unit.active_from
        ? (unit.active_to ? `${unit.active_from}–${unit.active_to}` : `from ${unit.active_from}`)
        : '';

      chainHtml += `
        <div class="cmd-chain-node ${i === 0 ? 'cmd-chain-primary' : ''}"
             data-unit-id="${h(unit.unit_id)}" tabindex="0" role="button"
             title="Click to open unit record">
          <span class="dot dot-${affCls}" style="flex-shrink:0"></span>
          <span class="cmd-unit-name">${h(unit.name || unit.unit_id)}</span>
          ${unit.affiliation && i > 0 ? `<span class="cmd-unit-affil">${h(unit.affiliation)}</span>` : ''}
          ${dateStr ? `<span class="cmd-unit-dates">${h(dateStr)}</span>` : ''}
        </div>`;

      if (i < chain.length - 1) {
        chainHtml += `<div class="cmd-chain-connector"></div>`;
      }
    });

    /* If the chain ends without reaching a top-level parent, show open terminus */
    const topUnit = chain[chain.length - 1];
    if (topUnit && topUnit.parent_unit) {
      chainHtml += `
        <div class="cmd-chain-connector"></div>
        <div class="cmd-chain-node" style="border-style:dashed;color:var(--text-muted)">
          <span style="font-style:italic;font-size:0.75rem;">parent unit not yet in database</span>
        </div>`;
    }

    chainHtml += `</div>`;
  }

  /* ── Service/affiliation timeline ────────────────────────── */
  let timelineHtml = '';
  if (allMemberships.length > 0) {
    timelineHtml = `<div class="affil-timeline">`;
    allMemberships.forEach(link => {
      const unit   = PF.data.getUnitById(link.unit_id);
      const affCls = unit ? PF.map.affiliationClass(unit.affiliation) : 'unknown';
      const period = link.date_from
        ? (link.date_to ? `${link.date_from}–${link.date_to}` : `${link.date_from}–`)
        : '';
      timelineHtml += `
        <div class="affil-timeline-entry">
          <span class="affil-timeline-period">${h(period)}</span>
          <span class="dot dot-${affCls}" style="flex-shrink:0"></span>
          <span>${h(link.rank || '')}${unit ? ', ' + h(unit.name) : ''}</span>
        </div>`;
    });
    timelineHtml += `</div>`;
  }

  /* ── Lateral coordination ─────────────────────────────────── */
  let lateralHtml = '';
  if (lateralNeighbors.length > 0) {
    lateralHtml = `
      <div style="margin-top:0.75rem">
        <div class="story-section-label" style="margin-bottom:0.4rem">Lateral coordination</div>
        <ul class="lateral-list">
          ${lateralNeighbors.map(({ individual: n, relationship }) => `
            <li data-ind-id="${h(n.ind_id)}" role="button" tabindex="0">
              <span class="dot dot-${PF.map.affiliationClass(n.affiliation)}"></span>
              ${h(n.full_name || 'Unknown')}
              <span class="lateral-rel-type">${h(relationship)}</span>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  /* ── Assemble section ────────────────────────────────────── */
  const hasContent = chain.length > 0 || allMemberships.length > 0 || lateralNeighbors.length > 0;
  if (!hasContent) return '';

  return `
    <div class="story-section">
      <div class="story-section-label">Organizational context</div>
      ${chainHtml}
      ${timelineHtml}
      ${lateralHtml}
    </div>`;
}

/**
 * Build the Property Holdings section HTML for an individual story panel.
 * Returns empty string when the individual has no linked properties.
 *
 * Uses only existing CSS classes (story-section, story-section-label,
 * conn-list, conn-rel) — no new styles introduced.
 *
 * @param {Array} propLinks — result of PF.data.getIndividualProperties()
 * @returns {string} HTML
 */
function _buildPropertyHoldings(propLinks) {
  if (!propLinks || propLinks.length === 0) return '';

  const rows = propLinks.map(({ property, relationship, date_from, date_to }) => {
    const subParts = [];
    if (property.type)    subParts.push(h(property.type));
    if (property.acreage) subParts.push(h(property.acreage) + '\u00a0ac.');
    const dateStr = date_from
      ? (date_to ? `${h(date_from)}–${h(date_to)}` : `from ${h(date_from)}`)
      : '';
    if (dateStr) subParts.push(dateStr);
    const subtext = subParts.join(' · ');

    return `
      <li data-prop-id="${h(property.prop_id)}"
          data-prop-lat="${h(property.lat || '')}"
          data-prop-lng="${h(property.lng || '')}"
          role="button" tabindex="0">
        <span style="width:8px;height:8px;background:#c8a86b;border:1px solid rgba(255,255,255,0.4);transform:rotate(45deg);flex-shrink:0;display:inline-block"></span>
        <span style="flex:1;min-width:0">
          <span style="display:block">${h(property.name || property.prop_id)}</span>
          ${subtext ? `<span style="display:block;font-size:0.68rem;color:var(--text-muted);font-style:italic">${subtext}</span>` : ''}
        </span>
        <span class="conn-rel">${h(relationship)}</span>
      </li>`;
  }).join('');

  return `
    <div class="story-section">
      <div class="story-section-label">Property holdings — ${propLinks.length}</div>
      <ul class="conn-list prop-holdings-list">
        ${rows}
      </ul>
    </div>`;
}

/* ================================================================
   Story panel — CHURCH
   ================================================================ */
PF.panels.showChurch = function (ch) {
  _setActive('church-list', `[data-ch-id="${ch.ch_id}"]`);

  const lat     = PF.data._parseCoord(ch.lat);
  const lng     = PF.data._parseCoord(ch.lng);
  const members = PF.data.getChurchMembers(ch.ch_id);
  const sources = PF.data.getSourcesForEntity(ch);

  /* Clear any prior church's assembly animation, then hide congregation
     members from the individuals layer so the animate button reveals them. */
  PF.map.clearAssembly();
  const memberIds = new Set(members.map(m => m.ind_id));
  PF.map.hideIndividuals(memberIds);

  if (lat !== null && lng !== null) {
    PF.map.focusOn(lat, lng, 12);
    PF.map.highlightChurch(lat, lng);
  }

  /* Count members by side using the full taxonomy */
  const PATRIOT_AFFILIATIONS  = new Set(['Continental Army','State Line','Patriot Militia','Patriot Volunteer','Patriot']);
  const LOYALIST_AFFILIATIONS = new Set(['British Regular','Provincial Corps','Loyalist Militia','Associated Loyalist','Loyalist']);
  const loyalists = members.filter(m => LOYALIST_AFFILIATIONS.has(m.affiliation)).length;
  const patriots  = members.filter(m => PATRIOT_AFFILIATIONS.has(m.affiliation)).length;
  const unknowns  = members.length - loyalists - patriots;

  /* Coordinate provenance note — flag if the church record itself has a note */
  const coordNote = ch.note
    ? `<p style="font-size:0.76rem;color:#a06030;margin-top:0.4rem;font-style:italic;">${h(ch.note)}</p>`
    : '';

  const html = `
    <div class="story-section">
      <div class="story-name">${h(ch.name || 'Church')}</div>
      <div class="story-role">${h(ch.denomination || '')} · est. ${h(ch.founded_yr || '?')}</div>
      ${coordNote}
    </div>

    <div class="story-section">
      <div class="story-section-label">Congregation (recorded)</div>
      ${_dataRow('Total members', members.length)}
      ${members.length > 0 ? `
        ${_dataRow('Loyalist',  loyalists)}
        ${_dataRow('Patriot',   patriots)}
        ${_dataRow('Unknown',   unknowns)}` : ''}
    </div>

    ${ch.record_repository ? `
    <div class="story-section">
      <div class="story-section-label">Archival record</div>
      ${_dataRow('Repository', h(ch.record_repository))}
    </div>` : ''}

    ${members.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Known members</div>
      <ul class="conn-list">
        ${members.slice(0, 16).map(m => `
          <li data-ind-id="${h(m.ind_id)}" role="button" tabindex="0">
            <span class="dot dot-${PF.map.affiliationClass(m.affiliation)}"></span>
            ${h(m.full_name || 'Unknown')}
            <span class="conn-rel">${h(m.affiliation || '')}</span>
          </li>`).join('')}
        ${members.length > 16 ? `<li style="font-style:italic;color:var(--text-muted)">…and ${members.length - 16} more</li>` : ''}
      </ul>
      <button class="story-action-btn" id="btn-assemble">Animate congregation assembly</button>
    </div>` : ''}

    ${sources.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Sources</div>
      ${sources.map(src => _srcCitation(src)).join('')}
    </div>` : ''}
  `;

  _showEntity(ch.name || 'Church', html);

  /* Wire member clicks */
  document.querySelectorAll('#story-entity .conn-list li[data-ind-id]').forEach(li => {
    li.addEventListener('click', () => {
      const ind = PF.data.getIndividualById(li.dataset.indId);
      if (!ind) return;
      PF.panels.showIndividual(ind);
      PF.network.renderForIndividual(ind.ind_id);
    });
  });

  /* Assembly animation */
  const assembleBtn = document.getElementById('btn-assemble');
  if (assembleBtn && lat !== null && lng !== null) {
    assembleBtn.addEventListener('click', () => {
      PF.map.animateAssembly(members, lat, lng);
    });
  }
};

/* ================================================================
   Story panel — EVENT
   ================================================================ */
PF.panels.showEvent = function (evt) {
  const lat = PF.data._parseCoord(evt.lat);
  const lng = PF.data._parseCoord(evt.lng);
  if (lat !== null && lng !== null) PF.map.focusOn(lat, lng, 12);

  const sources = PF.data.getSourcesForEntity(evt);

  const html = `
    <div class="story-section">
      <div class="story-name">${h(evt.name || 'Event')}</div>
      <div class="story-role">${h(evt.type || '')} · ${h(evt.date || '')}</div>
    </div>

    ${evt.description ? `
    <div class="story-section">
      <p class="story-prose">${h(evt.description)}</p>
    </div>` : ''}

    ${sources.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Sources</div>
      ${sources.map(src => _srcCitation(src)).join('')}
    </div>` : ''}
  `;

  _showEntity(evt.name || 'Event', html);
};

/* ================================================================
   Story panel — UNIT
   ================================================================ */
PF.panels.showUnit = function (unit) {
  const affCls  = PF.map.affiliationClass(unit.affiliation);
  const members = PF.data.getUnitMembers(unit.unit_id);
  const sources = PF.data.getSourcesForEntity(unit);
  const origin  = PF.data.getUnitCommunityOrigin(unit.unit_id);

  const dateStr = unit.active_from
    ? (unit.active_to
        ? `${h(unit.active_from)}–${h(unit.active_to)}`
        : `active from ${h(unit.active_from)}`)
    : '';

  const html = `
    <div class="story-section">
      <div class="story-name">${h(unit.name || unit.unit_id)}</div>
      <div class="story-role">
        <span class="affil-badge badge-${affCls}">${h(unit.affiliation || '')}</span>
        ${dateStr ? ` &nbsp;·&nbsp; ${dateStr}` : ''}
      </div>
    </div>

    ${unit.notes ? `
    <div class="story-section">
      <p class="story-prose">${h(unit.notes)}</p>
    </div>` : ''}

    ${members.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Officers on record — ${members.length}</div>
      <ul class="conn-list">
        ${members.map(m => {
          const unitRank = PF.data.getIndUnitRank(m.ind_id, unit.unit_id) || m.rank || m.tier || '';
          return `
          <li data-ind-id="${h(m.ind_id)}" role="button" tabindex="0">
            <span class="dot dot-${PF.map.affiliationClass(m.affiliation)}"></span>
            ${h(m.full_name || 'Unknown')}
            <span class="conn-rel">${h(unitRank)}</span>
          </li>`;
        }).join('')}
      </ul>
    </div>` : ''}

    ${_buildCommunityOrigin(unit, origin)}

    ${sources.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Sources</div>
      ${sources.map(src => _srcCitation(src)).join('')}
    </div>` : ''}
  `;

  _showEntity(unit.name || 'Unit', html);

  /* Officer list clicks */
  document.querySelectorAll('#story-entity .conn-list li[data-ind-id]').forEach(li => {
    li.addEventListener('click', () => {
      const ind = PF.data.getIndividualById(li.dataset.indId);
      if (ind) { PF.panels.showIndividual(ind); PF.network.renderForIndividual(ind.ind_id); }
    });
  });

  /* Community origin — church name clicks */
  document.querySelectorAll('#story-entity .community-church-header[data-ch-id]').forEach(el => {
    el.addEventListener('click', () => {
      const ch = PF.data.getChurchById(el.dataset.chId);
      if (ch) PF.panels.showChurch(ch);
    });
  });

  /* Community origin — member name clicks */
  document.querySelectorAll('#story-entity .community-member-list li[data-ind-id]').forEach(li => {
    li.addEventListener('click', () => {
      const ind = PF.data.getIndividualById(li.dataset.indId);
      if (ind) { PF.panels.showIndividual(ind); PF.network.renderForIndividual(ind.ind_id); }
    });
  });
};

/**
 * Build the Community Origin section HTML for a unit story panel.
 * This section surfaces the pre-war community networks that fed the unit —
 * churches and properties cross-referenced against unit membership.
 *
 * @param {Object} unit    — UNITS row
 * @param {Object} origin  — result of PF.data.getUnitCommunityOrigin()
 * @returns {string} HTML
 */
function _buildCommunityOrigin(unit, origin) {
  const { churches, properties, totalMembers, linkedMembers } = origin;
  const hasData = churches.length > 0 || properties.length > 0;

  /* Interpretive lead sentence using live counts */
  let lede = '';
  if (totalMembers > 0 && linkedMembers > 0) {
    const pct   = Math.round((linkedMembers / totalMembers) * 100);
    const churchCount = churches.length;
    lede = `
      <p class="community-origin-lede">
        <strong>${linkedMembers} of ${totalMembers}</strong> officers on record
        share documented pre-war community ties in this area
        (${pct}% of recorded membership).
        ${churchCount === 1
          ? `All traced to a single congregation, suggesting the unit drew its core from an existing parish network.`
          : churchCount > 1
            ? `Ties distributed across ${churchCount} congregations, indicating a broader community coalition.`
            : ''}
      </p>`;
  }

  /* Church entries */
  let churchesHtml = '';
  churches.forEach(({ church, members }) => {
    churchesHtml += `
      <div class="community-church-entry">
        <div class="community-church-header" data-ch-id="${h(church.ch_id)}"
             role="button" tabindex="0" title="Open church record">
          <span class="dot dot-church"></span>
          <span class="community-church-name">${h(church.name || church.ch_id)}</span>
          <span class="community-church-count">${members.length} officer${members.length !== 1 ? 's' : ''}</span>
        </div>
        <ul class="community-member-list">
          ${members.map(m => {
            const rank = PF.data.getIndUnitRank(m.ind_id, unit.unit_id) || m.rank || '';
            return `
            <li data-ind-id="${h(m.ind_id)}" role="button" tabindex="0">
              <span class="dot dot-${PF.map.affiliationClass(m.affiliation)}"></span>
              ${h(m.full_name || 'Unknown')}
              <span class="community-member-rank">${h(rank)}</span>
            </li>`;
          }).join('')}
        </ul>
      </div>`;
  });

  /* Property entries */
  let propertiesHtml = '';
  properties.forEach(({ property, members }) => {
    propertiesHtml += `
      <div class="community-property-entry">
        <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.25rem">
          <span style="font-size:0.78rem;font-weight:500;color:var(--text-secondary)">${h(property.name || property.prop_id)}</span>
          <span class="community-church-count">${members.length}</span>
        </div>
        <ul class="community-member-list">
          ${members.map(m => `
            <li data-ind-id="${h(m.ind_id)}" role="button" tabindex="0">
              <span class="dot dot-${PF.map.affiliationClass(m.affiliation)}"></span>
              ${h(m.full_name || 'Unknown')}
            </li>`).join('')}
        </ul>
      </div>`;
  });

  /* Empty state for seed data */
  const emptyNote = !hasData && totalMembers > 0
    ? `<p class="community-origin-empty">No church or property records yet linked for this unit's members. Add entries to IND_CHURCH and IND_PROPERTY to populate this section.</p>`
    : '';

  return `
    <div class="story-section">
      <div class="story-section-label">Community origin</div>
      <div class="community-origin">
        ${lede}
        ${churchesHtml}
        ${propertiesHtml}
        ${emptyNote}
      </div>
    </div>`;
}

/* ================================================================
   Story panel — PROPERTY
   ================================================================ */

/**
 * Show a brief property record in the story panel.
 * Called when the user clicks a property marker on the map.
 *
 * @param {Object} property    — PROPERTIES row
 * @param {string} relationship — relationship type from IND_PROPERTY link
 */
PF.panels.showProperty = function (property, relationship) {
  const sources = PF.data.getSourcesForEntity(property);

  const dateStr = property.date_from
    ? (property.date_to
        ? `${h(property.date_from)}–${h(property.date_to)}`
        : `from ${h(property.date_from)}`)
    : '';

  const html = `
    <div class="story-section">
      <div class="story-name">${h(property.name || property.prop_id)}</div>
      <div class="story-role">
        ${h(property.type || 'Property')}
        ${relationship ? ` &nbsp;·&nbsp; <em>${h(relationship)}</em>` : ''}
      </div>
    </div>

    <div class="story-section">
      <div class="story-section-label">Details</div>
      ${property.acreage  ? _dataRow('Acreage',    h(property.acreage))   : ''}
      ${property.plat_ref ? _dataRow('Plat ref',   h(property.plat_ref))  : ''}
      ${dateStr           ? _dataRow('Date range', dateStr)               : ''}
    </div>

    ${property.notes ? `
    <div class="story-section">
      <p class="story-prose">${h(property.notes)}</p>
    </div>` : ''}

    ${sources.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Sources</div>
      ${sources.map(src => _srcCitation(src)).join('')}
    </div>` : ''}
  `;

  _showEntity(property.name || 'Property', html);
};

/* ================================================================
   Story panel — BATTLE
   Entry point: if UNIT_POSITIONS exist, enter Battle Mode.
   If no positions are available (future battle not yet populated),
   fall back to a basic info panel.
   ================================================================ */
PF.panels.showBattle = function (battle) {
  /* Enter Battle Mode if position data exists */
  if (PF.battle && typeof PF.battle.enter === 'function') {
    const entered = PF.battle.enter(battle);
    if (entered !== false) return;
  }

  /* Fallback — no UNIT_POSITIONS for this battle yet */
  const lat = PF.data._parseCoord(battle.lat);
  const lng = PF.data._parseCoord(battle.lng);
  if (lat !== null && lng !== null) PF.map.focusOn(lat, lng, 13);

  const sources = PF.data.getSourcesForEntity(battle);

  const html = `
    <div class="story-section">
      <div class="story-name">${h(battle.name || battle.battle_id || 'Battle')}</div>
      <div class="story-role">${h(battle.date || '')}${battle.location ? ' · ' + h(battle.location) : ''}</div>
    </div>

    <div class="story-section">
      <div class="battle-confidence-banner confidence-medium">
        Battle reconstruction not yet available — unit position data has not been entered.
      </div>
    </div>

    ${battle.description ? `
    <div class="story-section">
      <p class="story-prose">${h(battle.description)}</p>
    </div>` : ''}

    ${sources.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Sources</div>
      ${sources.map(src => _srcCitation(src)).join('')}
    </div>` : ''}
  `;

  _showEntity(battle.name || 'Battle', html);
};

/* ================================================================
   Story panel — BATTLE PHASE (called by PF.battle while in Battle Mode)
   Shows: confidence banner, phase label, per-unit sections with
   action text + community origin (the men on the bridge = the men
   from the church rolls).
   ================================================================ */
PF.panels.showBattlePhase = function (battle, phase) {
  /* Sync left panel roster — idempotent, safe to call on every phase change */
  _enterBattlePanel(battle);
  _renderBattleRoster(phase);

  const conf      = battle.reconstruction_confidence || 'Medium';
  const confClass = conf.toLowerCase();
  const nPhases   = PF.battle._phases.length;

  /* Build a section for each unit position in this phase */
  const unitSectionsHtml = phase.positions.map(pos => {
    const unit    = PF.data.getUnitById(pos.unit_id);
    const affCls  = unit ? PF.map.affiliationClass(unit.affiliation) : 'unknown';
    const sources = PF.data.getSourcesForEntity(pos);
    const origin  = PF.data.getBattleCommunityOrigin(battle.battle_id, pos.unit_id);

    const posConf = (pos.confidence || '').toLowerCase();

    return `
      <div class="battle-unit-section">
        <div class="battle-unit-header">
          <span class="affil-badge badge-${affCls}">${h(unit ? unit.affiliation : 'Unknown')}</span>
          <span class="battle-unit-name">${h(unit ? unit.name : pos.unit_id)}</span>
        </div>

        <div class="battle-action-text">${h(pos.action || '')}</div>

        <div style="margin-bottom:0.35rem">
          ${pos.strength_estimated && pos.strength_estimated !== '0' ? _dataRow('Strength', '~' + h(pos.strength_estimated) + ' men') : ''}
          ${pos.facing ? _dataRow('Facing', h(pos.facing)) : ''}
        </div>

        ${posConf && posConf !== 'high' ? `
          <span class="battle-pos-confidence confidence-${posConf}">
            Position confidence: ${h(pos.confidence)}
            ${pos.coord_confidence ? ' · ' + h(pos.coord_confidence) : ''}
          </span>` : ''}

        ${_buildBattleParticipants(battle.battle_id, pos.unit_id)}

        ${_buildBattleCommunityOrigin(origin)}

        ${sources.length > 0 ? `
          <div class="story-section" style="margin-top:0.5rem">
            <div class="story-section-label">Sources — this position</div>
            ${sources.map(src => _srcCitation(src)).join('')}
          </div>` : ''}
      </div>`;
  }).join('');

  const html = `
    <div class="story-section">
      <div class="battle-confidence-banner confidence-${confClass}">
        <strong>${h(conf)} confidence reconstruction</strong> —
        sourced from Moore's after-action letter (2 March 1776) and Rankin (1953 NCHR).
        Unit positions are approximations; exact timing uncertain.
      </div>
    </div>

    ${_buildWeatherSection(battle)}

    <div class="story-section">
      <div class="story-section-label">
        Phase ${phase.phaseIndex} of ${nPhases} — ${h(phase.phaseLabel)}
      </div>
      ${unitSectionsHtml}
    </div>
  `;

  _showEntity(`Phase ${phase.phaseIndex}: ${phase.phaseLabel}`, html);

  /* Wire participant and community member clicks → individual story panel */
  document.querySelectorAll('#story-entity li[data-ind-id]').forEach(li => {
    li.addEventListener('click', () => {
      const ind = PF.data.getIndividualById(li.dataset.indId);
      if (ind) PF.panels.showIndividual(ind);
    });
  });

  /* Wire community church clicks */
  document.querySelectorAll('#story-entity .community-church-header[data-ch-id]').forEach(el => {
    el.addEventListener('click', () => {
      const ch = PF.data.getChurchById(el.dataset.chId);
      if (ch) PF.panels.showChurch(ch);
    });
  });
};

/**
 * Build the weather conditions section for a battle story panel.
 * Returns empty string if no WEATHER rows exist for this battle.
 */
const _WEATHER_EMOJI = { fog:'🌫️', rain:'🌧️', clear:'☀️', snow:'🌨️', overcast:'☁️', wind:'💨', sleet:'🌦️', storm:'⛈️' };

function _buildWeatherSection(battle) {
  const rows = (PF.data.raw.WEATHER || []).filter(w => w.battle_id === battle.battle_id);
  if (rows.length === 0) return '';

  const conf      = rows[0].confidence || 'Medium';
  const confClass = conf.toLowerCase();

  return `
    <div class="story-section">
      <div class="story-section-label">Weather conditions</div>

      ${rows.map(w => {
        const emoji = _WEATHER_EMOJI[(w.icon || '').toLowerCase()] || '';
        return `
        <div class="weather-phase-block">
          <div class="weather-phase-header">
            ${emoji ? `<span class="weather-icon">${emoji}</span>` : ''}
            <span class="weather-condition">${h(w.condition_label || '')}</span>
            ${w.phase ? `<span class="weather-phase-label">${h(w.phase)}</span>` : ''}
            ${w.temp_estimate ? `<span class="weather-temp">${h(w.temp_estimate)}</span>` : ''}
          </div>
          ${w.narrative ? `<p class="weather-narrative">${h(w.narrative)}</p>` : ''}
        </div>`;
      }).join('')}

      ${rows[0].seasonal_context ? `<p class="weather-seasonal">${h(rows[0].seasonal_context)}</p>` : ''}

      <div class="weather-footer">
        ${rows[0].primary_ref ? `<span class="weather-ref">${h(rows[0].primary_ref)}</span>` : ''}
        <span class="battle-pos-confidence confidence-${confClass}">${h(conf)} confidence</span>
      </div>
    </div>`;
}

/**
 * Build the named participants list for a unit at a battle.
 * Shows individuals in BATTLE_PARTICIPANTS for this unit, with role and
 * casualty status. Clicking a name opens the individual story panel.
 */
function _buildBattleParticipants(battle_id, unit_id) {
  const participants = PF.data.getBattleParticipants(battle_id, unit_id);
  if (participants.length === 0) return '';

  return `
    <div class="story-section" style="margin-top:0.5rem">
      <div class="story-section-label">Named individuals — database record</div>
      <ul class="conn-list">
        ${participants.map(({ bp, individual }) => {
          const affCls   = PF.map.affiliationClass(individual.affiliation);
          const casualty = bp.casualty && bp.casualty !== 'None'
            ? `<span style="color:#a04040;font-size:0.68rem;margin-left:0.3rem">${h(bp.casualty)}</span>`
            : '';
          return `
            <li data-ind-id="${h(individual.ind_id)}" role="button" tabindex="0">
              <span class="dot dot-${affCls}"></span>
              ${h(individual.full_name || 'Unknown')}
              ${casualty}
              <span class="conn-rel">${h(bp.role || '')}</span>
            </li>`;
        }).join('')}
      </ul>
    </div>`;
}

/**
 * Build the community origin section for a battle unit phase.
 * Shows which documented participants appear in congregation records.
 */
function _buildBattleCommunityOrigin(origin) {
  if (!origin || origin.churches.length === 0) return '';

  const { churches, participants } = origin;
  const linkedCount = churches.reduce((n, { members }) => n + members.length, 0);

  return `
    <div class="battle-community-origin">
      <div class="story-section-label" style="margin-bottom:0.4rem;border-bottom:none">
        Community network
      </div>
      <p class="community-origin-lede">
        <strong>${linkedCount} officer${linkedCount !== 1 ? 's' : ''}</strong>
        in this unit appear in pre-war congregation records.
        The men on the bridge are the same men from the church rolls.
      </p>
      ${churches.map(({ church, members }) => `
        <div class="community-church-entry">
          <div class="community-church-header" data-ch-id="${h(church.ch_id)}"
               role="button" tabindex="0" title="Open church record">
            <span class="dot dot-church"></span>
            <span class="community-church-name">${h(church.name || church.ch_id)}</span>
            <span class="community-church-count">${members.length}</span>
          </div>
          <ul class="community-member-list">
            ${members.map(m => `
              <li data-ind-id="${h(m.ind_id)}" role="button" tabindex="0">
                <span class="dot dot-${PF.map.affiliationClass(m.affiliation)}"></span>
                ${h(m.full_name || 'Unknown')}
              </li>`).join('')}
          </ul>
        </div>`).join('')}
    </div>`;
}

/* ================================================================
   Source tray
   ================================================================ */
PF.panels.showSource = function (src_id) {
  const src = PF.data.getSourceById(src_id);
  if (!src) return;

  document.getElementById('source-tray-title').textContent = `Source · ${src.src_id}`;

  const digitized = src.digitized === 'Y';
  const hasUrl    = src.url && src.url.trim().length > 0;

  document.getElementById('source-tray-body').innerHTML = `
    <div class="src-doc-title">${h(src.title || 'Untitled')}</div>
    <div class="src-doc-meta">
      ${src.type       ? h(src.type) + ' &nbsp;·&nbsp; ' : ''}
      ${src.repository ? h(src.repository) : ''}
      ${src.zone       ? ' &nbsp;·&nbsp; Zone ' + h(src.zone) : ''}
    </div>
    ${src.evidence_type ? `<div class="src-doc-meta">Evidence type: ${h(src.evidence_type)}</div>` : ''}
    ${digitized && hasUrl
      ? `<a class="src-doc-link" href="${h(src.url)}" target="_blank" rel="noopener noreferrer">View document ↗</a>`
      : digitized
        ? '<div class="src-doc-meta"><em>Digitized — URL not yet entered</em></div>'
        : '<div class="src-doc-meta"><em>Not yet digitized — consult repository</em></div>'
    }
  `;

  document.getElementById('source-tray').classList.remove('hidden');
};

/* ================================================================
   Timeline hook — weather card
   ================================================================ */
PF.panels.onDateChange = function (date) {
  const cardEl = document.getElementById('weather-card');
  if (!cardEl) return;

  const year = date.getFullYear();

  /* Find battles whose date falls in this year */
  const battles = (PF.data.raw.BATTLES || []).filter(b => {
    const m = /(\d{4})/.exec(b.date || '');
    return m && parseInt(m[1]) === year;
  });

  /* For each matching battle, collect WEATHER rows */
  let html = '';
  battles.forEach(battle => {
    const rows = (PF.data.raw.WEATHER || []).filter(w => w.battle_id === battle.battle_id);
    if (rows.length === 0) return;

    const conf      = rows[0].confidence || 'Medium';
    const confClass = conf.toLowerCase();

    html += `
      <div class="story-section">
        <div class="story-section-label">Weather conditions</div>
        <div class="weather-battle-meta">${h(battle.name || battle.battle_id)} &nbsp;·&nbsp; ${h(battle.date || '')}</div>

        ${rows.map(w => `
          <div class="weather-phase-block">
            <div class="weather-phase-header">
              ${w.icon ? `<span class="weather-icon">${h(w.icon)}</span>` : ''}
              <span class="weather-condition">${h(w.condition_label || '')}</span>
              ${w.phase ? `<span class="weather-phase-label">${h(w.phase)}</span>` : ''}
              ${w.temp_estimate ? `<span class="weather-temp">${h(w.temp_estimate)}</span>` : ''}
            </div>
            ${w.narrative ? `<p class="weather-narrative">${h(w.narrative)}</p>` : ''}
          </div>`).join('')}

        ${rows[0].seasonal_context ? `<p class="weather-seasonal">${h(rows[0].seasonal_context)}</p>` : ''}

        <div class="weather-footer">
          ${rows[0].primary_ref ? `<span class="weather-ref">${h(rows[0].primary_ref)}</span>` : ''}
          <span class="battle-pos-confidence confidence-${confClass}">${h(conf)} confidence</span>
        </div>
      </div>`;
  });

  if (!html) {
    cardEl.classList.add('hidden');
    cardEl.innerHTML = '';
    return;
  }

  cardEl.innerHTML = html;
  cardEl.classList.remove('hidden');
};

/* ================================================================
   Reset
   ================================================================ */
PF.panels.resetStory = function () {
  /* Restore left panel to search mode if we were showing the battle roster */
  _exitBattlePanel();

  /* If in battle mode, exit cleanly first (but silently to avoid recursion) */
  if (PF.battle && PF.battle._active) {
    PF.battle.exit(true);
  }

  document.getElementById('story-title').textContent = 'Cross Creek, 1758–1783';
  document.getElementById('story-close').classList.add('hidden');
  document.getElementById('story-default').classList.remove('hidden');
  document.getElementById('story-entity').classList.add('hidden');
  document.getElementById('source-tray').classList.add('hidden');

  PF.network.clear();
  PF.map.clearAssembly();
  PF.map.clearProperties();

  /* Restore congregation members that showChurch hid — but only in views
     that show the individuals layer (church view intentionally keeps it empty). */
  const view = PF.panels._currentView;
  if (view === 'individual' || view === 'unit') {
    PF.map.renderIndividuals(PF.data.getIndividualsByDate(PF.timeline.currentDate));
  }

  if (PF.map._churchHighlight) {
    PF.map.instance.removeLayer(PF.map._churchHighlight);
    PF.map._churchHighlight = null;
  }

  /* Clear active states in browser */
  document.querySelectorAll('#browser-results .sr-item.active').forEach(el => el.classList.remove('active'));
};

/* ================================================================
   Internal helpers
   ================================================================ */

function _showEntity(title, html) {
  if (PF.mob) PF.mob.switchTab('story');   // auto-switch on mobile; no-op on desktop
  document.getElementById('story-title').textContent = title;
  document.getElementById('story-close').classList.remove('hidden');
  document.getElementById('story-default').classList.add('hidden');

  const entityEl = document.getElementById('story-entity');
  entityEl.classList.remove('hidden');
  entityEl.innerHTML = html;

  /* Wire source refs */
  entityEl.querySelectorAll('.src-ref[data-src-id]').forEach(el => {
    el.addEventListener('click', () => PF.panels.showSource(el.dataset.srcId));
  });

  /* Scroll to top */
  document.getElementById('story-content').scrollTop = 0;
}

function _dataRow(label, value) {
  return `<div class="data-row">
    <span class="data-label">${label}</span>
    <span>${value}</span>
  </div>`;
}

function _srcCitation(src) {
  const viewLink = src.url && src.url.trim()
    ? `<a href="${h(src.url.trim())}" target="_blank" rel="noopener noreferrer" class="src-view-link">View Source →</a>`
    : '';
  return `<div class="data-row">
    <span class="src-ref" data-src-id="${h(src.src_id)}">[${h(src.src_id)}] ${h(src.title || '')}</span>${viewLink ? `<br>${viewLink}` : ''}
  </div>`;
}

function _setActive(containerId, selector) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
  const target = container.querySelector(selector);
  if (target) target.classList.add('active');
}
