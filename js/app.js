/* ============================================================
   CinéTrack — application de suivi de séries & films
   Données : API TMDB (themoviedb.org) — clé personnelle gratuite
   Stockage : localStorage (sur l'appareil uniquement)
   ============================================================ */
'use strict';

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------
const APP_VERSION = '1.1.0';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/';
const LS_LIB = 'cinetrack.library.v1';
const LS_KEY = 'cinetrack.apikey';

const STATUS_FR = {
  'Returning Series': 'En cours de diffusion',
  'Ended': 'Terminée',
  'Canceled': 'Annulée',
  'Cancelled': 'Annulée',
  'In Production': 'En production',
  'Planned': 'Prévue',
  'Pilot': 'Pilote',
  'Released': 'Sorti',
  'Post Production': 'Post-production',
  'Rumored': 'Rumeur',
};

// ------------------------------------------------------------
// Petits utilitaires
// ------------------------------------------------------------
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** Crée un élément DOM. attrs: {class, text, ...attributs}. Le texte passe par textContent (pas d'injection HTML). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

let toastTimer;
function toast(msg) {
  const node = $('#toast');
  node.textContent = msg;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? '' : dateFmt.format(d);
}

function isFuture(iso) {
  if (!iso) return true; // pas de date = pas encore diffusé
  return iso > new Date().toISOString().slice(0, 10);
}

function yearOf(iso) {
  return iso ? iso.slice(0, 4) : '';
}

function posterUrl(path, size) {
  return path ? IMG_BASE + (size || 'w154') + path : null;
}

function posterEl(path, size, big) {
  const url = posterUrl(path, size);
  if (url) {
    return el('img', { class: big ? 'detail-poster' : 'poster', src: url, alt: '', loading: 'lazy' });
  }
  return el('div', { class: big ? 'detail-poster poster-fallback' : 'poster-fallback', text: '🎬' });
}

// ------------------------------------------------------------
// Stockage : clé API + bibliothèque
// ------------------------------------------------------------
function getApiKey() {
  try { return (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) { return ''; }
}
function setApiKey(key) {
  try { localStorage.setItem(LS_KEY, key.trim()); } catch (e) { toast('Impossible d’enregistrer la clé'); }
}

let lib = loadLib();

function loadLib() {
  try {
    const raw = localStorage.getItem(LS_LIB);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data.items === 'object' && data.items !== null) {
        return { version: 1, items: normalizeItems(data.items) };
      }
    }
  } catch (e) { /* données corrompues → on repart de zéro */ }
  return { version: 1, items: {} };
}

