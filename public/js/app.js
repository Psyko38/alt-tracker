/* ==========================================================================
   Alt-Tracker — Frontend Application Logic (Material Design 3.0)
   ========================================================================== */

const STATUS_META = {
  draft: { label: 'À postuler', icon: 'edit_note', cls: 'm3-status-draft' },
  applied: { label: 'Envoyée', icon: 'send', cls: 'm3-status-applied' },
  interview: { label: 'Entretien RH', icon: 'record_voice_over', cls: 'm3-status-interview' },
  technical: { label: 'Test / Tech', icon: 'terminal', cls: 'm3-status-technical' },
  offer: { label: 'Offre reçue', icon: 'verified', cls: 'm3-status-offer' },
  rejected: { label: 'Refusée', icon: 'cancel', cls: 'm3-status-rejected' }
};

const TYPE_META = {
  alternance: { label: 'Alternance', icon: 'school', cls: 'm3-type-alternance' },
  job: { label: 'Job (CDI/CDD)', icon: 'business_center', cls: 'm3-type-job' },
  stage: { label: 'Stage', icon: 'badge', cls: 'm3-type-stage' },
  freelance: { label: 'Freelance', icon: 'laptop_mac', cls: 'm3-type-freelance' },
  autre: { label: 'Autre', icon: 'category', cls: 'm3-type-autre' }
};

const WORK_MODE_LABELS = {
  hybrid: 'Hybride',
  onsite: 'Présentiel',
  remote: 'Télétravail'
};

const VIEW_META = {
  dashboard: {
    title: 'Tableau de bord',
    subtitle: 'Vue d’ensemble de vos candidatures d’alternance, emploi et stage'
  },
  kanban: {
    title: 'Pipeline Kanban',
    subtitle: 'Glissez-déposez vos candidatures entre chaque étape du recrutement'
  },
  list: {
    title: 'Liste des candidatures',
    subtitle: 'Vue tabulaire détaillée avec tri, filtres et actions rapides'
  },
  followups: {
    title: 'Relances & Entretiens',
    subtitle: 'Ne manquez aucune relance recruteur ni aucun entretien programmé'
  },
  documents: {
    title: 'Bibliothèque CV & Lettres',
    subtitle: 'Gérez vos versions de CV et mesurez leur taux de conversion en entretien'
  },
  agent: {
    title: 'Copilote IA & Extracteur d’Offres',
    subtitle: 'Assistant OpenAI-compatible connecté à vos candidatures, relances et documents PDF'
  }
};

const state = {
  currentView: 'dashboard',
  applications: [],
  stats: null,
  documents: [],
  activeAppId: null,
  aiSettings: null,
  aiMessages: [],
  aiSending: false,
  filters: {
    type: 'all',
    status: 'all',
    search: '',
    due_followup: false,
    favorite: false,
    sort: 'updated_desc'
  }
};

/* ==========================================================================
   Utilities
   ========================================================================== */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isFollowUpDue(app) {
  if (!app.follow_up_date) return false;
  if (['offer', 'rejected'].includes(app.status)) return false;
  return app.follow_up_date <= todayIsoDate();
}

let snackbarTimer = null;
function showSnackbar(message) {
  const el = document.getElementById('m3-snackbar');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 3200);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Erreur HTTP ${res.status}`);
  }
  return res.json();
}

/* ==========================================================================
   Theme & Material You Dynamic Palette
   ========================================================================== */
function initThemeAndPalette() {
  const savedTheme = localStorage.getItem('alt_tracker_theme') || 'light';
  const savedPalette = localStorage.getItem('alt_tracker_palette') || 'iris';
  applyTheme(savedTheme);
  applyPalette(savedPalette);

  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'light' ? 'dark' : 'light');
  });

  document.querySelectorAll('.m3-palette-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      applyPalette(dot.dataset.color);
    });
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('alt_tracker_theme', theme);
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) {
    icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
  }
}

function applyPalette(palette) {
  document.documentElement.setAttribute('data-palette', palette);
  localStorage.setItem('alt_tracker_palette', palette);
  document.querySelectorAll('.m3-palette-dot').forEach((dot) => {
    dot.classList.toggle('active', dot.dataset.color === palette);
  });
}

/* ==========================================================================
   Data Loading & State Refresh
   ========================================================================== */
async function refreshAllData() {
  try {
    const params = new URLSearchParams();
    if (state.filters.type !== 'all') params.set('type', state.filters.type);
    if (state.filters.status !== 'all') params.set('status', state.filters.status);
    if (state.filters.search.trim() !== '') params.set('search', state.filters.search.trim());
    if (state.filters.due_followup) params.set('due_followup', 'true');
    if (state.filters.favorite) params.set('favorite', 'true');
    if (state.filters.sort) params.set('sort', state.filters.sort);

    const [applications, stats, documents] = await Promise.all([
      apiFetch(`/api/applications?${params.toString()}`),
      apiFetch('/api/stats'),
      apiFetch('/api/documents')
    ]);

    state.applications = applications;
    state.stats = stats;
    state.documents = documents;

    updateFollowUpBadge();
    populateCvDatalist();
    populateAiFocusSelect();
    renderCurrentView();

    if (state.activeAppId) {
      await openApplicationSheet(state.activeAppId, false);
    }
  } catch (err) {
    showSnackbar(`Erreur : ${err.message}`);
  }
}

function updateFollowUpBadge() {
  const badge = document.getElementById('nav-followup-badge');
  if (!badge || !state.stats) return;
  const count = (state.stats.urgentFollowUps || []).length;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

function populateCvDatalist() {
  const listEl = document.getElementById('cv-versions-datalist');
  if (!listEl) return;
  const labels = new Set();
  state.documents.forEach((d) => {
    if (d.doc_type === 'cv') {
      labels.add(`${d.label} ${d.version_tag || ''}`.trim());
    }
  });
  state.applications.forEach((a) => {
    if (a.cv_version) labels.add(a.cv_version);
  });
  listEl.innerHTML = Array.from(labels)
    .map((l) => `<option value="${escapeHtml(l)}"></option>`)
    .join('');
}

function populateAiFocusSelect() {
  const sel = document.getElementById('ai-focus-app');
  if (!sel) return;
  const currentVal = sel.value;
  const options = ['<option value="">Toutes mes candidatures (Global)</option>'];
  state.applications.forEach((a) => {
    const label = `${a.company} — ${a.role}`;
    options.push(`<option value="${a.id}">${escapeHtml(label)}</option>`);
  });
  sel.innerHTML = options.join('');
  if (currentVal && state.applications.some((a) => String(a.id) === String(currentVal))) {
    sel.value = currentVal;
  }
  if (typeof sel._m3Sync === 'function') sel._m3Sync();
}

/* ==========================================================================
   View Switching
   ========================================================================== */
function switchView(viewName) {
  if (!VIEW_META[viewName]) return;
  state.currentView = viewName;

  document.querySelectorAll('.m3-nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  document.querySelectorAll('.m3-view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });

  const filterBar = document.querySelector('.m3-filter-bar');
  if (filterBar) {
    filterBar.style.display = (viewName === 'agent' || viewName === 'documents') ? 'none' : '';
  }

  document.getElementById('view-title').textContent = VIEW_META[viewName].title;
  document.getElementById('view-subtitle').textContent = VIEW_META[viewName].subtitle;

  renderCurrentView();
}

function renderCurrentView() {
  renderDashboard();
  renderKanban();
  renderListTable();
  renderFollowUpsView();
  renderDocumentsView();
  renderAiContextCard();
}

/* ==========================================================================
   1. Render Dashboard
   ========================================================================== */
function renderDashboard() {
  const s = state.stats;
  if (!s) return;

  const kpiGrid = document.getElementById('dashboard-kpi-grid');
  kpiGrid.innerHTML = `
    <div class="m3-kpi-card primary-tonal">
      <div class="m3-kpi-header">
        <span class="m3-kpi-label">Total candidatures</span>
        <div class="m3-kpi-icon"><span class="material-symbols-rounded">folder_Copy</span></div>
      </div>
      <div class="m3-kpi-value">${s.total}</div>
      <div class="m3-kpi-sub">${s.sentCount} envoyées · ${s.byStatus.draft || 0} en brouillon</div>
    </div>

    <div class="m3-kpi-card">
      <div class="m3-kpi-header">
        <span class="m3-kpi-label">Processus actifs</span>
        <div class="m3-kpi-icon"><span class="material-symbols-rounded">pending_actions</span></div>
      </div>
      <div class="m3-kpi-value">${s.activeCount}</div>
      <div class="m3-kpi-sub">${s.byStatus.interview + s.byStatus.technical} en phase d’entretien</div>
    </div>

    <div class="m3-kpi-card">
      <div class="m3-kpi-header">
        <span class="m3-kpi-label">Taux de retour</span>
        <div class="m3-kpi-icon"><span class="material-symbols-rounded">monitoring</span></div>
      </div>
      <div class="m3-kpi-value">${s.responseRate}%</div>
      <div class="m3-kpi-sub">Taux d’entretien : <strong>${s.interviewRate}%</strong></div>
    </div>

    <div class="m3-kpi-card">
      <div class="m3-kpi-header">
        <span class="m3-kpi-label">Alternances suivies</span>
        <div class="m3-kpi-icon"><span class="material-symbols-rounded">school</span></div>
      </div>
      <div class="m3-kpi-value">${s.byType.alternance || 0}</div>
      <div class="m3-kpi-sub">${s.byType.job || 0} Jobs · ${s.byType.stage || 0} Stages</div>
    </div>

    <div class="m3-kpi-card">
      <div class="m3-kpi-header">
        <span class="m3-kpi-label">Offres décrochées</span>
        <div class="m3-kpi-icon"><span class="material-symbols-rounded">emoji_events</span></div>
      </div>
      <div class="m3-kpi-value">${s.offersCount}</div>
      <div class="m3-kpi-sub">${s.urgentFollowUps.length} relance(s) à traiter</div>
    </div>
  `;

  // Urgent Follow-ups & Upcoming Interviews
  const urgentList = document.getElementById('dashboard-urgent-list');
  const combinedItems = [];

  s.upcomingInterviews.slice(0, 3).forEach((app) => {
    combinedItems.push(`
      <div class="m3-action-item" onclick="openApplicationSheet(${app.id})">
        <div class="m3-action-item-info">
          <div class="m3-action-item-title">${escapeHtml(app.company)} — ${escapeHtml(app.role)}</div>
          <div class="m3-action-item-sub">
            <span class="m3-badge m3-status-interview">
              <span class="material-symbols-rounded" style="font-size:14px;">event</span>
              Entretien : ${escapeHtml(formatDateTime(app.interview_date))}
            </span>
            <span>${escapeHtml(app.contact_name || '')}</span>
          </div>
        </div>
        <span class="material-symbols-rounded">chevron_right</span>
      </div>
    `);
  });

  s.urgentFollowUps.slice(0, 4).forEach((app) => {
    const alertLabel = app.is_overdue
      ? `En retard (${formatDate(app.follow_up_date)})`
      : app.is_today
        ? 'À relancer aujourd’hui'
        : `Relance le ${formatDate(app.follow_up_date)}`;

    combinedItems.push(`
      <div class="m3-action-item" onclick="openApplicationSheet(${app.id})">
        <div class="m3-action-item-info">
          <div class="m3-action-item-title">${escapeHtml(app.company)} — ${escapeHtml(app.role)}</div>
          <div class="m3-action-item-sub">
            <span class="m3-alert-pill">
              <span class="material-symbols-rounded" style="font-size:13px;">schedule_send</span>
              ${escapeHtml(alertLabel)}
            </span>
            <span class="m3-badge ${TYPE_META[app.type]?.cls || 'm3-type-autre'}">${TYPE_META[app.type]?.label || app.type}</span>
          </div>
        </div>
        <button class="m3-btn m3-btn-tonal m3-btn-sm" onclick="event.stopPropagation(); quickMarkFollowUp(${app.id})">
          <span class="material-symbols-rounded" style="font-size:16px;">check</span>
          Relancé
        </button>
      </div>
    `);
  });

  urgentList.innerHTML = combinedItems.length > 0
    ? combinedItems.join('')
    : `<div class="m3-empty-state">
         <span class="material-symbols-rounded" style="font-size:32px;">task_alt</span>
         <span>Aucune relance en retard ni entretien immédiat. Tout est à jour !</span>
       </div>`;

  // Distribution Bars
  const distEl = document.getElementById('dashboard-distribution-bars');
  const total = Math.max(s.total, 1);
  const typeRows = Object.entries(TYPE_META).map(([key, meta]) => {
    const count = s.byType[key] || 0;
    const pct = Math.round((count / total) * 100);
    return `
      <div class="m3-bar-row">
        <div class="m3-bar-meta">
          <span>${meta.label}</span>
          <span>${count} (${pct}%)</span>
        </div>
        <div class="m3-bar-track">
          <div class="m3-bar-fill" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  });
  distEl.innerHTML = typeRows.join('');

  // CV Performance
  const cvStatsEl = document.getElementById('dashboard-cv-stats');
  if (s.cvPerformance && s.cvPerformance.length > 0) {
    cvStatsEl.innerHTML = s.cvPerformance.map((cv) => {
      const rate = cv.total > 0 ? Math.round((cv.positive / cv.total) * 100) : 0;
      return `
        <div class="m3-action-item" onclick="switchView('documents')">
          <div class="m3-action-item-info">
            <div class="m3-action-item-title">${escapeHtml(cv.cv_version)}</div>
            <div class="m3-action-item-sub">
              <span>${cv.total} candidature(s)</span>
              <span>·</span>
              <span><strong>${cv.positive}</strong> entretien(s) (${rate}% de succès)</span>
            </div>
          </div>
          <span class="m3-badge m3-status-offer">${rate}% retour positif</span>
        </div>
      `;
    }).join('');
  } else {
    cvStatsEl.innerHTML = `<div class="m3-empty-state">Renseignez la version de votre CV dans vos candidatures pour analyser leur performance.</div>`;
  }

  // Recent Events
  const eventsEl = document.getElementById('dashboard-recent-events');
  if (s.recentEvents && s.recentEvents.length > 0) {
    eventsEl.innerHTML = s.recentEvents.slice(0, 5).map((ev) => `
      <div class="m3-action-item" onclick="openApplicationSheet(${ev.application_id})">
        <div class="m3-action-item-info">
          <div class="m3-action-item-title">${escapeHtml(ev.company)} — ${escapeHtml(ev.title)}</div>
          <div class="m3-action-item-sub">
            <span>${formatDateTime(ev.event_date)}</span>
            ${ev.description ? `<span>· ${escapeHtml(ev.description)}</span>` : ''}
          </div>
        </div>
      </div>
    `).join('');
  } else {
    eventsEl.innerHTML = `<div class="m3-empty-state">Aucune activité récente.</div>`;
  }
}

