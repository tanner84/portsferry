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
  /* Populate browser lists */
  PF.panels._buildBrowser();

  /* Search */
  document.getElementById('entity-search').addEventListener('input', function () {
    PF.panels._onSearch(this.value.trim());
  });

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
   Entity browser — left panel
   ================================================================ */
PF.panels._buildBrowser = function () {
  PF.panels._renderChurchList();
  PF.panels._renderIndividualList();
  PF.panels._renderUnitList();
  PF.panels._renderEventList();
};

PF.panels._renderChurchList = function (subset) {
  const list  = document.getElementById('church-list');
  const items = subset || PF.data.getMappableChurches();
  list.innerHTML = items.map(ch => `
    <li role="button" tabindex="0" data-ch-id="${h(ch.ch_id)}">
      <span class="dot dot-church"></span>
      <span>${h(ch.name || 'Unnamed')}</span>
      <span class="entity-meta">${h(ch.founded_yr || '')}</span>
    </li>`).join('');

  list.querySelectorAll('li').forEach(li => {
    const activate = () => {
      const ch = PF.data.getChurchById(li.dataset.chId);
      if (ch) PF.panels.showChurch(ch);
    };
    li.addEventListener('click', activate);
    li.addEventListener('keydown', e => { if (e.key === 'Enter') activate(); });
  });
};

PF.panels._renderIndividualList = function (subset) {
  const list  = document.getElementById('individual-list');
  const tiers = new Set(['Command', 'Company', 'Exception']);
  const items = (subset || PF.data.getMappableIndividuals())
    .filter(ind => tiers.has(ind.tier))
    .slice(0, 50);

  list.innerHTML = items.map(ind => {
    const affCls = PF.map.affiliationClass(ind.affiliation);
    return `
      <li role="button" tabindex="0" data-ind-id="${h(ind.ind_id)}">
        <span class="dot dot-${affCls}"></span>
        <span>${h(ind.full_name || 'Unknown')}</span>
        <span class="entity-meta">${h(ind.tier || '')}</span>
      </li>`;
  }).join('');

  list.querySelectorAll('li').forEach(li => {
    const activate = () => {
      const ind = PF.data.getIndividualById(li.dataset.indId);
      if (!ind) return;
      PF.panels.showIndividual(ind);
      PF.network.renderForIndividual(ind.ind_id);
      const lat = PF.data._parseCoord(ind.lat);
      const lng = PF.data._parseCoord(ind.lng);
      if (lat !== null && lng !== null) PF.map.focusOn(lat, lng, 12);
    };
    li.addEventListener('click', activate);
    li.addEventListener('keydown', e => { if (e.key === 'Enter') activate(); });
  });
};

PF.panels._renderUnitList = function () {
  const list  = document.getElementById('unit-list');
  const items = (PF.data.raw.UNITS || []).slice(0, 25);
  list.innerHTML = items.map(u => `
    <li role="button" tabindex="0" data-unit-id="${h(u.unit_id)}">
      <span class="dot" style="background:#555;border-radius:2px;"></span>
      <span>${h(u.name || u.unit_id)}</span>
    </li>`).join('');
};

PF.panels._renderEventList = function () {
  const list  = document.getElementById('event-list');
  const items = (PF.data.raw.EVENTS || []).slice(0, 25);
  list.innerHTML = items.map(evt => `
    <li role="button" tabindex="0" data-evt-id="${h(evt.evt_id)}">
      <span class="dot" style="background:#777;border-radius:1px;width:6px;height:6px;"></span>
      <span>${h(evt.name || evt.evt_id)}</span>
      <span class="entity-meta">${h(evt.date || '')}</span>
    </li>`).join('');

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const evt = (PF.data.raw.EVENTS || []).find(e => e.evt_id === li.dataset.evtId);
      if (evt) PF.panels.showEvent(evt);
    });
  });
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
  PF.panels._renderIndividualList(results.individuals);
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
      break;
  }
};

PF.panels._renderBattleMarkers = function () {
  (PF.data.raw.BATTLES || []).forEach(b => {
    const lat = PF.data._parseCoord(b.lat);
    const lng = PF.data._parseCoord(b.lng);
    if (lat === null || lng === null) return;

    const m = L.circleMarker([lat, lng], {
      radius:      10,
      color:       '#8a6b3a',
      fillColor:   '#8a6b3a',
      fillOpacity: 0.25,
      weight:      2,
    }).addTo(PF.map.layers.individuals);

    m.bindTooltip(
      `<strong>${h(b.name || b.battle_id)}</strong><br>${h(b.date || '')}`,
      { className: 'pf-tooltip' }
    );
    m.on('click', () => PF.panels.showBattle(b));
  });
};

/* ================================================================
   Story panel — INDIVIDUAL
   ================================================================ */