/** Valide et répare des éléments venant du stockage ou d'une sauvegarde ; les entrées non conformes sont ignorées. */
function normalizeItems(rawItems) {
  const items = {};
  if (!rawItems || typeof rawItems !== 'object') return items;
  for (const raw of Object.values(rawItems)) {
    if (!raw || typeof raw !== 'object') continue;
    const type = raw.type === 'tv' ? 'tv' : (raw.type === 'movie' ? 'movie' : null);
    const id = Number(raw.id);
    if (!type || !Number.isFinite(id)) continue;
    const item = {
      type,
      id,
      title: typeof raw.title === 'string' ? raw.title : '',
      poster: typeof raw.poster === 'string' ? raw.poster : null,
      year: typeof raw.year === 'string' ? raw.year : '',
      addedAt: Number(raw.addedAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
    if (type === 'tv') {
      item.status = typeof raw.status === 'string' ? raw.status : '';
      item.seasons = (Array.isArray(raw.seasons) ? raw.seasons : [])
        .filter(s => s && typeof s === 'object' && s.n != null && Number.isFinite(Number(s.n)))
        .map(s => {
          const season = {
            n: Number(s.n),
            name: typeof s.name === 'string' ? s.name : ('Saison ' + s.n),
            count: Number(s.count) || 0,
          };
          if (s.aired != null && Number.isFinite(Number(s.aired))) season.aired = Number(s.aired);
          return season;
        });
      item.watched = {};
      if (raw.watched && typeof raw.watched === 'object') {
        for (const [n, list] of Object.entries(raw.watched)) {
          if (!Array.isArray(list)) continue;
          const nums = list.map(Number).filter(Number.isFinite);
          if (nums.length) item.watched[n] = nums;
        }
      }
    } else {
      item.watched = !!raw.watched;
      item.watchedAt = Number(raw.watchedAt) || null;
    }
    items[type + ':' + id] = item;
  }
  return items;
}

function saveLib() {
  try {
    localStorage.setItem(LS_LIB, JSON.stringify(lib));
  } catch (e) {
    toast('Stockage plein : sauvegarde impossible');
  }
}

function libKey(type, id) { return type + ':' + id; }
function getItem(type, id) { return lib.items[libKey(type, id)] || null; }

function removeItem(type, id) {
  delete lib.items[libKey(type, id)];
  saveLib();
}

/** Total d'épisodes comptabilisés pour une saison : épisodes déjà diffusés si connus, sinon compteur TMDB. */
function seasonTotal(s) {
  return (s.aired !== undefined && s.aired !== null) ? s.aired : (s.count || 0);
}

/** Progression d'une série (hors saison 0 "Épisodes spéciaux"). */
function tvProgress(item) {
  let total = 0, seen = 0;
  for (const s of item.seasons || []) {
    if (s.n === 0) continue;
    const t = seasonTotal(s);
    total += t;
    const w = item.watched[s.n];
    seen += Math.min(w ? w.length : 0, t);
  }
  return { total, seen };
}

function seasonSeen(item, n) {
  const w = item && item.watched[n];
  return w ? w.length : 0;
}

function isDone(item) {
  if (item.type === 'movie') return !!item.watched;
  const p = tvProgress(item);
  return p.total > 0 && p.seen >= p.total;
}

// ------------------------------------------------------------
// API TMDB
// ------------------------------------------------------------
class ApiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function api(path, params = {}) {
  const key = getApiKey();
  if (!key) throw new ApiError('NO_KEY');
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set('language', 'fr-FR');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const opts = { headers: { Accept: 'application/json' } };
  // Jeton v4 (long, commence par "eyJ") → en-tête Bearer ; clé v3 courte → paramètre api_key
  if (key.startsWith('eyJ')) opts.headers.Authorization = 'Bearer ' + key;
  else url.searchParams.set('api_key', key);

  let res;
  try {
    res = await fetch(url.toString(), opts);
  } catch (e) {
    throw new ApiError('NETWORK');
  }
  if (res.status === 401) throw new ApiError('AUTH');
  if (res.status === 404) throw new ApiError('NOT_FOUND');
  if (res.status === 429) throw new ApiError('RATE_LIMIT');
  if (!res.ok) throw new ApiError('HTTP_' + res.status);
  return res.json();
}

function apiErrorMessage(err) {
  switch (err && err.code) {
    case 'NO_KEY': return 'Aucune clé API TMDB configurée. Ajoutez-la dans Réglages.';
    case 'AUTH': return 'Clé API TMDB invalide. Vérifiez-la dans Réglages.';
    case 'NETWORK': return 'Pas de connexion internet.';
    case 'NOT_FOUND': return 'Fiche introuvable sur TMDB (peut-être supprimée ou fusionnée).';
    case 'RATE_LIMIT': return 'Trop de requêtes TMDB : patientez quelques secondes puis réessayez.';
    default: return 'Erreur TMDB (' + (err && err.code || 'inconnue') + '). Réessayez.';
  }
}

// Cache mémoire des épisodes par saison (clé "tvId:n")
const seasonCache = new Map();

async function loadSeasonEpisodes(tvId, n) {
  const cacheKey = tvId + ':' + n;
  if (seasonCache.has(cacheKey)) return seasonCache.get(cacheKey);
  const data = await api('/tv/' + tvId + '/season/' + n);
  const eps = (data.episodes || []).map(e => ({
    n: e.episode_number,
    name: e.name || ('Épisode ' + e.episode_number),
    date: e.air_date || '',
  }));
  seasonCache.set(cacheKey, eps);
  // synchronise le compteur de la saison suivie avec la réalité (TMDB annonce parfois
  // un episode_count incluant des épisodes futurs, ou décalé de la vraie liste)
  const item = getItem('tv', tvId);
  if (item) {
    const se = (item.seasons || []).find(s => s.n === n);
    if (se) {
      se.count = eps.length;
      se.aired = eps.filter(e => !isFuture(e.date)).length;
      saveLib();
    }
  }
  return eps;
}

// ------------------------------------------------------------
// État de l'interface
// ------------------------------------------------------------
const ui = {
  tab: 'library',
  libType: 'tv',      // tv | movie
  libStatus: 'all',   // all | ongoing | done
  detail: null,       // { type, id, data } fiche ouverte
  openSeasons: new Set(),
};

// ------------------------------------------------------------
// Navigation par onglets
// ------------------------------------------------------------
function switchTab(tab) {
  ui.tab = tab;
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#view-library').classList.toggle('hidden', tab !== 'library');
  $('#view-search').classList.toggle('hidden', tab !== 'search');
  $('#view-settings').classList.toggle('hidden', tab !== 'settings');
  $('#topbar-title').textContent = tab === 'library' ? 'Ma liste' : tab === 'search' ? 'Recherche' : 'Réglages';
  if (tab === 'library') renderLibrary();
  if (tab === 'settings') renderSettings();
  if (tab === 'search') setTimeout(() => $('#search-input').focus(), 50);
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------
// Vue : Ma liste
// ------------------------------------------------------------
const CHIP_LABELS = {
  tv: { all: 'Toutes', ongoing: 'En cours', done: 'Terminées' },
  movie: { all: 'Tous', ongoing: 'À voir', done: 'Vus' },
};

function updateChipLabels() {
  $$('#lib-chips .chip').forEach(c => { c.textContent = CHIP_LABELS[ui.libType][c.dataset.status]; });
}

function renderLibrary() {
  const list = $('#lib-list');
  list.textContent = '';

  const items = Object.values(lib.items)
    .filter(it => it.type === ui.libType)
    .filter(it => {
      if (ui.libStatus === 'done') return isDone(it);
      if (ui.libStatus === 'ongoing') return !isDone(it);
      return true;
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const anyOfType = Object.values(lib.items).some(it => it.type === ui.libType);
  $('#lib-empty').classList.toggle('hidden', anyOfType);

  if (!anyOfType) {
    // message adapté : la bibliothèque peut contenir l'autre catégorie
    const anyAtAll = Object.keys(lib.items).length > 0;
    $('#lib-empty-title').textContent = anyAtAll
      ? (ui.libType === 'tv' ? 'Aucune série dans votre liste' : 'Aucun film dans votre liste')
      : 'Votre liste est vide';
    return;
  }

  if (!items.length) {
    list.appendChild(el('p', { class: 'center', text: 'Rien dans cette catégorie.' }));
    return;
  }

  for (const item of items) {
    list.appendChild(libraryCard(item));
  }
}

function libraryCard(item) {
  const info = el('div', { class: 'card-info' },
    el('p', { class: 'card-title', text: item.title }),
  );

  if (item.type === 'tv') {
    const p = tvProgress(item);
    const pct = p.total ? Math.round((p.seen / p.total) * 100) : 0;
    const sub = el('div', { class: 'card-sub' }, item.year || '');
    if (item.status && STATUS_FR[item.status]) sub.appendChild(el('span', { class: 'badge', text: STATUS_FR[item.status] }));
    if (isDone(item)) sub.appendChild(el('span', { class: 'badge done', text: '✓ Vue' }));
    info.appendChild(sub);
    info.appendChild(el('div', { class: 'progress-wrap' },
      el('div', { class: 'progress-bar' },
        el('div', { class: 'progress-fill' + (pct >= 100 ? ' full' : ''), style: 'width:' + pct + '%' })),
      el('span', { class: 'progress-text', text: p.seen + '/' + p.total + ' ép.' }),
    ));
  } else {
    const sub = el('div', { class: 'card-sub' }, item.year || '');
    sub.appendChild(el('span', {
      class: 'badge' + (item.watched ? ' done' : ''),
      text: item.watched ? '✓ Vu' : 'À voir',
    }));
    info.appendChild(sub);
  }

  return el('button', { class: 'card', onclick: () => openDetail(item.type, item.id) },
    posterEl(item.poster), info);
}

// ------------------------------------------------------------
// Vue : Recherche
// ------------------------------------------------------------
let lastSearchToken = 0;
let searchPaging = { query: '', page: 1, totalPages: 1 };

async function runSearch(query, page) {
  const status = $('#search-status');
  const results = $('#search-results');
  const token = ++lastSearchToken;
  const append = (page || 1) > 1; // pages suivantes : on ajoute à la liste existante

  query = query.trim();
  $('#search-clear').classList.toggle('hidden', !query);

  if (!query) {
    status.textContent = '';
    results.textContent = '';
    return;
  }
  if (!getApiKey()) {
    results.textContent = '';
    status.textContent = '';
    status.appendChild(el('span', { text: 'Configurez d’abord votre clé TMDB gratuite dans ' }));
    status.appendChild(el('button', { class: 'linklike', text: 'Réglages', onclick: () => switchTab('settings') }));
    status.appendChild(el('span', { text: '.' }));
    return;
  }

  const oldMore = $('#search-more');
  if (oldMore) oldMore.remove();
  if (!append) status.textContent = 'Recherche…';

  try {
    const data = await api('/search/multi', { query, include_adult: 'false', page: String(page || 1) });
    if (token !== lastSearchToken) return; // une recherche plus récente est en cours
    const hits = (data.results || []).filter(r => r.media_type === 'tv' || r.media_type === 'movie');
    if (!append) results.textContent = '';
    searchPaging = { query, page: data.page || page || 1, totalPages: data.total_pages || 1 };
    status.textContent = '';
    for (const r of hits) results.appendChild(searchCard(r));
    if (searchPaging.page < searchPaging.totalPages) {
      results.appendChild(el('button', {
        id: 'search-more', class: 'btn btn-ghost btn-block', text: 'Plus de résultats',
        onclick: () => runSearch(searchPaging.query, searchPaging.page + 1),
      }));
    }
    if (!results.childElementCount) {
      status.textContent = 'Aucun résultat pour « ' + query + ' ».';
    }
  } catch (err) {
    if (token !== lastSearchToken) return;
    if (!append) results.textContent = '';
    status.textContent = apiErrorMessage(err);
  }
}

function searchCard(r) {
  const isTv = r.media_type === 'tv';
  const title = isTv ? r.name : r.title;
  const year = yearOf(isTv ? r.first_air_date : r.release_date);
  const inLib = !!getItem(r.media_type, r.id);

  const addBtn = el('button', {
    class: 'card-add' + (inLib ? ' added' : ''),
    text: inLib ? '✓' : '+',
    'data-key': r.media_type + ':' + r.id,
    'aria-label': inLib ? 'Déjà dans ma liste' : 'Ajouter à ma liste',
    onclick: (ev) => {
      ev.stopPropagation();
      quickAdd(r, addBtn);
    },
  });

  const sub = el('div', { class: 'card-sub' },
    el('span', { class: 'badge', text: isTv ? 'Série' : 'Film' }),
    year ? el('span', { text: year }) : null,
  );

  return el('div', { class: 'card', role: 'button', tabindex: '0',
    onclick: () => openDetail(r.media_type, r.id),
    onkeydown: (ev) => {
      // seule la carte elle-même réagit à Entrée (pas le bouton « + » qui a son propre clic)
      if (ev.key === 'Enter' && ev.target === ev.currentTarget && !ev.repeat) openDetail(r.media_type, r.id);
    } },
    posterEl(r.poster_path),
    el('div', { class: 'card-info' }, el('p', { class: 'card-title', text: title }), sub),
    addBtn,
  );
}

async function quickAdd(r, btn) {
  if (getItem(r.media_type, r.id)) {
    refreshSearchAddButtons();
    toast('Déjà dans votre liste');
    return;
  }
  btn.textContent = '…';
  try {
    const data = await api('/' + r.media_type + '/' + r.id);
    createItemFromDetail(r.media_type, data);
    toast('Ajouté à votre liste');
  } catch (err) {
    toast(apiErrorMessage(err));
  } finally {
    // met à jour les boutons du rendu COURANT (le nôtre a pu être remplacé par une nouvelle recherche)
    refreshSearchAddButtons();
  }
}

// ------------------------------------------------------------
// Fiche détail (série ou film)
// ------------------------------------------------------------
function createItemFromDetail(type, d) {
  const item = type === 'tv' ? {
    type: 'tv',
    id: d.id,
    title: d.name || '',
    poster: d.poster_path || null,
    year: yearOf(d.first_air_date),
    status: d.status || '',
    seasons: (d.seasons || []).map(s => ({ n: s.season_number, name: s.name || ('Saison ' + s.season_number), count: s.episode_count || 0 })),
    watched: {},
    addedAt: Date.now(),
    updatedAt: Date.now(),
  } : {
    type: 'movie',
    id: d.id,
    title: d.title || '',
    poster: d.poster_path || null,
    year: yearOf(d.release_date),
    watched: false,
    addedAt: Date.now(),
    updatedAt: Date.now(),
  };
  lib.items[libKey(type, d.id)] = item;
  saveLib();
  return item;
}

/** Met à jour les métadonnées d'un élément existant depuis TMDB (garde le suivi "vu"). */
function refreshItemFromDetail(item, d) {
  if (item.type === 'tv') {
    item.title = d.name || item.title;
    item.poster = d.poster_path || item.poster;
    item.year = yearOf(d.first_air_date) || item.year;
    item.status = d.status || item.status;
    // on conserve le nombre d'épisodes diffusés déjà appris via /season (episode_count TMDB inclut les futurs)
    const prevAired = new Map((item.seasons || []).map(s => [s.n, s.aired]));
    item.seasons = (d.seasons || []).map(s => {
      const season = { n: s.season_number, name: s.name || ('Saison ' + s.season_number), count: s.episode_count || 0 };
      const aired = prevAired.get(season.n);
      if (aired !== undefined && aired !== null) season.aired = aired;
      return season;
    });
  } else {
    item.title = d.title || item.title;
    item.poster = d.poster_path || item.poster;
    item.year = yearOf(d.release_date) || item.year;
  }
  item.updatedAt = Date.now();
  saveLib();
}

async function openDetail(type, id) {
  const wasOpen = !!ui.detail;
  ui.detail = { type, id, data: null };
  ui.openSeasons = new Set();
  const panel = $('#detail');
  const body = $('#detail-body');
  $('#detail-title').textContent = '';
  body.textContent = '';
  body.appendChild(el('div', { class: 'center' }, el('div', { class: 'spinner' })));
  panel.classList.remove('hidden');
  // une seule entrée d'historique par fiche ouverte (« Réessayer » ne doit pas en empiler)
  if (!wasOpen) {
    lockBodyScroll();
    history.pushState({ detail: true }, '');
  }

  const item = getItem(type, id);
  if (item) renderDetailFromItem(item); // affichage immédiat depuis les données locales

  // puis actualisation depuis TMDB (nouvelles saisons, épisodes, résumé…)
  try {
    const data = await api('/' + type + '/' + id);
    if (!ui.detail || ui.detail.type !== type || ui.detail.id !== id) return;
    ui.detail.data = data;
    const current = getItem(type, id);
    if (current) refreshItemFromDetail(current, data);
    renderDetail(type, data);
  } catch (err) {
    if (!ui.detail || ui.detail.type !== type || ui.detail.id !== id) return;
    if (item) {
      toast('Actualisation impossible : ' + apiErrorMessage(err));
    } else {
      body.textContent = '';
      body.appendChild(el('div', { class: 'empty' },
        el('div', { class: 'empty-icon', text: '📡' }),
        el('p', { class: 'empty-title', text: 'Chargement impossible' }),
        el('p', { class: 'empty-sub', text: apiErrorMessage(err) }),
        el('button', { class: 'btn btn-primary', text: 'Réessayer', onclick: () => openDetail(type, id) }),
      ));
    }
  }
}

/** Affichage à partir des seules données locales (hors-ligne). */
function renderDetailFromItem(item) {
  if (item.type === 'tv') {
    renderDetail('tv', {
      id: item.id, name: item.title, poster_path: item.poster,
      first_air_date: item.year ? item.year + '-01-01' : '',
      status: item.status, overview: '',
      seasons: (item.seasons || []).map(s => ({ season_number: s.n, name: s.name, episode_count: s.count })),
    });
  } else {
    renderDetail('movie', {
      id: item.id, title: item.title, poster_path: item.poster,
      release_date: item.year ? item.year + '-01-01' : '', overview: '',
    });
  }
}

function closeDetailPanel() {
  ui.detail = null;
  $('#detail').classList.add('hidden');
  unlockBodyScroll();
  // Rafraîchit la vue courante (les compteurs peuvent avoir changé)
  if (ui.tab === 'library') renderLibrary();
  if (ui.tab === 'search') refreshSearchAddButtons();
}

// Verrouille le défilement de la page derrière la fiche (sinon, sur iOS, le geste
// de défilement « traverse » l'overlay et la liste perd sa position)
let savedScrollY = 0;
function lockBodyScroll() {
  savedScrollY = window.scrollY || 0;
  document.body.style.top = -savedScrollY + 'px';
  document.body.classList.add('modal-open');
}
function unlockBodyScroll() {
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, savedScrollY);
}

function refreshSearchAddButtons() {
  // Met à jour les boutons "+" des résultats selon l'état actuel de la bibliothèque
  $$('#search-results .card-add').forEach(btn => {
    const inLib = !!lib.items[btn.dataset.key];
    btn.classList.toggle('added', inLib);
    btn.textContent = inLib ? '✓' : '+';
    btn.setAttribute('aria-label', inLib ? 'Déjà dans ma liste' : 'Ajouter à ma liste');
  });
}

function renderDetail(type, d) {
  const body = $('#detail-body');
  body.textContent = '';
  const title = type === 'tv' ? d.name : d.title;
  $('#detail-title').textContent = title || '';

  // --- entête ---
  const subParts = [];
  if (type === 'tv') {
    const y = yearOf(d.first_air_date);
    if (y) subParts.push(y);
    if (d.status && STATUS_FR[d.status]) subParts.push(STATUS_FR[d.status]);
    if (Array.isArray(d.genres) && d.genres.length) subParts.push(d.genres.map(g => g.name).join(', '));
  } else {
    const y = yearOf(d.release_date);
    if (y) subParts.push(y);
    if (d.runtime) subParts.push(d.runtime + ' min');
    if (Array.isArray(d.genres) && d.genres.length) subParts.push(d.genres.map(g => g.name).join(', '));
  }

  body.appendChild(el('div', { class: 'detail-hero' },
    posterEl(d.poster_path, 'w342', true),
    el('div', { class: 'detail-meta' },
      el('h2', { class: 'detail-h2', text: title || '' }),
      el('div', { class: 'detail-sub', text: subParts.join(' · ') }),
    ),
  ));

  if (d.overview) {
    const ov = el('p', { class: 'detail-overview clamped', text: d.overview });
    body.appendChild(ov);
    const more = el('button', { class: 'overview-more', text: 'Lire la suite', onclick: () => {
      ov.classList.remove('clamped');
      more.remove();
    } });
    body.appendChild(more);
  }

  // --- actions + contenu spécifique ---
  if (type === 'tv') renderTvSection(body, d);
  else renderMovieSection(body, d);
}

// ---------- Détail série ----------
function renderTvSection(body, d) {
  const actions = el('div', { class: 'detail-actions' });
  const progressBox = el('div', { class: 'global-progress hidden' });
  const seasonList = el('div', { class: 'season-list' });
  body.appendChild(actions);
  body.appendChild(progressBox);
  body.appendChild(seasonList);

  // Boutons + barre de progression globale, mis à jour à chaque pointage
  // (sans reconstruire les saisons pour ne pas perdre le dépliage en cours)
  const redrawHeader = () => {
    const item = getItem('tv', d.id);

    actions.textContent = '';
    if (item) {
      actions.appendChild(el('button', { class: 'btn btn-danger btn-block', text: 'Retirer de ma liste', onclick: () => {
        if (confirm('Retirer « ' + item.title + ' » de votre liste ? Le suivi des épisodes sera perdu.')) {
          removeItem('tv', d.id);
          redrawAll();
          toast('Retiré de votre liste');
        }
      } }));
    } else {
      actions.appendChild(el('button', { class: 'btn btn-primary btn-block', text: '+ Ajouter à ma liste', onclick: () => {
        createItemFromDetail('tv', d);
        redrawHeader();
        toast('Ajouté à votre liste');
      } }));
    }

    progressBox.textContent = '';
    if (item) {
      const p = tvProgress(item);
      const pct = p.total ? Math.round((p.seen / p.total) * 100) : 0;
      progressBox.classList.remove('hidden');
      progressBox.appendChild(el('div', { class: 'global-progress-label', text: 'Progression : ' + p.seen + ' / ' + p.total + ' épisodes (' + pct + ' %)' }));
      progressBox.appendChild(el('div', { class: 'progress-wrap' },
        el('div', { class: 'progress-bar' },
          el('div', { class: 'progress-fill' + (pct >= 100 ? ' full' : ''), style: 'width:' + pct + '%' })),
      ));
    } else {
      progressBox.classList.add('hidden');
    }
  };

  const redrawAll = () => {
    redrawHeader();
    seasonList.textContent = '';
    const seasons = (d.seasons || [])
      .map(s => ({ n: s.season_number, name: s.name || ('Saison ' + s.season_number), count: s.episode_count || 0 }))
      .sort((a, b) => (a.n === 0 ? 1 : b.n === 0 ? -1 : a.n - b.n)); // spéciaux en dernier
    for (const s of seasons) {
      seasonList.appendChild(seasonRow(d, s, redrawHeader));
    }
    if (!seasons.length) {
      seasonList.appendChild(el('p', { class: 'center', text: 'Aucune saison répertoriée pour le moment.' }));
    }
  };

  redrawAll();
}

/** L'élément doit être dans la bibliothèque avant tout pointage ; l'y ajoute au besoin. */
function ensureTvItem(d) {
  let item = getItem('tv', d.id);
  if (!item) {
    item = createItemFromDetail('tv', d);
    toast('Ajouté à votre liste');
  }
  return item;
}

function getWatchedSet(item, seasonN) {
  return new Set(item.watched[seasonN] || []);
}

function setWatchedSet(item, seasonN, set) {
  if (set.size) item.watched[seasonN] = Array.from(set).sort((a, b) => a - b);
  else delete item.watched[seasonN];
  item.updatedAt = Date.now();
  saveLib();
}

function seasonRow(d, s, onChange) {
  const row = el('div', { class: 'season' });
  const item = () => getItem('tv', d.id);

  const checkbox = el('button', { class: 'checkbox', 'aria-label': 'Marquer « ' + s.name + ' » comme vue' });
  const countLabel = el('span', { class: 'season-count' });
  const chevron = el('span', { class: 'season-chevron', text: '›' });
  const episodesBox = el('div', { class: 'episodes hidden' });

  const displayCount = () => {
    // priorité : épisodes réellement diffusés (liste chargée), puis compteur « diffusés » mémorisé,
    // puis episode_count TMDB (qui peut inclure des épisodes futurs)
    const cached = seasonCache.get(d.id + ':' + s.n);
    if (cached) return cached.filter(e => !isFuture(e.date)).length;
    const it = item();
    const se = it && (it.seasons || []).find(x => x.n === s.n);
    if (se) return seasonTotal(se);
    return s.count;
  };

  const syncHead = () => {
    const it = item();
    const total = displayCount();
    const seen = Math.min(it ? seasonSeen(it, s.n) : 0, total);
    const done = total > 0 && seen >= total;
    countLabel.textContent = seen + '/' + total;
    checkbox.classList.toggle('checked', done);
    checkbox.classList.toggle('partial', seen > 0 && !done);
    checkbox.textContent = done ? '✓' : (seen > 0 ? '–' : '');
    checkbox.setAttribute('aria-pressed', done ? 'true' : 'false');
  };

  const syncEpisodes = () => {
    const it = item();
    const watched = it ? getWatchedSet(it, s.n) : new Set();
    $$('.episode', episodesBox).forEach(epBtn => {
      const n = Number(epBtn.dataset.n);
      const on = watched.has(n);
      epBtn.classList.toggle('watched', on);
      epBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const cb = $('.checkbox', epBtn);
      cb.classList.toggle('checked', on);
      cb.textContent = on ? '✓' : '';
    });
  };

  const syncAll = () => { syncHead(); syncEpisodes(); if (onChange) onChange(); };

  // --- cocher/décocher toute la saison ---
  checkbox.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const it = ensureTvItem(d);
    const total = displayCount();
    const currentlyDone = total > 0 && seasonSeen(it, s.n) >= total;

    if (currentlyDone) {
      setWatchedSet(it, s.n, new Set());
      syncAll();
      return;
    }

    // marquer tout vu : on utilise la vraie liste d'épisodes, en ignorant ceux non encore diffusés
    checkbox.textContent = '…';
    let eps = null;
    try {
      eps = await loadSeasonEpisodes(d.id, s.n);
    } catch (e) {
      // hors-ligne : on suppose des épisodes numérotés 1..count
      eps = null;
    }
    const numbers = eps
      ? eps.filter(e => !isFuture(e.date)).map(e => e.n)
      : Array.from({ length: s.count }, (_, i) => i + 1);
    if (eps && !numbers.length) {
      toast('Aucun épisode encore diffusé dans cette saison');
      syncAll();
      return;
    }
    setWatchedSet(it, s.n, new Set(numbers));
    if (eps && !episodesBox.classList.contains('hidden') && (episodesBox.childElementCount === 0 || episodesBox.dataset.failed)) {
      buildEpisodeList(eps);
      delete episodesBox.dataset.failed;
    }
    syncAll();
  });

  // --- déplier / replier les épisodes ---
  const expandBtn = el('button', { class: 'season-expand', 'aria-expanded': 'false', 'aria-label': 'Afficher les épisodes de ' + s.name },
    el('span', { class: 'season-name', text: s.name }), countLabel, chevron);
  const head = el('div', { class: 'season-head' }, checkbox, expandBtn);

  expandBtn.addEventListener('click', async () => {
    const isOpen = !episodesBox.classList.contains('hidden');
    if (isOpen) {
      episodesBox.classList.add('hidden');
      row.classList.remove('open');
      expandBtn.setAttribute('aria-expanded', 'false');
      ui.openSeasons.delete(s.n);
      return;
    }
    episodesBox.classList.remove('hidden');
    row.classList.add('open');
    expandBtn.setAttribute('aria-expanded', 'true');
    ui.openSeasons.add(s.n);
    // (re)charge si vide, ou si le dernier chargement réel avait échoué (liste générique hors-ligne)
    if (episodesBox.childElementCount === 0 || episodesBox.dataset.failed) {
      episodesBox.textContent = '';
      episodesBox.appendChild(el('div', { class: 'episodes-loading', text: 'Chargement des épisodes…' }));
      try {
        const eps = await loadSeasonEpisodes(d.id, s.n);
        delete episodesBox.dataset.failed;
        buildEpisodeList(eps);
        syncAll();
      } catch (err) {
        episodesBox.textContent = '';
        episodesBox.dataset.failed = '1';
        // hors-ligne : liste générique 1..count pour pouvoir quand même cocher
        if (s.count > 0) {
          const eps = Array.from({ length: s.count }, (_, i) => ({ n: i + 1, name: 'Épisode ' + (i + 1), date: '' }));
          buildEpisodeList(eps);
          syncAll();
          episodesBox.insertBefore(el('div', { class: 'episodes-loading', text: 'Hors ligne : titres indisponibles' }), episodesBox.firstChild);
        } else {
          episodesBox.appendChild(el('div', { class: 'episodes-loading', text: apiErrorMessage(err) }));
        }
      }
    }
  });

  function buildEpisodeList(eps) {
    episodesBox.textContent = '';
    for (const e of eps) {
      const cb = el('span', { class: 'checkbox' });
      const epBtn = el('button', { class: 'episode' + (isFuture(e.date) ? ' future' : ''), 'data-n': e.n, 'aria-pressed': 'false' },
        cb,
        el('div', { class: 'episode-info' },
          el('div', { class: 'episode-name', text: e.n + '. ' + e.name }),
          el('div', { class: 'episode-date', text: e.date ? fmtDate(e.date) : 'Date inconnue' }),
        ),
      );
      epBtn.addEventListener('click', () => {
        const it = ensureTvItem(d);
        const set = getWatchedSet(it, s.n);
        if (set.has(e.n)) set.delete(e.n); else set.add(e.n);
        setWatchedSet(it, s.n, set);
        syncAll();
      });
      episodesBox.appendChild(epBtn);
    }
  }

  row.appendChild(head);
  row.appendChild(episodesBox);
  syncHead();
  // rouvre la saison si elle était dépliée avant un re-rendu (arrivée des données réseau, etc.)
  if (ui.openSeasons.has(s.n)) expandBtn.click();
  return row;
}

// ---------- Détail film ----------
function renderMovieSection(body, d) {
  const actions = el('div', { class: 'detail-actions' });
  body.appendChild(actions);

  const redraw = () => {
    const item = getItem('movie', d.id);
    actions.textContent = '';

    const watchBtn = el('button', {
      class: 'btn btn-block ' + (item && item.watched ? 'btn-green' : 'btn-primary'),
      text: item && item.watched ? '✓ Vu' + (item.watchedAt ? ' le ' + dateFmt.format(new Date(item.watchedAt)) : '') : 'Marquer comme vu',
      onclick: () => {
        let it = getItem('movie', d.id);
        if (!it) { it = createItemFromDetail('movie', d); toast('Ajouté à votre liste'); }
        it.watched = !it.watched;
        it.watchedAt = it.watched ? Date.now() : null;
        it.updatedAt = Date.now();
        saveLib();
        redraw();
      },
    });
    actions.appendChild(watchBtn);

    if (item) {
      actions.appendChild(el('button', { class: 'btn btn-danger btn-block', text: 'Retirer de ma liste', onclick: () => {
        if (confirm('Retirer « ' + item.title + ' » de votre liste ?')) {
          removeItem('movie', d.id);
          redraw();
          toast('Retiré de votre liste');
        }
      } }));
    } else {
      actions.appendChild(el('button', { class: 'btn btn-ghost btn-block', text: '+ Ajouter à ma liste (à voir)', onclick: () => {
        createItemFromDetail('movie', d);
        redraw();
        toast('Ajouté à votre liste');
      } }));
    }
  };

  redraw();
}

// ------------------------------------------------------------
// Vue : Réglages
// ------------------------------------------------------------
function renderSettings() {
  const root = $('#settings-content');
  root.textContent = '';

  // --- clé API ---
  const keyInput = el('input', {
    class: 'text-input', type: 'text', value: getApiKey(),
    placeholder: 'Clé API TMDB',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false',
  });
  const keyStatus = el('div', { class: 'key-status' });

  const testBtn = el('button', { class: 'btn btn-primary', text: 'Enregistrer', onclick: async () => {
    const val = keyInput.value.trim();
    if (!val) {
      setApiKey('');
      keyStatus.className = 'key-status';
      keyStatus.textContent = 'Clé effacée.';
      return;
    }
    setApiKey(val);
    keyStatus.className = 'key-status';
    keyStatus.textContent = 'Vérification…';
    try {
      await api('/configuration');
      keyStatus.className = 'key-status ok';
      keyStatus.textContent = '✓ Clé valide — tout est prêt !';
    } catch (err) {
      keyStatus.className = 'key-status err';
      keyStatus.textContent = err.code === 'AUTH' ? '✗ Clé invalide.' : '✗ Vérification impossible (' + apiErrorMessage(err) + ')';
    }
  } });

  const desc = el('div', { class: 'settings-desc' });
  desc.appendChild(el('span', { text: 'La base de films/séries est fournie gratuitement par ' }));
  desc.appendChild(el('a', { href: 'https://www.themoviedb.org/', target: '_blank', rel: 'noopener', text: 'TMDB' }));
  desc.appendChild(el('span', { text: '. Pour l’utiliser :' }));
  const steps = el('ol', {},
    el('li', { text: 'Créez un compte gratuit sur themoviedb.org' }),
    el('li', {}, 'Ouvrez ', el('a', { href: 'https://www.themoviedb.org/settings/api', target: '_blank', rel: 'noopener', text: 'Paramètres → API' }), ' et demandez une clé (usage personnel « Developer »)'),
    el('li', { text: 'Copiez la « Clé d’API » (v3) ou le « Jeton d’accès en lecture » (v4) ci-dessous' }),
  );
  desc.appendChild(steps);

  root.appendChild(el('div', { class: 'settings-group' },
    el('h3', { text: 'Clé API TMDB' }),
    desc,
    el('div', { class: 'field-row' }, keyInput, testBtn),
    keyStatus,
  ));

  // --- sauvegarde ---
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data.items !== 'object' || data.items === null) throw new Error('format');
        const items = normalizeItems(data.items); // valide/répare chaque entrée
        const count = Object.keys(items).length;
        fileInput.value = '';
        if (!confirm('Remplacer votre liste actuelle par cette sauvegarde (' + count + ' élément(s)) ?')) return;
        lib = { version: 1, items };
        saveLib();
        renderSettings(); // rafraîchit les compteurs affichés
        toast('Sauvegarde restaurée (' + count + ' élément(s))');
      } catch (e) {
        fileInput.value = '';
        toast('Fichier de sauvegarde invalide');
      }
    };
    reader.readAsText(file);
  });

  const stats = Object.values(lib.items);
  const nbTv = stats.filter(i => i.type === 'tv').length;
  const nbMovie = stats.filter(i => i.type === 'movie').length;

  root.appendChild(el('div', { class: 'settings-group' },
    el('h3', { text: 'Sauvegarde' }),
    el('p', { class: 'settings-desc', text: 'Vos données (' + nbTv + ' série(s), ' + nbMovie + ' film(s)) sont stockées uniquement sur cet appareil. Pensez à exporter une sauvegarde de temps en temps.' }),
    el('div', { class: 'detail-actions' },
      el('button', { class: 'btn btn-ghost btn-block', text: '⬇︎ Exporter la sauvegarde', onclick: exportBackup }),
      el('button', { class: 'btn btn-ghost btn-block', text: '⬆︎ Restaurer une sauvegarde', onclick: () => fileInput.click() }),
    ),
    fileInput,
  ));

  // --- danger ---
  root.appendChild(el('div', { class: 'settings-group' },
    el('h3', { text: 'Réinitialisation' }),
    el('p', { class: 'settings-desc', text: 'Efface toute votre liste et votre suivi (la clé API est conservée).' }),
    el('button', { class: 'btn btn-danger btn-block', text: 'Tout effacer', onclick: () => {
      if (confirm('Vraiment tout effacer ? Cette action est définitive.')) {
        lib = { version: 1, items: {} };
        saveLib();
        renderSettings();
        toast('Liste effacée');
      }
    } }),
  ));

  root.appendChild(el('p', { class: 'settings-note', text: 'CinéTrack v' + APP_VERSION + ' — Ce produit utilise l’API TMDB sans être approuvé ni certifié par TMDB.' }));
}