/* ==========================================================================
   2. Render Kanban Board (Drag & Drop)
   ========================================================================== */
function renderKanban() {
  const board = document.getElementById('kanban-board');
  if (!board) return;

  const statuses = ['draft', 'applied', 'interview', 'technical', 'offer', 'rejected'];

  board.innerHTML = statuses.map((stKey) => {
    const meta = STATUS_META[stKey];
    const colApps = state.applications.filter((a) => a.status === stKey);

    const cardsHtml = colApps.map((app) => {
      const tMeta = TYPE_META[app.type] || TYPE_META.autre;
      const due = isFollowUpDue(app);
      return `
        <article
          class="m3-kanban-card"
          draggable="true"
          data-id="${app.id}"
          onclick="openApplicationSheet(${app.id})"
        >
          <div class="m3-kanban-card-top">
            <span class="m3-badge ${tMeta.cls}">${tMeta.label}</span>
            ${app.favorite ? '<span class="material-symbols-rounded filled" style="color:#f59e0b;font-size:18px;">star</span>' : ''}
          </div>

          <div>
            <div class="m3-kanban-company">${escapeHtml(app.company)}</div>
            <div class="m3-kanban-role">${escapeHtml(app.role)}</div>
          </div>

          <div class="m3-kanban-meta">
            ${app.location ? `<span class="m3-kanban-meta-item"><span class="material-symbols-rounded" style="font-size:13px;">location_on</span>${escapeHtml(app.location)}</span>` : ''}
            ${app.rhythm ? `<span class="m3-kanban-meta-item"><span class="material-symbols-rounded" style="font-size:13px;">event_repeat</span>${escapeHtml(app.rhythm)}</span>` : ''}
            ${app.salary ? `<span class="m3-kanban-meta-item"><span class="material-symbols-rounded" style="font-size:13px;">payments</span>${escapeHtml(app.salary)}</span>` : ''}
          </div>

          ${due ? `
            <div class="m3-alert-pill">
              <span class="material-symbols-rounded" style="font-size:13px;">notifications_active</span>
              Relance : ${formatDate(app.follow_up_date)}
            </div>
          ` : ''}

          <div class="m3-kanban-footer">
            <span>${app.applied_date ? `Envoyée ${formatDate(app.applied_date)}` : 'Brouillon'}</span>
            ${app.cv_version ? `<span title="${escapeHtml(app.cv_version)}">📄 CV</span>` : ''}
          </div>
        </article>
      `;
    }).join('');

    return `
      <div class="m3-kanban-col" data-status="${stKey}">
        <div class="m3-kanban-col-header">
          <div class="m3-kanban-col-title">
            <span class="material-symbols-rounded" style="font-size:18px;">${meta.icon}</span>
            <span>${meta.label}</span>
          </div>
          <span class="m3-kanban-count">${colApps.length}</span>
        </div>
        <div class="m3-kanban-cards">
          ${cardsHtml || `<div class="m3-empty-state" style="padding:24px 8px;font-size:12px;">Glissez une carte ici</div>`}
        </div>
      </div>
    `;
  }).join('');

  // Attach Drag & Drop handlers
  board.querySelectorAll('.m3-kanban-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  board.querySelectorAll('.m3-kanban-col').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const appId = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      if (!appId || !newStatus) return;
      await changeApplicationStatus(Number(appId), newStatus);
    });
  });
}

