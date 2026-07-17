/* ============================================================
   CinéTrack — application de suivi de séries & films
   Données séries : TVmaze (api.tvmaze.com) — aucune clé nécessaire
   Données films  : OMDb (omdbapi.com) — clé gratuite par e-mail
   Stockage : localStorage (sur l'appareil uniquement)
   ============================================================ */
'use strict';

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------
const APP_VERSION = '2.0.0';
const TVMAZE_BASE = 'https://api.tvmaze.com';
const OMDB_BASE = 'https://www.omdbapi.com/';
const LS_LIB = 'cinetrack.library.v2'; // v1 = ancienne version TMDB (identifiants incompatibles)
const LS_KEY = 'cinetrack.omdbkey';

// Statuts de série TVmaze → français
const STATUS_FR = {
  'Running': 'En cours de diffusion',
  'Ended': 'Terminée',
  'To Be Determined': 'Renouvellement incertain',
  'In Development': 'En préparation',
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

/** Convertit le HTML (résumés TVmaze) en texte brut, sans exécuter quoi que ce soit. */
function stripHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').trim();
}

function posterEl(url, big) {
  if (url) {
    return el('img', { class: big ? 'detail-poster' : 'poster', src: url, alt: '', loading: 'lazy' });
  }
  return el('div', { class: big ? 'detail-poster poster-fallback' : 'poster-fallback', text: '🎬' });
}