PF.panels.showIndividual = function (ind) {
  _setActive('individual-list', `[data-ind-id="${ind.ind_id}"]`);

  const sources   = PF.data.getSourcesForEntity(ind);
  const neighbors = PF.data.getNetworkNeighbors(ind.ind_id);
  const aff       = ind.affiliation || 'Unknown';
  const affCls    = PF.map.affiliationClass(aff);

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
      ${_dataRow('Lived',       `${h(ind.birth_year || '?')} – ${h(ind.death_year || '?')}`)}
      ${ind.affiliation ? _dataRow('Affiliation', h(ind.affiliation)) : ''}
      ${ind.evidence_type ? _dataRow('Evidence',    h(ind.evidence_type)) : ''}
      ${ind.pension_filed === 'Y' ? _dataRow('Pension', 'Filed pension application') : ''}
    </div>

    ${ind.battles_present ? `
    <div class="story-section">
      <div class="story-section-label">Military service</div>
      <p class="story-prose">${h(ind.battles_present)}</p>
    </div>` : ''}

    ${neighbors.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Social network — ${neighbors.length} connection${neighbors.length !== 1 ? 's' : ''}</div>
      <ul class="conn-list">
        ${neighbors.slice(0, 14).map(({ individual: n, relationship }) => `
          <li data-ind-id="${h(n.ind_id)}" role="button" tabindex="0">
            <span class="dot dot-${PF.map.affiliationClass(n.affiliation)}"></span>
            ${h(n.full_name || 'Unknown')}
            <span class="conn-rel">${h(relationship)}</span>
          </li>`).join('')}
        ${neighbors.length > 14 ? `<li style="font-style:italic;color:var(--text-muted)">…and ${neighbors.length - 14} more</li>` : ''}
      </ul>
    </div>` : ''}

    ${sources.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Sources</div>
      ${sources.map(src => `
        <div class="data-row">
          <span class="src-ref" data-src-id="${h(src.src_id)}">[${h(src.src_id)}] ${h(src.title || '')}</span>
        </div>`).join('')}
    </div>` : ''}
  `;

  _showEntity(ind.full_name || 'Individual', html);

  /* Wire neighbor clicks */
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
};

/* ================================================================
   Story panel — CHURCH
   ================================================================ */
PF.panels.showChurch = function (ch) {
  _setActive('church-list', `[data-ch-id="${ch.ch_id}"]`);

  const lat     = PF.data._parseCoord(ch.lat);
  const lng     = PF.data._parseCoord(ch.lng);
  const members = PF.data.getChurchMembers(ch.ch_id);
  const sources = PF.data.getSourcesForEntity(ch);

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
      ${sources.map(src => `
        <div class="data-row">
          <span class="src-ref" data-src-id="${h(src.src_id)}">[${h(src.src_id)}] ${h(src.title || '')}</span>
        </div>`).join('')}
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
      ${sources.map(src => `
        <div class="data-row">
          <span class="src-ref" data-src-id="${h(src.src_id)}">[${h(src.src_id)}] ${h(src.title || '')}</span>
        </div>`).join('')}
    </div>` : ''}
  `;

  _showEntity(evt.name || 'Event', html);
};

/* ================================================================
   Story panel — BATTLE
   ================================================================ */
PF.panels.showBattle = function (battle) {
  const lat = PF.data._parseCoord(battle.lat);
  const lng = PF.data._parseCoord(battle.lng);
  if (lat !== null && lng !== null) PF.map.focusOn(lat, lng, 13);

  const sources = PF.data.getSourcesForEntity(battle);

  const html = `
    <div class="story-section">
      <div class="story-name">${h(battle.name || battle.battle_id || 'Battle')}</div>
      <div class="story-role">${h(battle.date || '')}${battle.location ? ' · ' + h(battle.location) : ''}</div>
    </div>

    ${battle.description ? `
    <div class="story-section">
      <p class="story-prose">${h(battle.description)}</p>
    </div>` : ''}

    ${sources.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Sources</div>
      ${sources.map(src => `
        <div class="data-row">
          <span class="src-ref" data-src-id="${h(src.src_id)}">[${h(src.src_id)}] ${h(src.title || '')}</span>
        </div>`).join('')}
    </div>` : ''}
  `;

  _showEntity(battle.name || 'Battle', html);
};

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
   Timeline hook
   ================================================================ */
PF.panels.onDateChange = function (/* date */) {
  /* Phase 2+: update browser counts and active entity context */
};

/* ================================================================
   Reset
   ================================================================ */
PF.panels.resetStory = function () {
  document.getElementById('story-title').textContent = 'Cross Creek, 1758–1783';
  document.getElementById('story-close').classList.add('hidden');
  document.getElementById('story-default').classList.remove('hidden');
  document.getElementById('story-entity').classList.add('hidden');
  document.getElementById('source-tray').classList.add('hidden');

  PF.network.clear();
  PF.map.clearAssembly();
  if (PF.map._churchHighlight) {
    PF.map.instance.removeLayer(PF.map._churchHighlight);
    PF.map._churchHighlight = null;
  }

  /* Clear active states in browser */
  document.querySelectorAll('.entity-list li.active').forEach(li => li.classList.remove('active'));
};

/* ================================================================
   Internal helpers
   ================================================================ */

function _showEntity(title, html) {
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

function _setActive(listId, selector) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.querySelectorAll('li.active').forEach(li => li.classList.remove('active'));
  const target = list.querySelector(selector);
  if (target) target.classList.add('active');
}