async function changeApplicationStatus(appId, newStatus) {
  const existing = state.applications.find((a) => a.id === Number(appId));
  if (existing && existing.status === newStatus) return;
  try {
    await apiFetch(`/api/applications/${appId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    showSnackbar(`Statut mis à jour : ${STATUS_META[newStatus]?.label || newStatus}`);
    await refreshAllData();
  } catch (err) {
    showSnackbar(`Erreur : ${err.message}`);
  }
}

/* ==========================================================================
   3. Render List / Table View
   ========================================================================== */
function renderListTable() {
  const tbody = document.getElementById('applications-table-body');
  if (!tbody) return;

  if (state.applications.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="m3-empty-state">
            <span class="material-symbols-rounded" style="font-size:36px;">search_off</span>
            <span>Aucune candidature ne correspond aux filtres sélectionnés.</span>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.applications.map((app) => {
    const tMeta = TYPE_META[app.type] || TYPE_META.autre;
    const due = isFollowUpDue(app);

    const statusOptions = Object.entries(STATUS_META).map(([k, v]) => `
      <option value="${k}" ${app.status === k ? 'selected' : ''}>${v.label}</option>
    `).join('');

    return `
      <tr onclick="openApplicationSheet(${app.id})">
        <td onclick="event.stopPropagation();">
          <button class="m3-star-btn ${app.favorite ? 'active' : ''}" onclick="toggleFavorite(${app.id}, ${!app.favorite})" title="Favori">
            <span class="material-symbols-rounded ${app.favorite ? 'filled' : ''}">star</span>
          </button>
        </td>
        <td>
          <div style="font-weight: 700; color: var(--md-sys-color-on-surface);">${escapeHtml(app.company)}</div>
          <div style="font-size: 12.5px; color: var(--md-sys-color-on-surface-variant);">${escapeHtml(app.role)}</div>
        </td>
        <td>
          <span class="m3-badge ${tMeta.cls}">${tMeta.label}</span>
          ${app.rhythm ? `<div style="font-size:11px; color:var(--md-sys-color-on-surface-variant); margin-top:3px;">${escapeHtml(app.rhythm)}</div>` : ''}
        </td>
        <td onclick="event.stopPropagation();">
          <select class="m3-select" onchange="changeApplicationStatus(${app.id}, this.value)">
            ${statusOptions}
          </select>
        </td>
        <td>
          <div>${escapeHtml(app.location || '—')}</div>
          <div style="font-size:11.5px; color:var(--md-sys-color-on-surface-variant);">${WORK_MODE_LABELS[app.work_mode] || app.work_mode}</div>
        </td>
        <td>${formatDate(app.applied_date)}</td>
        <td>
          ${due
            ? `<span class="m3-alert-pill"><span class="material-symbols-rounded" style="font-size:13px;">notifications_active</span>${formatDate(app.follow_up_date)}</span>`
            : formatDate(app.follow_up_date)
          }
        </td>
        <td>
          ${(() => {
            const linkedDoc = findMatchingDocument(app);
            if (linkedDoc) {
              return `
                <button class="m3-btn m3-btn-tonal m3-btn-sm" onclick="event.stopPropagation(); openDocumentPreview(${linkedDoc.id})" title="Ouvrir et visualiser ce document">
                  <span class="material-symbols-rounded" style="font-size:15px;">visibility</span>
                  <span>${escapeHtml(app.cv_version || linkedDoc.label)}</span>
                </button>
              `;
            }
            return `<span style="font-size:12.5px;">${escapeHtml(app.cv_version || '—')}</span>`;
          })()}
        </td>
        <td style="text-align: right;" onclick="event.stopPropagation();">
          <div style="display: inline-flex; gap: 6px;">
            ${app.job_url ? `
              <a href="${escapeHtml(app.job_url)}" target="_blank" rel="noopener" class="m3-icon-btn" title="Ouvrir l'annonce">
                <span class="material-symbols-rounded">open_in_new</span>
              </a>
            ` : ''}
            <button class="m3-icon-btn" onclick="openEditApplicationDialog(${app.id})" title="Modifier">
              <span class="material-symbols-rounded">edit</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  enhanceM3Selects(tbody);
}

async function toggleFavorite(appId, favValue) {
  try {
    await apiFetch(`/api/applications/${appId}`, {
      method: 'PUT',
      body: JSON.stringify({ favorite: favValue })
    });
    await refreshAllData();
  } catch (err) {
    showSnackbar(`Erreur : ${err.message}`);
  }
}

/* ==========================================================================
   4. Render Follow-ups & Interviews Agenda View
   ========================================================================== */
function renderFollowUpsView() {
  const followupsEl = document.getElementById('followups-full-list');
  const interviewsEl = document.getElementById('interviews-full-list');
  if (!followupsEl || !interviewsEl) return;

  const withFollowUp = state.applications
    .filter((a) => a.follow_up_date && !['offer', 'rejected'].includes(a.status))
    .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date));

  if (withFollowUp.length === 0) {
    followupsEl.innerHTML = `<div class="m3-empty-state">Aucune relance programmée pour le moment.</div>`;
  } else {
    followupsEl.innerHTML = withFollowUp.map((app) => {
      const due = isFollowUpDue(app);
      return `
        <div class="m3-action-item" onclick="openApplicationSheet(${app.id})">
          <div class="m3-action-item-info">
            <div class="m3-action-item-title">${escapeHtml(app.company)} — ${escapeHtml(app.role)}</div>
            <div class="m3-action-item-sub">
              <span class="${due ? 'm3-alert-pill' : 'm3-badge m3-status-applied'}">
                Relance prévue : ${formatDate(app.follow_up_date)}
              </span>
              ${app.contact_name ? `<span>Contact : ${escapeHtml(app.contact_name)} (${escapeHtml(app.contact_email || '—')})</span>` : ''}
            </div>
          </div>
          <button class="m3-btn m3-btn-tonal m3-btn-sm" onclick="event.stopPropagation(); quickMarkFollowUp(${app.id})">
            <span class="material-symbols-rounded" style="font-size:16px;">check</span>
            Marquer relancé (+7j)
          </button>
        </div>
      `;
    }).join('');
  }

  const withInterview = state.applications
    .filter((a) => a.interview_date)
    .sort((a, b) => a.interview_date.localeCompare(b.interview_date));

  if (withInterview.length === 0) {
    interviewsEl.innerHTML = `<div class="m3-empty-state">Aucun entretien programmé.</div>`;
  } else {
    interviewsEl.innerHTML = withInterview.map((app) => `
      <div class="m3-action-item" onclick="openApplicationSheet(${app.id})">
        <div class="m3-action-item-info">
          <div class="m3-action-item-title">${escapeHtml(app.company)} — ${escapeHtml(app.role)}</div>
          <div class="m3-action-item-sub">
            <span class="m3-badge m3-status-interview">
              <span class="material-symbols-rounded" style="font-size:14px;">event</span>
              ${formatDateTime(app.interview_date)}
            </span>
            <span>${escapeHtml(app.contact_name || '')}</span>
          </div>
        </div>
        <span class="material-symbols-rounded">chevron_right</span>
      </div>
    `).join('');
  }
}

async function quickMarkFollowUp(appId) {
  try {
    await apiFetch(`/api/applications/${appId}/follow-up`, {
      method: 'POST',
      body: JSON.stringify({
        note: 'Relance envoyée au recruteur.',
        nextFollowUpDays: 7
      })
    });
    showSnackbar('Relance enregistrée ! Prochaine relance programmée à +7 jours.');
    await refreshAllData();
  } catch (err) {
    showSnackbar(`Erreur : ${err.message}`);
  }
}

/* ==========================================================================
   5. Render Documents (CV & Cover Letters) View & In-Page Viewer
   ========================================================================== */
function findMatchingDocument(app) {
  if (!app || !state.documents || state.documents.length === 0) return null;
  if (app.document_id) {
    const byId = state.documents.find((d) => Number(d.id) === Number(app.document_id));
    if (byId) return byId;
  }
  if (app.cv_version && app.cv_version.trim() !== '') {
    const cvLower = app.cv_version.toLowerCase();
    const byLabel = state.documents.find((d) =>
      cvLower.includes(d.label.toLowerCase()) ||
      d.label.toLowerCase().includes(cvLower)
    );
    if (byLabel) return byLabel;
  }
  return null;
}