async function exportBackup() {
  const payload = JSON.stringify({ app: 'cinetrack', version: 1, exportedAt: new Date().toISOString(), items: lib.items }, null, 2);

  // 1) Feuille de partage (fiable sur iOS, y compris en mode installé) : « Enregistrer dans Fichiers », AirDrop…
  try {
    const file = new File([payload], 'cinetrack-sauvegarde.json', { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sauvegarde CinéTrack' });
      toast('Sauvegarde exportée');
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // l'utilisateur a annulé la feuille de partage
    // sinon on tente les solutions de repli ci-dessous
  }

  // 2) Téléchargement direct (navigateurs de bureau)
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'cinetrack-sauvegarde.json' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  // 3) Presse-papier en complément, avec un message honnête sur ce qui a vraiment eu lieu
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(payload)
      .then(() => toast('Téléchargement lancé — sauvegarde aussi copiée dans le presse-papier'))
      .catch(() => toast('Téléchargement lancé'));
  } else {
    toast('Téléchargement lancé');
  }
}

// ------------------------------------------------------------
// Hors-ligne
// ------------------------------------------------------------
function updateOnlineStatus() {
  $('#offline-banner').classList.toggle('hidden', navigator.onLine);
}

// ------------------------------------------------------------
// Initialisation
// ------------------------------------------------------------
function init() {
  // onglets
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // bibliothèque : segments + filtres
  $$('.seg-btn').forEach(b => b.addEventListener('click', () => {
    ui.libType = b.dataset.type;
    $$('.seg-btn').forEach(x => {
      const active = x === b;
      x.classList.toggle('active', active);
      x.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    updateChipLabels(); // « En cours/Terminées » pour les séries, « À voir/Vus » pour les films
    renderLibrary();
  }));
  updateChipLabels();
  $$('#lib-chips .chip').forEach(c => c.addEventListener('click', () => {
    ui.libStatus = c.dataset.status;
    $$('#lib-chips .chip').forEach(x => x.classList.toggle('active', x === c));
    renderLibrary();
  }));
  $('#lib-empty-search').addEventListener('click', () => switchTab('search'));

  // recherche
  const input = $('#search-input');
  const debouncedSearch = debounce(() => runSearch(input.value), 400);
  input.addEventListener('input', debouncedSearch);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); runSearch(input.value); }
  });
  $('#search-clear').addEventListener('click', () => {
    input.value = '';
    runSearch('');
    input.focus();
  });

  // fiche détail
  $('#detail-back').addEventListener('click', () => history.back());
  $('#detail-refresh').addEventListener('click', async () => {
    if (!ui.detail) return;
    const { type, id } = ui.detail;
    const btn = $('#detail-refresh');
    btn.classList.add('spinning');
    try {
      const data = await api('/' + type + '/' + id);
      if (!ui.detail || ui.detail.type !== type || ui.detail.id !== id) return;
      if (type === 'tv') {
        // vide le cache des saisons de cette série pour recharger les épisodes
        for (const k of Array.from(seasonCache.keys())) {
          if (k.startsWith(id + ':')) seasonCache.delete(k);
        }
      }
      ui.detail.data = data;
      const item = getItem(type, id);
      if (item) refreshItemFromDetail(item, data);
      renderDetail(type, data);
      toast('Fiche actualisée');
    } catch (err) {
      toast(apiErrorMessage(err));
    } finally {
      btn.classList.remove('spinning');
    }
  });

  // le geste "retour" (ou le bouton ‹) ferme la fiche
  window.addEventListener('popstate', () => {
    if (ui.detail) closeDetailPanel();
  });

  // hors-ligne
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // conseil d'installation sur iPhone : le stockage de Safari et celui de l'app installée
  // sont séparés sur iOS — mieux vaut installer AVANT de saisir clé et suivi
  const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone = navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  let installTipHidden = false;
  try { installTipHidden = localStorage.getItem('cinetrack.installtip') === 'off'; } catch (e) { /* stockage indisponible */ }
  if (isIos && !isStandalone && !installTipHidden) {
    $('#install-banner').classList.remove('hidden');
  }
  $('#install-banner-close').addEventListener('click', () => {
    $('#install-banner').classList.add('hidden');
    try { localStorage.setItem('cinetrack.installtip', 'off'); } catch (e) { /* tant pis, la bannière reviendra */ }
  });

  // premier lancement : pas de clé → accueil sur les réglages
  if (!getApiKey()) {
    switchTab('settings');
    toast('Bienvenue ! Configurez votre clé TMDB gratuite.');
  } else {
    switchTab('library');
  }

  // service worker (mode hors-ligne + installation)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* http local : pas bloquant */ });
  }
}

document.addEventListener('DOMContentLoaded', init);
