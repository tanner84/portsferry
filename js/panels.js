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
  PF.panels._renderOrderOfBattle();
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

/**
 * Render the hierarchical Order of Battle in the left panel.
 * Structure: Affiliation group → Unit → Individual members
 * Exception-tier individuals appear below all groups.
 *
 * @param {string} [filterQuery] — optional search filter
 */
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
        return (tierOrder[a.ind.tier] || 9) - (tierOrder[b.ind.tier] || 9);
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
  PF.panels._renderOrderOfBattle(query);
  /* Events list re-renders against full set — search filtering handled inside OOB */
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
   Story panel — UNIT (stub — fleshed out in Step 4)
   ================================================================ */
PF.panels.showUnit = function (unit) {
  const affCls = PF.map.affiliationClass(unit.affiliation);
  const members = PF.data.getUnitMembers(unit.unit_id);

  const html = `
    <div class="story-section">
      <div class="story-name">${h(unit.name || unit.unit_id)}</div>
      <div class="story-role">
        <span class="affil-badge badge-${affCls}">${h(unit.affiliation || '')}</span>
        ${unit.active_from ? ` · active ${h(unit.active_from)}${unit.active_to ? '–' + h(unit.active_to) : ''}` : ''}
      </div>
    </div>
    ${unit.notes ? `<div class="story-section"><p class="story-prose">${h(unit.notes)}</p></div>` : ''}
    ${members.length > 0 ? `
    <div class="story-section">
      <div class="story-section-label">Officers on record — ${members.length}</div>
      <ul class="conn-list">
        ${members.map(m => `
          <li data-ind-id="${h(m.ind_id)}" role="button" tabindex="0">
            <span class="dot dot-${PF.map.affiliationClass(m.affiliation)}"></span>
            ${h(m.full_name || 'Unknown')}
            <span class="conn-rel">${h(m.rank || m.tier || '')}</span>
          </li>`).join('')}
      </ul>
    </div>` : ''}
    <p style="font-size:0.75rem;color:var(--text-muted);font-style:italic;margin-top:0.5rem">
      Community origin section added in Step 4.
    </p>`;

  _showEntity(unit.name || 'Unit', html);

  document.querySelectorAll('#story-entity .conn-list li[data-ind-id]').forEach(li => {
    li.addEventListener('click', () => {
      const ind = PF.data.getIndividualById(li.dataset.indId);
      if (ind) { PF.panels.showIndividual(ind); PF.network.renderForIndividual(ind.ind_id); }
    });
  });
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

function _setActive(containerId, selector) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
  const target = container.querySelector(selector);
  if (target) target.classList.add('active');
}