function renderDocumentsView() {
  const grid = document.getElementById('documents-grid');
  if (!grid) return;

  if (state.documents.length === 0) {
    grid.innerHTML = `<div class="m3-empty-state">Aucun document enregistré. Ajoutez vos versions de CV et lettres de motivation !</div>`;
    return;
  }

  const docTypeLabels = {
    cv: 'Curriculum Vitae (CV)',
    cover_letter: 'Lettre de motivation',
    portfolio: 'Portfolio / GitHub',
    other: 'Document'
  };

  grid.innerHTML = state.documents.map((doc) => {
    const usage = doc.usage_count || 0;
    const pos = doc.positive_count || 0;
    const rate = usage > 0 ? Math.round((pos / usage) * 100) : 0;

    return `
      <div class="m3-doc-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div style="cursor:pointer;" onclick="openDocumentPreview(${doc.id})">
            <span class="m3-badge m3-type-alternance">${escapeHtml(docTypeLabels[doc.doc_type] || doc.doc_type)} · ${escapeHtml(doc.version_tag || 'v1.0')}</span>
            <h3 style="font-size:16px; font-weight:700; margin-top:8px; color:var(--md-sys-color-on-surface);">${escapeHtml(doc.label)}</h3>
            ${doc.file_name ? `<div style="font-size:11.5px; color:var(--md-sys-color-primary); margin-top:2px;">📄 ${escapeHtml(doc.file_name)}</div>` : ''}
          </div>
          <div style="display:flex; gap:6px;">
            <button class="m3-icon-btn" onclick="openEditDocumentDialog(${doc.id})" title="Modifier ou remplacer le fichier">
              <span class="material-symbols-rounded">edit</span>
            </button>
            <button class="m3-icon-btn" onclick="deleteDocumentItem(${doc.id})" title="Supprimer">
              <span class="material-symbols-rounded">delete</span>
            </button>
          </div>
        </div>

        ${doc.notes ? `<p style="font-size:13px; color:var(--md-sys-color-on-surface-variant);">${escapeHtml(doc.notes)}</p>` : ''}

        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:auto; padding-top:8px; border-top:1px solid var(--md-sys-color-outline-variant); font-size:12px;">
          <span>Utilisé dans <strong>${usage}</strong> candidature(s)</span>
          <span>·</span>
          <span><strong>${pos}</strong> entretien(s) (${rate}%)</span>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <button class="m3-btn m3-btn-filled m3-btn-sm" onclick="openDocumentPreview(${doc.id})">
            <span class="material-symbols-rounded" style="font-size:16px;">visibility</span>
            <span>Visualiser dans la page</span>
          </button>
          ${doc.stored_name ? `
            <a href="/api/documents/${doc.id}/view" target="_blank" rel="noopener" class="m3-btn m3-btn-tonal m3-btn-sm" title="Ouvrir dans un nouvel onglet">
              <span class="material-symbols-rounded" style="font-size:16px;">open_in_new</span>
              <span>Onglet</span>
            </a>
            <a href="/api/documents/${doc.id}/download" class="m3-btn m3-btn-outlined m3-btn-sm" title="Télécharger le fichier">
              <span class="material-symbols-rounded" style="font-size:16px;">download</span>
            </a>
          ` : ''}
          ${doc.external_url ? `
            <a href="${escapeHtml(doc.external_url)}" target="_blank" rel="noopener" class="m3-btn m3-btn-outlined m3-btn-sm">
              <span class="material-symbols-rounded" style="font-size:16px;">link</span>
              <span>Lien externe</span>
            </a>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openDocumentPreview(docId) {
  const doc = state.documents.find((d) => Number(d.id) === Number(docId));
  if (!doc) {
    showSnackbar('Document introuvable');
    return;
  }

  const backdrop = document.getElementById('doc-preview-backdrop');
  const titleEl = document.getElementById('doc-preview-title');
  const subEl = document.getElementById('doc-preview-subtitle');
  const bodyEl = document.getElementById('doc-preview-body');
  const newTabBtn = document.getElementById('doc-preview-newtab');
  const dlBtn = document.getElementById('doc-preview-download');

  titleEl.textContent = doc.label;
  subEl.textContent = `${doc.version_tag || 'v1.0'} ${doc.file_name ? `· ${doc.file_name}` : ''}`;

  if (doc.stored_name) {
    const viewUrl = `/api/documents/${doc.id}/view`;
    const dlUrl = `/api/documents/${doc.id}/download`;
    newTabBtn.href = viewUrl;
    newTabBtn.style.display = 'inline-flex';
    dlBtn.href = dlUrl;
    dlBtn.style.display = 'inline-flex';

    const ext = (doc.file_name || doc.stored_name).toLowerCase();
    if (ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.webp')) {
      bodyEl.innerHTML = `<img src="${viewUrl}" alt="${escapeHtml(doc.label)}" class="m3-doc-preview-img" />`;
    } else {
      bodyEl.innerHTML = `<iframe src="${viewUrl}" class="m3-doc-preview-frame" title="${escapeHtml(doc.label)}"></iframe>`;
    }
  } else if (doc.external_url) {
    newTabBtn.href = doc.external_url;
    newTabBtn.style.display = 'inline-flex';
    dlBtn.style.display = 'none';
    bodyEl.innerHTML = `
      <div class="m3-empty-state" style="max-width: 480px;">
        <span class="material-symbols-rounded" style="font-size: 48px; color: var(--md-sys-color-primary);">link</span>
        <h3 style="font-size: 18px; font-weight: 700; color: var(--md-sys-color-on-surface);">${escapeHtml(doc.label)}</h3>
        <p>${escapeHtml(doc.notes || 'Ce document pointe vers une ressource externe.')}</p>
        <div style="display: flex; gap: 10px; margin-top: 12px;">
          <a href="${escapeHtml(doc.external_url)}" target="_blank" rel="noopener" class="m3-btn m3-btn-filled">
            <span class="material-symbols-rounded">open_in_new</span>
            <span>Ouvrir le lien externe</span>
          </a>
          <button class="m3-btn m3-btn-tonal" onclick="closeDocumentPreview(); openEditDocumentDialog(${doc.id});">
            <span class="material-symbols-rounded">upload_file</span>
            <span>Joindre un PDF local</span>
          </button>
        </div>
      </div>
    `;
  } else {
    newTabBtn.style.display = 'none';
    dlBtn.style.display = 'none';
    bodyEl.innerHTML = `
      <div class="m3-empty-state" style="max-width: 480px;">
        <span class="material-symbols-rounded" style="font-size: 48px; color: var(--md-sys-color-primary);">upload_file</span>
        <h3 style="font-size: 18px; font-weight: 700; color: var(--md-sys-color-on-surface);">Aucun fichier joint pour l’instant</h3>
        <p>Ajoutez un fichier PDF ou une image à <strong>${escapeHtml(doc.label)}</strong> pour le visualiser directement ici.</p>
        <button class="m3-btn m3-btn-filled" style="margin-top: 10px;" onclick="closeDocumentPreview(); openEditDocumentDialog(${doc.id});">
          <span class="material-symbols-rounded">upload_file</span>
          <span>Choisir un fichier PDF / Image</span>
        </button>
      </div>
    `;
  }

  backdrop.classList.add('open');
}

function closeDocumentPreview() {
  const backdrop = document.getElementById('doc-preview-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  const bodyEl = document.getElementById('doc-preview-body');
  if (bodyEl) bodyEl.innerHTML = '';
}

function openEditDocumentDialog(docId) {
  const doc = state.documents.find((d) => Number(d.id) === Number(docId));
  if (!doc) return;
  document.getElementById('document-form').reset();
  document.getElementById('doc-id').value = doc.id;
  document.getElementById('doc-dialog-title').textContent = `Modifier — ${doc.label}`;
  document.getElementById('doc-label').value = doc.label || '';
  document.getElementById('doc-type').value = doc.doc_type || 'cv';
  document.getElementById('doc-version').value = doc.version_tag || 'v1.0';
  document.getElementById('doc-url').value = doc.external_url || '';
  document.getElementById('doc-notes').value = doc.notes || '';
  syncAllM3Selects();
  syncAllM3FileInputs();
  document.getElementById('doc-dialog-backdrop').classList.add('open');
}

async function deleteDocumentItem(docId) {
  if (!confirm('Supprimer ce document de la bibliothèque ?')) return;
  try {
    await apiFetch(`/api/documents/${docId}`, { method: 'DELETE' });
    showSnackbar('Document supprimé');
    await refreshAllData();
  } catch (err) {
    showSnackbar(`Erreur : ${err.message}`);
  }
}

/* ==========================================================================
   M3 Side Sheet (Application Detail & Timeline)
   ========================================================================== */
async function openApplicationSheet(appId, showScrim = true) {
  try {
    const app = await apiFetch(`/api/applications/${appId}`);
    state.activeAppId = app.id;

    const sMeta = STATUS_META[app.status] || STATUS_META.applied;
    const tMeta = TYPE_META[app.type] || TYPE_META.autre;
    const linkedDoc = findMatchingDocument(app);

    document.getElementById('sheet-badges').innerHTML = `
      <span class="m3-badge ${tMeta.cls}">${tMeta.label}</span>
      <span class="m3-badge ${sMeta.cls}">${sMeta.label}</span>
    `;
    document.getElementById('sheet-company').textContent = app.company;
    document.getElementById('sheet-role').textContent = app.role;

    document.getElementById('sheet-quick-actions').innerHTML = `
      <button class="m3-btn m3-btn-tonal m3-btn-sm" onclick="quickMarkFollowUp(${app.id})">
        <span class="material-symbols-rounded" style="font-size:16px;">schedule_send</span>
        Marquer relancé (+7j)
      </button>
      <button class="m3-btn m3-btn-tonal m3-btn-sm" onclick="launchAiForApp(${app.id}, 'followup')">
        <span class="material-symbols-rounded" style="font-size:16px;">auto_awesome</span>
        Relance IA
      </button>
      <button class="m3-btn m3-btn-tonal m3-btn-sm" onclick="launchAiForApp(${app.id}, 'coach')">
        <span class="material-symbols-rounded" style="font-size:16px;">psychology</span>
        Coach IA
      </button>
      <button class="m3-btn m3-btn-tonal m3-btn-sm" onclick="launchAiForApp(${app.id}, 'cover_letter')">
        <span class="material-symbols-rounded" style="font-size:16px;">picture_as_pdf</span>
        Lettre PDF IA
      </button>
      ${linkedDoc ? `
        <button class="m3-btn m3-btn-filled m3-btn-sm" onclick="openDocumentPreview(${linkedDoc.id})">
          <span class="material-symbols-rounded" style="font-size:16px;">visibility</span>
          Voir le CV (${escapeHtml(linkedDoc.version_tag || 'PDF')})
        </button>
      ` : ''}
      ${app.job_url ? `
        <a href="${escapeHtml(app.job_url)}" target="_blank" rel="noopener" class="m3-btn m3-btn-outlined m3-btn-sm">
          <span class="material-symbols-rounded" style="font-size:16px;">open_in_new</span>
          Voir l’annonce
        </a>
      ` : ''}
    `;

    document.getElementById('sheet-info-grid').innerHTML = `
      <div class="m3-detail-box">
        <span class="m3-detail-label">Lieu & Mode</span>
        <span class="m3-detail-value">${escapeHtml(app.location || 'Non précisé')} (${WORK_MODE_LABELS[app.work_mode] || app.work_mode})</span>
      </div>
      <div class="m3-detail-box">
        <span class="m3-detail-label">Rémunération / Rythme</span>
        <span class="m3-detail-value">${escapeHtml(app.salary || '—')} ${app.rhythm ? `· ${escapeHtml(app.rhythm)}` : ''}</span>
      </div>
      <div class="m3-detail-box">
        <span class="m3-detail-label">Date d’envoi</span>
        <span class="m3-detail-value">${formatDate(app.applied_date)}</span>
      </div>
      <div class="m3-detail-box">
        <span class="m3-detail-label">Prochaine relance</span>
        <span class="m3-detail-value">${formatDate(app.follow_up_date)}</span>
      </div>
      <div class="m3-detail-box">
        <span class="m3-detail-label">Entretien prévu</span>
        <span class="m3-detail-value">${formatDateTime(app.interview_date)}</span>
      </div>
      <div class="m3-detail-box">
        <span class="m3-detail-label">Documents envoyés</span>
        <span class="m3-detail-value">
          ${escapeHtml(app.cv_version || 'CV non renseigné')}${app.cl_version ? ` · ${escapeHtml(app.cl_version)}` : ''}
          ${linkedDoc ? `<div style="margin-top:6px;"><button class="m3-btn m3-btn-tonal m3-btn-sm" onclick="openDocumentPreview(${linkedDoc.id})"><span class="material-symbols-rounded" style="font-size:15px;">visibility</span>Ouvrir le document</button></div>` : ''}
        </span>
      </div>
    `;

    document.getElementById('sheet-contact-box').innerHTML = `
      <span class="m3-detail-label">Contact Recruteur / Entreprise</span>
      <div class="m3-detail-value" style="margin-top:4px;">
        ${app.contact_name ? `<strong>${escapeHtml(app.contact_name)}</strong> ${app.contact_role ? `(${escapeHtml(app.contact_role)})` : ''}` : 'Aucun contact renseigné'}
      </div>
      <div style="font-size:12.5px; color:var(--md-sys-color-on-surface-variant); display:flex; gap:12px; flex-wrap:wrap; margin-top:4px;">
        ${app.contact_email ? `<span>✉️ ${escapeHtml(app.contact_email)}</span>` : ''}
        ${app.contact_phone ? `<span>📞 ${escapeHtml(app.contact_phone)}</span>` : ''}
      </div>
    `;

    document.getElementById('sheet-notes').textContent = app.notes || 'Aucune note enregistrée.';

    const timelineEl = document.getElementById('sheet-timeline');
    timelineEl.innerHTML = (app.events || []).map((ev) => `
      <div class="m3-timeline-item">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="m3-timeline-title">${escapeHtml(ev.title)}</span>
          <span class="m3-timeline-date">${formatDateTime(ev.event_date)}</span>
        </div>
        ${ev.description ? `<div class="m3-timeline-desc">${escapeHtml(ev.description)}</div>` : ''}
      </div>
    `).join('');

    if (showScrim) {
      document.getElementById('side-sheet-scrim').classList.add('open');
      document.getElementById('detail-side-sheet').classList.add('open');
    }
  } catch (err) {
    showSnackbar(`Erreur : ${err.message}`);
  }
}

function closeApplicationSheet() {
  state.activeAppId = null;
  document.getElementById('side-sheet-scrim').classList.remove('open');
  document.getElementById('detail-side-sheet').classList.remove('open');
}

/* ==========================================================================
   Material Design 3.0 Custom Select / Exposed Dropdown Menu Enhancer
   ========================================================================== */
const OPTION_ICONS = {
  all: 'filter_list',
  draft: 'edit_note',
  applied: 'send',
  interview: 'record_voice_over',
  technical: 'terminal',
  offer: 'verified',
  rejected: 'cancel',
  updated_desc: 'update',
  applied_desc: 'calendar_today',
  followup_asc: 'notifications_active',
  priority_desc: 'flag',
  company_asc: 'sort_by_alpha',
  alternance: 'school',
  job: 'business_center',
  stage: 'badge',
  freelance: 'laptop_mac',
  autre: 'category',
  hybrid: 'home_work',
  onsite: 'apartment',
  remote: 'public',
  high: 'priority_high',
  medium: 'drag_handle',
  low: 'low_priority',
  cv: 'badge',
  cover_letter: 'mail',
  portfolio: 'language',
  other: 'description'
};

function closeAllM3Dropdowns(exceptWrapper = null) {
  document.querySelectorAll('.m3-dropdown.open').forEach((dd) => {
    if (dd !== exceptWrapper) {
      dd.classList.remove('open');
      const trig = dd.querySelector('.m3-dropdown-trigger');
      if (trig) trig.setAttribute('aria-expanded', 'false');
    }
  });
}

function enhanceM3Selects(root = document) {
  const selects = root.querySelectorAll('select.m3-select, select.m3-input');
  selects.forEach((selectEl) => {
    if (selectEl.dataset.m3Enhanced === 'true') {
      if (typeof selectEl._m3Sync === 'function') selectEl._m3Sync();
      return;
    }
    selectEl.dataset.m3Enhanced = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'm3-dropdown';
    if (selectEl.id === 'filter-sort') {
      wrapper.classList.add('align-right');
    }

    selectEl.parentNode.insertBefore(wrapper, selectEl);
    wrapper.appendChild(selectEl);
    selectEl.classList.add('m3-dropdown-native');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'm3-dropdown-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'm3-dropdown-menu';
    menu.setAttribute('role', 'listbox');

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    function syncUI() {
      const options = Array.from(selectEl.options);
      const selectedOpt = options.find((o) => o.value === selectEl.value) || options[0];
      const selectedVal = selectedOpt ? selectedOpt.value : '';
      const selectedText = selectedOpt ? selectedOpt.textContent : '';
      const iconName = OPTION_ICONS[selectedVal] || '';

      trigger.innerHTML = `
        <span class="m3-dropdown-trigger-label">
          ${iconName ? `<span class="material-symbols-rounded" style="font-size:18px; color:var(--md-sys-color-primary);">${iconName}</span>` : ''}
          <span>${escapeHtml(selectedText)}</span>
        </span>
        <span class="material-symbols-rounded m3-dropdown-chevron">expand_more</span>
      `;

      menu.innerHTML = options.map((opt) => {
        const isSel = opt.value === selectedVal;
        const optIcon = OPTION_ICONS[opt.value] || '';
        return `
          <button
            type="button"
            class="m3-dropdown-option ${isSel ? 'selected' : ''}"
            role="option"
            aria-selected="${isSel}"
            data-value="${escapeHtml(opt.value)}"
          >
            <span style="display:inline-flex; align-items:center; gap:8px;">
              ${optIcon ? `<span class="material-symbols-rounded" style="font-size:18px; opacity:0.85;">${optIcon}</span>` : ''}
              <span>${escapeHtml(opt.textContent)}</span>
            </span>
            <span class="material-symbols-rounded m3-dropdown-option-check">check</span>
          </button>
        `;
      }).join('');

      menu.querySelectorAll('.m3-dropdown-option').forEach((optBtn) => {
        optBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const newVal = optBtn.dataset.value;
          if (selectEl.value !== newVal) {
            selectEl.value = newVal;
            syncUI();
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          closeAllM3Dropdowns();
        });
      });
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !wrapper.classList.contains('open');
      closeAllM3Dropdowns(wrapper);
      wrapper.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
    });

    selectEl._m3Sync = syncUI;
    syncUI();
  });
}

function syncAllM3Selects() {
  document.querySelectorAll('select[data-m3-enhanced="true"]').forEach((sel) => {
    if (typeof sel._m3Sync === 'function') sel._m3Sync();
  });
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

function enhanceM3FileInputs(root = document) {
  const inputs = root.querySelectorAll('input[type="file"].m3-input');
  inputs.forEach((fileInput) => {
    if (fileInput.dataset.m3FileEnhanced === 'true') {
      if (typeof fileInput._m3FileSync === 'function') fileInput._m3FileSync();
      return;
    }
    fileInput.dataset.m3FileEnhanced = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'm3-file-picker';

    fileInput.parentNode.insertBefore(wrapper, fileInput);
    wrapper.appendChild(fileInput);
    fileInput.classList.add('m3-file-picker-native');

    const acceptAttr = fileInput.getAttribute('accept') || '';
    const defaultHint = acceptAttr
      ? `Formats acceptés : ${acceptAttr.replace(/,/g, ', ')} · Glissez-déposez ici`
      : 'Glissez-déposez un fichier ici ou cliquez pour parcourir';

    const left = document.createElement('div');
    left.className = 'm3-file-picker-left';

    const btn = document.createElement('span');
    btn.className = 'm3-file-picker-btn';
    btn.innerHTML = `
      <span class="material-symbols-rounded" style="font-size:18px;">upload_file</span>
      <span>Choisir un fichier</span>
    `;

    const meta = document.createElement('div');
    meta.className = 'm3-file-picker-meta';

    const nameEl = document.createElement('span');
    nameEl.className = 'm3-file-picker-name';
    nameEl.textContent = 'Aucun fichier sélectionné';

    const hintEl = document.createElement('span');
    hintEl.className = 'm3-file-picker-hint';
    hintEl.textContent = defaultHint;

    meta.appendChild(nameEl);
    meta.appendChild(hintEl);
    left.appendChild(btn);
    left.appendChild(meta);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'm3-file-picker-clear';
    clearBtn.title = 'Retirer le fichier';
    clearBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:18px;">close</span>';

    wrapper.appendChild(left);
    wrapper.appendChild(clearBtn);

    function syncFileUI() {
      const f = fileInput.files && fileInput.files[0];
      if (f) {
        wrapper.classList.add('has-file');
        nameEl.textContent = f.name;
        hintEl.textContent = `Fichier prêt (${formatFileSize(f.size)})`;
        btn.innerHTML = `
          <span class="material-symbols-rounded" style="font-size:18px;">check_circle</span>
          <span>Modifier</span>
        `;
      } else {
        wrapper.classList.remove('has-file');
        nameEl.textContent = 'Aucun fichier sélectionné';
        hintEl.textContent = defaultHint;
        btn.innerHTML = `
          <span class="material-symbols-rounded" style="font-size:18px;">upload_file</span>
          <span>Choisir un fichier</span>
        `;
      }
    }

    wrapper.addEventListener('click', (e) => {
      if (e.target.closest('.m3-file-picker-clear')) return;
      fileInput.click();
    });

    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.value = '';
      syncFileUI();
    });

    fileInput.addEventListener('change', syncFileUI);

    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      wrapper.classList.add('drag-over');
    });

    wrapper.addEventListener('dragleave', () => {
      wrapper.classList.remove('drag-over');
    });

    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const dt = new DataTransfer();
        dt.items.add(e.dataTransfer.files[0]);
        fileInput.files = dt.files;
        syncFileUI();
      }
    });

    fileInput._m3FileSync = syncFileUI;
    syncFileUI();
  });
}