// ------------------------------------------------------------
// Stockage : clé OMDb (films) + bibliothèque
// ------------------------------------------------------------
function getOmdbKey() {
  try { return (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) { return ''; }
}
function setOmdbKey(key) {
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
    // séries : id numérique TVmaze ; films : id IMDb ("tt…"), une chaîne
    const cleanId = type === 'tv' ? Number(raw.id) : String(raw.id || '');
    if (!type || (type === 'tv' && !Number.isFinite(cleanId)) || (type === 'movie' && !cleanId)) continue;
    const item = {
      type,
      id: cleanId,
      title: typeof raw.title === 'string' ? raw.title : '',
      poster: typeof raw.poster === 'string' ? raw.poster : null,
      year: typeof raw.year === 'string' ? raw.year : '',
      docu: !!raw.docu,
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
    items[type + ':' + cleanId] = item;
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

/** Total d'épisodes comptabilisés pour une saison : épisodes déjà diffusés si connus, sinon compteur brut. */
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
// APIs : TVmaze (séries, sans clé) et OMDb (films, clé gratuite)
// ------------------------------------------------------------
class ApiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function tvmaze(path) {
  let res;
  try {
    res = await fetch(TVMAZE_BASE + path, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ApiError('NETWORK');
  }
  if (res.status === 404) throw new ApiError('NOT_FOUND');
  if (res.status === 429) throw new ApiError('RATE_LIMIT');
  if (!res.ok) throw new ApiError('HTTP_' + res.status);
  return res.json();
}

/** OMDb renvoie toujours du JSON ; un échec applicatif est signalé par Response:"False". */
async function omdb(params) {
  const key = getOmdbKey();
  if (!key) throw new ApiError('NO_KEY');
  const url = new URL(OMDB_BASE);
  url.searchParams.set('apikey', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ApiError('NETWORK');
  }
  if (res.status === 401) throw new ApiError('AUTH');
  if (res.status === 429) throw new ApiError('RATE_LIMIT');
  if (!res.ok && res.status !== 200) throw new ApiError('HTTP_' + res.status);
  const data = await res.json();
  if (data && data.Response === 'False' && /api key/i.test(data.Error || '')) throw new ApiError('AUTH');
  return data; // « Movie not found! » etc. : à interpréter par l'appelant
}

function apiErrorMessage(err) {
  switch (err && err.code) {
    case 'NO_KEY': return 'Aucune clé OMDb configurée pour les films. Ajoutez-la dans Réglages.';
    case 'AUTH': return 'Clé OMDb invalide. Vérifiez-la dans Réglages.';
    case 'NETWORK': return 'Pas de connexion internet.';
    case 'NOT_FOUND': return 'Fiche introuvable (peut-être supprimée de la base).';
    case 'RATE_LIMIT': return 'Trop de requêtes : patientez quelques secondes puis réessayez.';
    default: return 'Erreur de la source de données (' + (err && err.code || 'inconnue') + '). Réessayez.';
  }
}

// ------------------------------------------------------------
// Fiches normalisées (même forme quelle que soit la source)
//  tv    : { id, title, poster, year, status, genres, overview, seasons:[{n,name,count,aired}] }
//  movie : { id, title, poster, year, runtime, genres, overview }
// ------------------------------------------------------------

// Cache mémoire : tous les épisodes d'une série en un appel TVmaze
const showEpisodesCache = new Map(); // tvId -> { bySeason: Map(n -> [{n,name,date}]), seasons: [...] }

async function loadShowEpisodes(tvId) {
  if (showEpisodesCache.has(tvId)) return showEpisodesCache.get(tvId);
  const list = await tvmaze('/shows/' + tvId + '/episodes'); // épisodes « spéciaux » exclus par défaut
  const bySeason = new Map();
  for (const e of list) {
    if (e.number == null) continue;
    if (!bySeason.has(e.season)) bySeason.set(e.season, []);
    bySeason.get(e.season).push({
      n: e.number,
      name: e.name || ('Épisode ' + e.number),
      date: e.airdate || '',
    });
  }
  const seasons = Array.from(bySeason.entries())
    .map(([n, eps]) => ({
      n,
      name: 'Saison ' + n,
      count: eps.length,
      aired: eps.filter(e => !isFuture(e.date)).length,
    }))
    .sort((a, b) => a.n - b.n);
  const data = { bySeason, seasons };
  showEpisodesCache.set(tvId, data);
  // synchronise l'élément suivi avec la réalité (nouvelles saisons, nouveaux épisodes diffusés)
  const item = getItem('tv', tvId);
  if (item) {
    item.seasons = seasons.map(s => ({ n: s.n, name: s.name, count: s.count, aired: s.aired }));
    saveLib();
  }
  return data;
}

async function loadSeasonEpisodes(tvId, n) {
  const data = await loadShowEpisodes(tvId);
  return data.bySeason.get(n) || [];
}

async function fetchTvDetail(id) {
  const show = await tvmaze('/shows/' + id);
  const eps = await loadShowEpisodes(id);
  return {
    id: show.id,
    title: show.name || '',
    poster: show.image ? (show.image.medium || show.image.original || null) : null,
    year: yearOf(show.premiered),
    status: show.status || '',
    genres: (show.genres || []).join(', '),
    overview: stripHtml(show.summary),
    docu: show.type === 'Documentary',
    seasons: eps.seasons.map(s => ({ n: s.n, name: s.name, count: s.count, aired: s.aired })),
  };
}

async function fetchMovieDetail(id) {
  const m = await omdb({ i: id, plot: 'full' });
  if (!m || m.Response === 'False') throw new ApiError('NOT_FOUND');
  const clean = (v) => (v && v !== 'N/A' ? v : '');
  return {
    id: m.imdbID || id,
    title: clean(m.Title),
    poster: clean(m.Poster) || null,
    year: clean(m.Year).slice(0, 4),
    runtime: clean(m.Runtime),
    genres: clean(m.Genre),
    overview: clean(m.Plot),
    docu: /documentary/i.test(clean(m.Genre)),
  };
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
    if (item.docu) sub.appendChild(el('span', { class: 'badge', text: 'Docu' }));
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
    if (item.docu) sub.appendChild(el('span', { class: 'badge', text: 'Docu' }));
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

async function runSearch(query, moviePage) {
  const status = $('#search-status');
  const results = $('#search-results');
  const token = ++lastSearchToken;
  const append = (moviePage || 1) > 1; // « Plus de films » : on ajoute à la liste existante

  query = query.trim();
  $('#search-clear').classList.toggle('hidden', !query);

  if (!query) {
    status.textContent = '';
    results.textContent = '';
    return;
  }

  const oldMore = $('#search-more');
  if (oldMore) oldMore.remove();
  if (!append) status.textContent = 'Recherche…';

  // Séries (TVmaze, sans clé) et films (OMDb, si clé) interrogés en parallèle ;
  // l'échec de l'un ne bloque pas l'autre.
  const wantMovies = !!getOmdbKey();
  const tvPromise = append
    ? Promise.resolve(null)
    : tvmaze('/search/shows?q=' + encodeURIComponent(query)).catch(err => ({ apiError: err }));
  const moviePromise = wantMovies
    ? omdb({ s: query, type: 'movie', page: String(moviePage || 1) }).catch(err => ({ apiError: err }))
    : Promise.resolve(null);

  const [tvRes, movieRes] = await Promise.all([tvPromise, moviePromise]);
  if (token !== lastSearchToken) return; // une recherche plus récente est en cours

  if (!append) results.textContent = '';
  status.textContent = '';
  const errors = [];

  // --- séries ---
  if (tvRes) {
    if (tvRes.apiError) {
      errors.push('Séries : ' + apiErrorMessage(tvRes.apiError));
    } else if (Array.isArray(tvRes)) {
      for (const hit of tvRes) {
        const show = hit && hit.show;
        if (!show) continue;
        results.appendChild(searchCard({
          type: 'tv',
          id: show.id,
          title: show.name || '',
          year: yearOf(show.premiered),
          poster: show.image ? show.image.medium : null,
          docu: show.type === 'Documentary',
        }));
      }
    }
  }

  // --- films ---
  if (movieRes) {
    if (movieRes.apiError) {
      errors.push('Films : ' + apiErrorMessage(movieRes.apiError));
    } else if (movieRes.Response === 'True' && Array.isArray(movieRes.Search)) {
      for (const m of movieRes.Search) {
        results.appendChild(searchCard({
          type: 'movie',
          id: m.imdbID,
          title: m.Title || '',
          year: (m.Year || '').slice(0, 4),
          poster: m.Poster && m.Poster !== 'N/A' ? m.Poster : null,
        }));
      }
      const total = Number(movieRes.totalResults) || 0;
      const page = moviePage || 1;
      if (page * 10 < total) {
        results.appendChild(el('button', {
          id: 'search-more', class: 'btn btn-ghost btn-block', text: 'Plus de films',
          onclick: () => runSearch(query, page + 1),
        }));
      }
    }
    // Response:"False" (« Movie not found! », « Too many results. ») : simplement aucun film
  } else if (!wantMovies && !append) {
    const hint = el('div', { class: 'search-status' });
    hint.appendChild(el('span', { text: 'Films non inclus — ajoutez une clé OMDb gratuite dans ' }));
    hint.appendChild(el('button', { class: 'linklike', text: 'Réglages', onclick: () => switchTab('settings') }));
    hint.appendChild(el('span', { text: '.' }));
    results.appendChild(hint);
  }

  if (errors.length) status.textContent = errors.join(' — ');
  if (!results.querySelector('.card') && !errors.length) {
    status.textContent = 'Aucun résultat pour « ' + query + ' ».';
  }
}

/** r : { type:'tv'|'movie', id, title, year, poster } */
function searchCard(r) {
  const inLib = !!getItem(r.type, r.id);

  const addBtn = el('button', {
    class: 'card-add' + (inLib ? ' added' : ''),
    text: inLib ? '✓' : '+',
    'data-key': r.type + ':' + r.id,
    'aria-label': inLib ? 'Déjà dans ma liste' : 'Ajouter à ma liste',
    onclick: (ev) => {
      ev.stopPropagation();
      quickAdd(r, addBtn);
    },
  });

  const sub = el('div', { class: 'card-sub' },
    el('span', { class: 'badge', text: r.type === 'tv' ? 'Série' : 'Film' }),
    r.docu ? el('span', { class: 'badge', text: 'Docu' }) : null,
    r.year ? el('span', { text: r.year }) : null,
  );

  return el('div', { class: 'card', role: 'button', tabindex: '0',
    onclick: () => openDetail(r.type, r.id),
    onkeydown: (ev) => {
      // seule la carte elle-même réagit à Entrée (pas le bouton « + » qui a son propre clic)
      if (ev.key === 'Enter' && ev.target === ev.currentTarget && !ev.repeat) openDetail(r.type, r.id);
    } },
    posterEl(r.poster),
    el('div', { class: 'card-info' }, el('p', { class: 'card-title', text: r.title }), sub),
    addBtn,
  );
}

async function quickAdd(r, btn) {
  if (getItem(r.type, r.id)) {
    refreshSearchAddButtons();
    toast('Déjà dans votre liste');
    return;
  }
  btn.textContent = '…';
  try {
    const data = r.type === 'tv' ? await fetchTvDetail(r.id) : await fetchMovieDetail(r.id);
    createItemFromDetail(r.type, data);
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
/** d : fiche normalisée (voir plus haut). */
function createItemFromDetail(type, d) {
  const item = type === 'tv' ? {
    type: 'tv',
    id: d.id,
    title: d.title || '',
    poster: d.poster || null,
    year: d.year || '',
    status: d.status || '',
    docu: !!d.docu,
    seasons: (d.seasons || []).map(s => ({ n: s.n, name: s.name, count: s.count, aired: s.aired })),
    watched: {},
    addedAt: Date.now(),
    updatedAt: Date.now(),
  } : {
    type: 'movie',
    id: d.id,
    title: d.title || '',
    poster: d.poster || null,
    year: d.year || '',
    docu: !!d.docu,
    watched: false,
    addedAt: Date.now(),
    updatedAt: Date.now(),
  };
  lib.items[libKey(type, d.id)] = item;
  saveLib();
  return item;
}

/** Met à jour les métadonnées d'un élément existant (garde le suivi "vu"). */
function refreshItemFromDetail(item, d) {
  item.title = d.title || item.title;
  item.poster = d.poster || item.poster;
  item.year = d.year || item.year;
  item.docu = !!d.docu;
  if (item.type === 'tv') {
    item.status = d.status || item.status;
    item.seasons = (d.seasons || []).map(s => ({ n: s.n, name: s.name, count: s.count, aired: s.aired }));
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

  // puis actualisation depuis la source (nouvelles saisons, épisodes, résumé…)
  try {
    const data = type === 'tv' ? await fetchTvDetail(id) : await fetchMovieDetail(id);
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

/** Affichage à partir des seules données locales (hors-ligne) : l'élément a déjà la forme normalisée. */
function renderDetailFromItem(item) {
  renderDetail(item.type, {
    id: item.id,
    title: item.title,
    poster: item.poster,
    year: item.year,
    status: item.status || '',
    runtime: '',
    genres: '',
    overview: '',
    seasons: (item.seasons || []).map(s => ({ n: s.n, name: s.name, count: s.count, aired: s.aired })),
  });
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
  $('#detail-title').textContent = d.title || '';

  // --- entête ---
  const subParts = [];
  if (d.year) subParts.push(d.year);
  if (type === 'tv' && d.status) subParts.push(STATUS_FR[d.status] || d.status);
  if (type === 'movie' && d.runtime) subParts.push(d.runtime);
  if (d.genres) subParts.push(d.genres);

  body.appendChild(el('div', { class: 'detail-hero' },
    posterEl(d.poster, true),
    el('div', { class: 'detail-meta' },
      el('h2', { class: 'detail-h2', text: d.title || '' }),
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
      .slice()
      .sort((a, b) => (a.n === 0 ? 1 : b.n === 0 ? -1 : a.n - b.n)); // spéciaux (rares) en dernier
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
    // priorité : épisodes réellement diffusés (liste chargée), puis compteur « diffusés » mémorisé
    const cached = showEpisodesCache.get(d.id);
    const eps = cached && cached.bySeason.get(s.n);
    if (eps) return eps.filter(e => !isFuture(e.date)).length;
    const it = item();
    const se = it && (it.seasons || []).find(x => x.n === s.n);
    if (se) return seasonTotal(se);
    return seasonTotal(s);
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

  // --- clé OMDb (films uniquement) ---
  const keyInput = el('input', {
    class: 'text-input', type: 'text', value: getOmdbKey(),
    placeholder: 'Clé OMDb (ex. a1b2c3d4)',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false',
  });
  const keyStatus = el('div', { class: 'key-status' });

  const testBtn = el('button', { class: 'btn btn-primary', text: 'Enregistrer', onclick: async () => {
    const val = keyInput.value.trim();
    if (!val) {
      setOmdbKey('');
      keyStatus.className = 'key-status';
      keyStatus.textContent = 'Clé effacée (les séries continuent de fonctionner).';
      return;
    }
    setOmdbKey(val);
    keyStatus.className = 'key-status';
    keyStatus.textContent = 'Vérification…';
    try {
      const data = await omdb({ i: 'tt0111161' }); // fiche connue, juste pour valider la clé
      if (!data || data.Response !== 'True') throw new ApiError('AUTH');
      keyStatus.className = 'key-status ok';
      keyStatus.textContent = '✓ Clé valide — la recherche de films est active !';
    } catch (err) {
      keyStatus.className = 'key-status err';
      keyStatus.textContent = err.code === 'AUTH' ? '✗ Clé invalide (avez-vous cliqué le lien d’activation reçu par e-mail ?).' : '✗ Vérification impossible (' + apiErrorMessage(err) + ')';
    }
  } });

  const desc = el('div', { class: 'settings-desc' });
  desc.appendChild(el('span', { text: 'Les séries utilisent TVmaze : aucune clé nécessaire. Pour rechercher aussi des films, ajoutez une clé OMDb gratuite (30 secondes, sans justification) :' }));
  const steps = el('ol', {},
    el('li', {}, 'Ouvrez ', el('a', { href: 'https://www.omdbapi.com/apikey.aspx', target: '_blank', rel: 'noopener', text: 'omdbapi.com/apikey.aspx' })),
    el('li', { text: 'Choisissez « FREE » et entrez votre adresse e-mail' }),
    el('li', { text: 'Cliquez le lien d’activation reçu par e-mail, puis collez la clé ci-dessous' }),
  );
  desc.appendChild(steps);

  root.appendChild(el('div', { class: 'settings-group' },
    el('h3', { text: 'Clé OMDb (pour les films)' }),
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

  root.appendChild(el('p', { class: 'settings-note', text: 'CinéTrack v' + APP_VERSION + ' — Données séries : TVmaze.com · Données films : OMDb (omdbapi.com).' }));
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
      if (type === 'tv') showEpisodesCache.delete(id); // force le rechargement des épisodes
      const data = type === 'tv' ? await fetchTvDetail(id) : await fetchMovieDetail(id);
      if (!ui.detail || ui.detail.type !== type || ui.detail.id !== id) return;
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

  // les séries fonctionnent sans aucune clé : on démarre directement sur la liste
  switchTab('library');

  // service worker (mode hors-ligne + installation)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* http local : pas bloquant */ });
  }
}

document.addEventListener('DOMContentLoaded', init);