function syncAllM3FileInputs() {
  document.querySelectorAll('input[data-m3-file-enhanced="true"]').forEach((inp) => {
    if (typeof inp._m3FileSync === 'function') inp._m3FileSync();
  });
}

/* ==========================================================================
   Create / Edit Application Modal
   ========================================================================== */
function openNewApplicationDialog() {
  document.getElementById('application-form').reset();
  document.getElementById('app-id').value = '';
  document.getElementById('app-dialog-title').textContent = 'Nouvelle candidature';
  document.getElementById('app-applied-date').value = todayIsoDate();

  // Default follow-up +7 days
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  document.getElementById('app-followup-date').value = nextWeek.toISOString().slice(0, 10);

  syncAllM3Selects();
  document.getElementById('app-dialog-backdrop').classList.add('open');
  setTimeout(() => document.getElementById('app-company').focus(), 50);
}

async function openEditApplicationDialog(appId) {
  try {
    const app = await apiFetch(`/api/applications/${appId}`);
    document.getElementById('app-id').value = app.id;
    document.getElementById('app-dialog-title').textContent = `Modifier — ${app.company}`;
    document.getElementById('app-company').value = app.company || '';
    document.getElementById('app-role').value = app.role || '';
    document.getElementById('app-type').value = app.type || 'alternance';
    document.getElementById('app-status').value = app.status || 'applied';
    document.getElementById('app-location').value = app.location || '';
    document.getElementById('app-work-mode').value = app.work_mode || 'hybrid';
    document.getElementById('app-salary').value = app.salary || '';
    document.getElementById('app-rhythm').value = app.rhythm || '';
    document.getElementById('app-priority').value = app.priority || 'medium';
    document.getElementById('app-job-url').value = app.job_url || '';
    document.getElementById('app-applied-date').value = app.applied_date || '';
    document.getElementById('app-followup-date').value = app.follow_up_date || '';
    document.getElementById('app-interview-date').value = app.interview_date ? app.interview_date.slice(0, 16) : '';
    document.getElementById('app-contact-name').value = app.contact_name || '';
    document.getElementById('app-contact-role').value = app.contact_role || '';
    document.getElementById('app-contact-email').value = app.contact_email || '';
    document.getElementById('app-contact-phone').value = app.contact_phone || '';
    document.getElementById('app-cv-version').value = app.cv_version || '';
    document.getElementById('app-cl-version').value = app.cl_version || '';
    document.getElementById('app-notes').value = app.notes || '';

    syncAllM3Selects();
    document.getElementById('app-dialog-backdrop').classList.add('open');
  } catch (err) {
    showSnackbar(`Erreur : ${err.message}`);
  }
}

function closeApplicationDialog() {
  document.getElementById('app-dialog-backdrop').classList.remove('open');
}

/* ==========================================================================
   AI Agent Studio (Gemini-Inspired Copilot, Bento Hero & Smart Job Parser)
   ========================================================================== */
function formatAiMarkdown(text) {
  let safe = escapeHtml(text || '');
  safe = safe.replace(/```(?:\w+)?\n([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trim()}</code></pre>`);
  safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
  safe = safe.replace(/^###\s+(.+)$/gm, '<strong style="font-size:15px; display:block; margin:8px 0 4px; color:var(--md-sys-color-primary);">$1</strong>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\n/g, '<br/>');
  return safe;
}

function updateAiProviderBadge() {
  const badge = document.getElementById('ai-provider-badge');
  if (!badge || !state.aiSettings) return;
  const isLocal = (state.aiSettings.base_url || '').includes('localhost') || (state.aiSettings.base_url || '').includes('127.0.0.1');
  if (state.aiSettings.has_api_key || isLocal) {
    badge.textContent = `OpenAI · ${state.aiSettings.model || 'gpt-4o-mini'}`;
  } else {
    badge.textContent = 'Copilote Autonome · Actif';
  }
}

async function loadAiSettings() {
  try {
    const s = await apiFetch('/api/ai/settings');
    state.aiSettings = s;
    const baseInput = document.getElementById('ai-base-url');
    const keyInput = document.getElementById('ai-api-key');
    const modelInput = document.getElementById('ai-model');
    const nameInput = document.getElementById('ai-candidate-name');
    const profileInput = document.getElementById('ai-candidate-profile');

    if (baseInput) baseInput.value = s.base_url || 'https://api.openai.com/v1';
    if (keyInput) keyInput.value = s.api_key || '';
    if (modelInput) modelInput.value = s.model || 'gpt-4o-mini';
    if (nameInput) nameInput.value = s.candidate_name || 'Matteo';
    if (profileInput) profileInput.value = s.candidate_profile || '';
    updateAiProviderBadge();
  } catch (err) {
    console.warn('Impossible de charger les paramètres IA :', err.message);
  }
}

function renderAiContextCard() {
  const bodyEl = document.getElementById('ai-context-body');
  if (!bodyEl) return;

  const focusSelect = document.getElementById('ai-focus-app');
  const selectedId = focusSelect && focusSelect.value ? Number(focusSelect.value) : null;

  let targetApp = selectedId
    ? state.applications.find((a) => Number(a.id) === selectedId)
    : null;

  const isAutoSelected = !targetApp;
  if (!targetApp && state.stats && state.stats.urgentFollowUps && state.stats.urgentFollowUps.length > 0) {
    targetApp = state.stats.urgentFollowUps[0];
  }
  if (!targetApp && state.applications.length > 0) {
    targetApp = state.applications[0];
  }

  if (!targetApp) {
    bodyEl.innerHTML = `
      <div style="text-align:center; padding:12px 6px; color:var(--md-sys-color-on-surface-variant); font-size:13px;">
        Aucune candidature dans la base. Utilisez le <strong>Smart Job Parser IA</strong> ci-dessous pour en créer une en 1 clic !
      </div>
    `;
    return;
  }

  const sMeta = STATUS_META[targetApp.status] || STATUS_META.applied;
  const tMeta = TYPE_META[targetApp.type] || TYPE_META.autre;

  bodyEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
      <div style="display:flex; gap:6px; align-items:center;">
        <span class="m3-badge ${tMeta.cls}">${tMeta.label}</span>
        <span class="m3-badge ${sMeta.cls}">${sMeta.label}</span>
      </div>
      <span style="font-size:11px; font-weight:700; color:var(--md-sys-color-primary);">
        ${isAutoSelected ? '✨ Focus prioritaire auto' : '🎯 Focus sélectionné'}
      </span>
    </div>

    <div>
      <div style="font-size:16px; font-weight:800; color:var(--md-sys-color-on-surface);">
        ${escapeHtml(targetApp.company)}
      </div>
      <div style="font-size:13px; color:var(--md-sys-color-on-surface-variant); margin-top:2px;">
        ${escapeHtml(targetApp.role)}
      </div>
    </div>

    <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--md-sys-color-on-surface-variant);">
      <span>📍 ${escapeHtml(targetApp.location || 'Non précisé')}</span>
      <span>📅 Relance : <strong>${formatDate(targetApp.follow_up_date)}</strong></span>
    </div>

    <div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:4px; border-top:1px solid var(--md-sys-color-outline-variant);">
      <button type="button" class="m3-btn m3-btn-tonal m3-btn-sm" onclick="launchAiForApp(${targetApp.id}, 'followup')">
        <span class="material-symbols-rounded" style="font-size:15px;">forward_to_inbox</span>
        <span>Relance</span>
      </button>
      <button type="button" class="m3-btn m3-btn-tonal m3-btn-sm" onclick="launchAiForApp(${targetApp.id}, 'cover_letter')">
        <span class="material-symbols-rounded" style="font-size:15px;">picture_as_pdf</span>
        <span>Lettre PDF</span>
      </button>
      <button type="button" class="m3-btn m3-btn-tonal m3-btn-sm" onclick="launchAiForApp(${targetApp.id}, 'coach')">
        <span class="material-symbols-rounded" style="font-size:15px;">psychology</span>
        <span>Coach IA</span>
      </button>
      <button type="button" class="m3-btn m3-btn-outlined m3-btn-sm" onclick="openApplicationSheet(${targetApp.id})" title="Voir les détails">
        <span class="material-symbols-rounded" style="font-size:15px;">open_in_new</span>
      </button>
    </div>
  `;
}

function getHeroHtml() {
  const candidateName = (state.aiSettings && state.aiSettings.candidate_name) || 'Matteo';
  return `
    <div class="m3-ai-hero">
      <div class="m3-ai-hero-badge">
        <span class="material-symbols-rounded filled" style="font-size:16px;">auto_awesome</span>
        <span>Material You AI Copilot · Connecté à SQLite</span>
      </div>
      <h3 class="m3-ai-hero-heading">Bonjour ${escapeHtml(candidateName)}, sur quelle candidature travaille-t-on ?</h3>
      <p class="m3-ai-hero-desc">
        Choisissez une action rapide ci-dessous ou écrivez votre demande : je peux analyser votre pipeline, rédiger vos relances, générer une lettre de motivation en PDF ou créer une candidature.
      </p>

      <div class="m3-ai-bento-prompts">
        <button type="button" class="m3-ai-bento-card" data-prompt="Analyse mon pipeline de candidatures, mes statistiques et dis-moi quelles relances sont prioritaires aujourd'hui.">
          <div class="m3-ai-bento-icon">
            <span class="material-symbols-rounded">monitoring</span>
          </div>
          <div class="m3-ai-bento-text">
            <strong>Audit & Priorités du Pipeline</strong>
            <span>Analyse vos taux de retour, CV performants et relances urgentes du jour</span>
          </div>
          <span class="material-symbols-rounded m3-ai-bento-arrow">north_east</span>
        </button>

        <button type="button" class="m3-ai-bento-card" data-prompt="Rédige un email de relance percutant et un message LinkedIn pour la candidature sélectionnée (ou la plus urgente).">
          <div class="m3-ai-bento-icon">
            <span class="material-symbols-rounded">forward_to_inbox</span>
          </div>
          <div class="m3-ai-bento-text">
            <strong>Email & LinkedIn de Relance</strong>
            <span>Rédige un mail recruteur et une approche LinkedIn prêts à envoyer</span>
          </div>
          <span class="material-symbols-rounded m3-ai-bento-arrow">north_east</span>
        </button>

        <button type="button" class="m3-ai-bento-card" data-prompt="Génère une lettre de motivation sur-mesure pour la candidature sélectionnée et enregistre-la automatiquement en PDF dans mes documents CV & LM.">
          <div class="m3-ai-bento-icon">
            <span class="material-symbols-rounded">picture_as_pdf</span>
          </div>
          <div class="m3-ai-bento-text">
            <strong>Lettre de Motivation PDF</strong>
            <span>Rédige et génère automatiquement un document PDF dans votre bibliothèque</span>
          </div>
          <span class="material-symbols-rounded m3-ai-bento-arrow">north_east</span>
        </button>

        <button type="button" class="m3-ai-bento-card" data-prompt="Prépare-moi à l'entretien (questions techniques, questions RH, pitch et questions à poser) pour la candidature sélectionnée.">
          <div class="m3-ai-bento-icon">
            <span class="material-symbols-rounded">psychology</span>
          </div>
          <div class="m3-ai-bento-text">
            <strong>Coach d’Entretien Tech & RH</strong>
            <span>Questions probables, pitch personnalisé et questions stratégiques à poser</span>
          </div>
          <span class="material-symbols-rounded m3-ai-bento-arrow">north_east</span>
        </button>
      </div>
    </div>
  `;
}

function renderAiMessages() {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return;

  if (state.aiMessages.length === 0) {
    container.innerHTML = getHeroHtml();
    container.querySelectorAll('.m3-ai-bento-card').forEach((card) => {
      card.addEventListener('click', () => {
        sendAiMessage(card.dataset.prompt);
      });
    });
    return;
  }

  container.innerHTML = state.aiMessages.map((msg, idx) => {
    const isUser = msg.role === 'user';
    const actionsHtml = (msg.actions && msg.actions.length > 0)
      ? `<div class="m3-ai-actions-row">
          ${msg.actions.map((act) => `
            <span class="m3-ai-tool-pill">
              <span class="material-symbols-rounded" style="font-size:14px;">bolt</span>
              ${escapeHtml(act.label)}
            </span>
          `).join('')}
        </div>`
      : '';

    const docBtnHtml = msg.documentCreated
      ? `<div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--md-sys-color-outline-variant); display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" class="m3-btn m3-btn-filled m3-btn-sm" onclick="openDocumentPreview(${msg.documentCreated.id})">
            <span class="material-symbols-rounded" style="font-size:16px;">visibility</span>
            <span>Visualiser le PDF généré (${escapeHtml(msg.documentCreated.label)})</span>
          </button>
          <a href="/api/documents/${msg.documentCreated.id}/download" class="m3-btn m3-btn-tonal m3-btn-sm">
            <span class="material-symbols-rounded" style="font-size:16px;">download</span>
            <span>Télécharger</span>
          </a>
        </div>`
      : '';

    const footerHtml = (!isUser && !msg.isPending)
      ? `<div class="m3-ai-turn-footer">
          <button type="button" class="m3-ai-copy-btn" onclick="copyAiResponse(${idx})">
            <span class="material-symbols-rounded" style="font-size:14px;">content_copy</span>
            <span>Copier</span>
          </button>
          ${msg.warning ? `<span style="font-size:11px; color:var(--md-sys-color-on-surface-variant);">⚡ Mode autonome local actif</span>` : ''}
        </div>`
      : '';

    return `
      <div class="m3-ai-turn ${isUser ? 'user' : 'assistant'}">
        ${!isUser ? `
          <div class="m3-ai-turn-avatar">
            <span class="material-symbols-rounded filled" style="font-size:18px;">auto_awesome</span>
          </div>
        ` : ''}
        <div class="m3-ai-turn-content">
          ${actionsHtml}
          <div class="m3-ai-bubble">
            ${formatAiMarkdown(msg.content)}
            ${docBtnHtml}
          </div>
          ${footerHtml}
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

async function copyAiResponse(idx) {
  const msg = state.aiMessages[idx];
  if (!msg || !msg.content) return;
  try {
    await navigator.clipboard.writeText(msg.content);
    showSnackbar('Réponse copiée dans le presse-papiers !');
  } catch {
    showSnackbar('Impossible de copier automatiquement');
  }
}

async function sendAiMessage(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || state.aiSending) return;

  state.aiSending = true;
  const sendBtn = document.getElementById('btn-ai-send');
  const inputEl = document.getElementById('ai-chat-input');
  if (inputEl) inputEl.value = '';
  if (sendBtn) sendBtn.disabled = true;

  state.aiMessages.push({ role: 'user', content: trimmed });
  state.aiMessages.push({
    role: 'assistant',
    content: '✨ *Analyse de vos candidatures et génération en cours...*',
    isPending: true
  });
  renderAiMessages();

  const focusSelect = document.getElementById('ai-focus-app');
  const focusAppId = focusSelect && focusSelect.value ? Number(focusSelect.value) : null;

  try {
    const historyPayload = state.aiMessages
      .filter((m) => !m.isPending)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await apiFetch('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: historyPayload,
        focusAppId
      })
    });

    state.aiMessages = state.aiMessages.filter((m) => !m.isPending);
    state.aiMessages.push({
      role: 'assistant',
      content: res.reply || 'Opération effectuée.',
      actions: res.actions || [],
      documentCreated: res.documentCreated || null,
      warning: res.warning || null
    });

    if (res.mutated) {
      await refreshAllData();
    }
    renderAiMessages();
  } catch (err) {
    state.aiMessages = state.aiMessages.filter((m) => !m.isPending);
    state.aiMessages.push({
      role: 'assistant',
      content: `❌ Erreur : ${err.message}`
    });
    renderAiMessages();
  } finally {
    state.aiSending = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function launchAiForApp(appId, actionType) {
  closeApplicationSheet();
  switchView('agent');

  const focusSelect = document.getElementById('ai-focus-app');
  if (focusSelect) {
    focusSelect.value = String(appId);
    if (typeof focusSelect._m3Sync === 'function') focusSelect._m3Sync();
  }
  renderAiContextCard();

  const app = state.applications.find((a) => Number(a.id) === Number(appId));
  const label = app ? `${app.company} (${app.role})` : `la candidature #${appId}`;

  if (actionType === 'followup') {
    sendAiMessage(`Rédige un email de relance professionnel et un message LinkedIn court pour ma candidature chez ${label}.`);
  } else if (actionType === 'coach') {
    sendAiMessage(`Prépare-moi à l'entretien technique et RH pour ma candidature chez ${label} (questions probables, pitch et questions à poser).`);
  } else if (actionType === 'cover_letter') {
    sendAiMessage(`Génère une lettre de motivation personnalisée pour ma candidature chez ${label} et enregistre-la automatiquement en PDF dans mes documents.`);
  }
}

async function handleExtractJobOffer(autoCreate = false) {
  const textarea = document.getElementById('ai-extract-textarea');
  const text = textarea ? textarea.value.trim() : '';
  if (!text) {
    showSnackbar('Collez d’abord le texte d’une annonce d’emploi ou d’alternance');
    if (textarea) textarea.focus();
    return;
  }

  const btnPrefill = document.getElementById('btn-ai-extract-prefill');
  const btnCreate = document.getElementById('btn-ai-extract-create');
  if (btnPrefill) btnPrefill.disabled = true;
  if (btnCreate) btnCreate.disabled = true;

  try {
    const res = await apiFetch('/api/ai/extract-job', {
      method: 'POST',
      body: JSON.stringify({ text, autoCreate })
    });

    if (autoCreate && res.created) {
      textarea.value = '';
      showSnackbar(`✨ Candidature "${res.created.company} — ${res.created.role}" créée par l'IA !`);
      await refreshAllData();
      openApplicationSheet(res.created.id);
    } else if (res.extracted) {
      const ex = res.extracted;
      openNewApplicationDialog();
      document.getElementById('app-dialog-title').textContent = '✨ Candidature extraite par l’IA';
      document.getElementById('app-company').value = ex.company || '';
      document.getElementById('app-role').value = ex.role || '';
      document.getElementById('app-type').value = ex.type || 'alternance';
      document.getElementById('app-status').value = 'applied';
      document.getElementById('app-location').value = ex.location || '';
      document.getElementById('app-work-mode').value = ex.work_mode || 'hybrid';
      document.getElementById('app-salary').value = ex.salary || '';
      document.getElementById('app-rhythm').value = ex.rhythm || '';
      document.getElementById('app-contact-name').value = ex.contact_name || '';
      document.getElementById('app-contact-email').value = ex.contact_email || '';
      document.getElementById('app-notes').value = ex.notes || '';
      syncAllM3Selects();
      showSnackbar('Formulaire pré-rempli par l’IA ! Vérifiez et validez.');
    }
  } catch (err) {
    showSnackbar(`Erreur d'extraction : ${err.message}`);
  } finally {
    if (btnPrefill) btnPrefill.disabled = false;
    if (btnCreate) btnCreate.disabled = false;
  }
}

/* ==========================================================================
   Event Listeners Initialization
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initThemeAndPalette();
  enhanceM3Selects();
  enhanceM3FileInputs();
  refreshAllData();
  loadAiSettings();
  renderAiMessages();

  document.addEventListener('click', () => {
    closeAllM3Dropdowns();
  });

  // Navigation Rail clicks
  document.querySelectorAll('.m3-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('brand-home-link').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('dashboard');
  });

  document.getElementById('btn-goto-followups').addEventListener('click', () => switchView('followups'));
  document.getElementById('btn-goto-documents').addEventListener('click', () => switchView('documents'));

  // Filter Chips (Contract Type)
  document.querySelectorAll('#type-filter-chips .m3-filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#type-filter-chips .m3-filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.filters.type = chip.dataset.type;
      refreshAllData();
    });
  });

  // Due Follow-up & Favorites Filter Chips
  const dueChip = document.getElementById('chip-due-followup');
  dueChip.addEventListener('click', () => {
    state.filters.due_followup = !state.filters.due_followup;
    dueChip.classList.toggle('active', state.filters.due_followup);
    refreshAllData();
  });

  const favChip = document.getElementById('chip-favorites');
  favChip.addEventListener('click', () => {
    state.filters.favorite = !state.filters.favorite;
    favChip.classList.toggle('active', state.filters.favorite);
    refreshAllData();
  });

  document.getElementById('filter-status').addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    refreshAllData();
  });

  document.getElementById('filter-sort').addEventListener('change', (e) => {
    state.filters.sort = e.target.value;
    refreshAllData();
  });

  // Search Input
  let searchDebounce = null;
  document.getElementById('global-search').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.filters.search = e.target.value;
      refreshAllData();
    }, 180);
  });

  // Open / Close New Application Dialog
  document.getElementById('fab-new-app').addEventListener('click', openNewApplicationDialog);
  document.getElementById('btn-top-new-app').addEventListener('click', openNewApplicationDialog);
  document.getElementById('btn-close-app-dialog').addEventListener('click', closeApplicationDialog);
  document.getElementById('btn-cancel-app-dialog').addEventListener('click', closeApplicationDialog);

  // Submit Application Form
  document.getElementById('application-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('app-id').value;
    const payload = {
      company: document.getElementById('app-company').value,
      role: document.getElementById('app-role').value,
      type: document.getElementById('app-type').value,
      status: document.getElementById('app-status').value,
      location: document.getElementById('app-location').value,
      work_mode: document.getElementById('app-work-mode').value,
      salary: document.getElementById('app-salary').value,
      rhythm: document.getElementById('app-rhythm').value,
      priority: document.getElementById('app-priority').value,
      job_url: document.getElementById('app-job-url').value,
      applied_date: document.getElementById('app-applied-date').value,
      follow_up_date: document.getElementById('app-followup-date').value,
      interview_date: document.getElementById('app-interview-date').value,
      contact_name: document.getElementById('app-contact-name').value,
      contact_role: document.getElementById('app-contact-role').value,
      contact_email: document.getElementById('app-contact-email').value,
      contact_phone: document.getElementById('app-contact-phone').value,
      cv_version: document.getElementById('app-cv-version').value,
      cl_version: document.getElementById('app-cl-version').value,
      notes: document.getElementById('app-notes').value
    };

    try {
      if (id) {
        await apiFetch(`/api/applications/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        showSnackbar('Candidature mise à jour avec succès');
      } else {
        await apiFetch('/api/applications', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showSnackbar('Nouvelle candidature ajoutée !');
      }
      closeApplicationDialog();
      await refreshAllData();
    } catch (err) {
      showSnackbar(`Erreur : ${err.message}`);
    }
  });

  // Side Sheet Actions
  document.getElementById('side-sheet-scrim').addEventListener('click', closeApplicationSheet);
  document.getElementById('sheet-btn-close').addEventListener('click', closeApplicationSheet);
  document.getElementById('sheet-btn-edit').addEventListener('click', () => {
    if (state.activeAppId) openEditApplicationDialog(state.activeAppId);
  });
  document.getElementById('sheet-btn-delete').addEventListener('click', async () => {
    if (!state.activeAppId) return;
    if (!confirm('Voulez-vous vraiment supprimer cette candidature ?')) return;
    try {
      await apiFetch(`/api/applications/${state.activeAppId}`, { method: 'DELETE' });
      closeApplicationSheet();
      showSnackbar('Candidature supprimée');
      await refreshAllData();
    } catch (err) {
      showSnackbar(`Erreur : ${err.message}`);
    }
  });

  // Add Timeline Event Form
  document.getElementById('form-add-event').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activeAppId) return;
    const input = document.getElementById('event-title-input');
    const title = input.value.trim();
    if (!title) return;
    try {
      await apiFetch(`/api/applications/${state.activeAppId}/events`, {
        method: 'POST',
        body: JSON.stringify({ event_type: 'note', title })
      });
      input.value = '';
      showSnackbar('Étape ajoutée au journal de suivi');
      await refreshAllData();
    } catch (err) {
      showSnackbar(`Erreur : ${err.message}`);
    }
  });

  // Document Modal & In-Page Viewer
  const docBackdrop = document.getElementById('doc-dialog-backdrop');
  const previewBackdrop = document.getElementById('doc-preview-backdrop');

  document.getElementById('btn-close-doc-preview').addEventListener('click', closeDocumentPreview);
  previewBackdrop.addEventListener('click', (e) => {
    if (e.target === previewBackdrop) closeDocumentPreview();
  });

  document.getElementById('btn-new-document').addEventListener('click', () => {
    document.getElementById('document-form').reset();
    document.getElementById('doc-id').value = '';
    document.getElementById('doc-dialog-title').textContent = 'Ajouter un CV ou Document';
    syncAllM3Selects();
    syncAllM3FileInputs();
    docBackdrop.classList.add('open');
  });
  document.getElementById('btn-close-doc-dialog').addEventListener('click', () => docBackdrop.classList.remove('open'));
  document.getElementById('btn-cancel-doc-dialog').addEventListener('click', () => docBackdrop.classList.remove('open'));

  document.getElementById('document-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const docId = document.getElementById('doc-id').value;
    const fileInput = document.getElementById('doc-file');
    const file = fileInput.files[0];

    let fileBase64 = '';
    let fileName = '';
    let mimeType = '';

    if (file) {
      fileName = file.name;
      mimeType = file.type || 'application/octet-stream';
      fileBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    const payload = {
      label: document.getElementById('doc-label').value,
      doc_type: document.getElementById('doc-type').value,
      version_tag: document.getElementById('doc-version').value,
      external_url: document.getElementById('doc-url').value,
      notes: document.getElementById('doc-notes').value
    };

    if (fileBase64) {
      payload.file_name = fileName;
      payload.mime_type = mimeType;
      payload.file_base64 = fileBase64;
    }

    try {
      if (docId) {
        await apiFetch(`/api/documents/${docId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        showSnackbar('Document mis à jour');
      } else {
        await apiFetch('/api/documents', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showSnackbar('Document ajouté à la bibliothèque');
      }
      docBackdrop.classList.remove('open');
      await refreshAllData();
    } catch (err) {
      showSnackbar(`Erreur : ${err.message}`);
    }
  });

  // Import / Export Modal
  const ieBackdrop = document.getElementById('import-export-backdrop');
  const openImportExport = () => {
    const fileInp = document.getElementById('import-file-input');
    if (fileInp) fileInp.value = '';
    syncAllM3FileInputs();
    ieBackdrop.classList.add('open');
  };
  document.getElementById('btn-open-import-export').addEventListener('click', openImportExport);
  document.getElementById('btn-top-import-export').addEventListener('click', openImportExport);
  document.getElementById('btn-close-import-export').addEventListener('click', () => ieBackdrop.classList.remove('open'));

  document.getElementById('btn-run-import').addEventListener('click', async () => {
    const fileInput = document.getElementById('import-file-input');
    const file = fileInput.files[0];
    if (!file) {
      showSnackbar('Veuillez sélectionner un fichier .csv ou .json');
      return;
    }

    try {
      const text = await file.text();
      let payload;
      if (file.name.endsWith('.json')) {
        payload = JSON.parse(text);
      } else {
        payload = { csv: text };
      }
      const res = await apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      ieBackdrop.classList.remove('open');
      showSnackbar(`${res.imported_count} candidature(s) importée(s) avec succès !`);
      await refreshAllData();
    } catch (err) {
      showSnackbar(`Erreur d'importation : ${err.message}`);
    }
  });

  // AI Agent Studio Event Listeners
  const aiSettingsBackdrop = document.getElementById('ai-settings-backdrop');
  const openAiSettings = () => {
    if (aiSettingsBackdrop) aiSettingsBackdrop.classList.add('open');
  };
  const closeAiSettings = () => {
    if (aiSettingsBackdrop) aiSettingsBackdrop.classList.remove('open');
  };

  const btnOpenAiSettings = document.getElementById('btn-open-ai-settings');
  if (btnOpenAiSettings) btnOpenAiSettings.addEventListener('click', openAiSettings);
  const btnOpenAiSettingsSec = document.getElementById('btn-open-ai-settings-secondary');
  if (btnOpenAiSettingsSec) btnOpenAiSettingsSec.addEventListener('click', openAiSettings);
  const btnCloseAiSettings = document.getElementById('btn-close-ai-settings');
  if (btnCloseAiSettings) btnCloseAiSettings.addEventListener('click', closeAiSettings);
  if (aiSettingsBackdrop) {
    aiSettingsBackdrop.addEventListener('click', (e) => {
      if (e.target === aiSettingsBackdrop) closeAiSettings();
    });
  }

  const aiFocusSelect = document.getElementById('ai-focus-app');
  if (aiFocusSelect) {
    aiFocusSelect.addEventListener('change', () => {
      renderAiContextCard();
    });
  }

  const aiChatForm = document.getElementById('ai-chat-form');
  if (aiChatForm) {
    aiChatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = document.getElementById('ai-chat-input');
      if (inp && inp.value.trim()) {
        sendAiMessage(inp.value);
      }
    });
  }

  document.querySelectorAll('#ai-quick-prompts .m3-ai-suggestion-pill').forEach((chip) => {
    chip.addEventListener('click', () => {
      sendAiMessage(chip.dataset.prompt);
    });
  });

  const btnClearChat = document.getElementById('btn-ai-clear-chat');
  if (btnClearChat) {
    btnClearChat.addEventListener('click', () => {
      state.aiMessages = [];
      renderAiMessages();
      showSnackbar('Nouvelle session IA démarrée');
    });
  }

  const btnSampleOffer = document.getElementById('btn-ai-sample-offer');
  if (btnSampleOffer) {
    btnSampleOffer.addEventListener('click', () => {
      const ta = document.getElementById('ai-extract-textarea');
      if (ta) {
        ta.value =
          `Entreprise : Datadog\n` +
          `Poste : Alternance Développeur Fullstack Node.js & React (H/F)\n` +
          `Lieu : Paris (Mode Hybride - 2j de télétravail)\n` +
          `Rémunération : 1 850 € / mois\n` +
          `Rythme : 3 semaines entreprise / 1 semaine école (12 ou 24 mois)\n` +
          `Contact : recrutement.fr@datadoghq.com\n` +
          `Stack : TypeScript, Node.js, React, PostgreSQL, Docker, Cloud AWS.`;
        ta.focus();
      }
    });
  }

  const btnExtractPrefill = document.getElementById('btn-ai-extract-prefill');
  if (btnExtractPrefill) {
    btnExtractPrefill.addEventListener('click', () => handleExtractJobOffer(false));
  }

  const btnExtractCreate = document.getElementById('btn-ai-extract-create');
  if (btnExtractCreate) {
    btnExtractCreate.addEventListener('click', () => handleExtractJobOffer(true));
  }

  document.querySelectorAll('#ai-provider-presets .m3-ai-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.getElementById('ai-base-url').value = chip.dataset.base;
      document.getElementById('ai-model').value = chip.dataset.model;
      showSnackbar(`Pré-réglage ${chip.textContent.trim()} appliqué`);
    });
  });

  const btnClearKey = document.getElementById('btn-ai-clear-key');
  if (btnClearKey) {
    btnClearKey.addEventListener('click', async () => {
      try {
        document.getElementById('ai-api-key').value = '';
        const saved = await apiFetch('/api/ai/settings', {
          method: 'PUT',
          body: JSON.stringify({ api_key: '' })
        });
        state.aiSettings = saved;
        updateAiProviderBadge();
        closeAiSettings();
        showSnackbar('Mode autonome sans clé activé');
      } catch (err) {
        showSnackbar(`Erreur : ${err.message}`);
      }
    });
  }

  const aiSettingsForm = document.getElementById('ai-settings-form');
  if (aiSettingsForm) {
    aiSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const payload = {
          base_url: document.getElementById('ai-base-url').value,
          api_key: document.getElementById('ai-api-key').value,
          model: document.getElementById('ai-model').value,
          candidate_name: document.getElementById('ai-candidate-name').value,
          candidate_profile: document.getElementById('ai-candidate-profile').value
        };
        const saved = await apiFetch('/api/ai/settings', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        state.aiSettings = saved;
        document.getElementById('ai-api-key').value = saved.api_key || '';
        updateAiProviderBadge();
        if (state.aiMessages.length === 0) renderAiMessages();
        closeAiSettings();
        showSnackbar('Configuration IA enregistrée !');
      } catch (err) {
        showSnackbar(`Erreur : ${err.message}`);
      }
    });
  }

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (e.key === 'Escape') {
      closeAllM3Dropdowns();
      closeDocumentPreview();
      closeApplicationDialog();
      docBackdrop.classList.remove('open');
      ieBackdrop.classList.remove('open');
      closeAiSettings();
      closeApplicationSheet();
      return;
    }

    if (!isInput && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      openNewApplicationDialog();
    } else if (!isInput && e.key === '/') {
      e.preventDefault();
      document.getElementById('global-search').focus();
    }
  });
});

// Expose functions used by inline event handlers
window.openApplicationSheet = openApplicationSheet;
window.openEditApplicationDialog = openEditApplicationDialog;
window.changeApplicationStatus = changeApplicationStatus;
window.toggleFavorite = toggleFavorite;
window.quickMarkFollowUp = quickMarkFollowUp;
window.deleteDocumentItem = deleteDocumentItem;
window.openDocumentPreview = openDocumentPreview;
window.closeDocumentPreview = closeDocumentPreview;
window.openEditDocumentDialog = openEditDocumentDialog;
window.switchView = switchView;
window.launchAiForApp = launchAiForApp;
window.copyAiResponse = copyAiResponse;



