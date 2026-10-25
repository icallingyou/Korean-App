/* =============================================================
   Library Reading Planner — 앱 로직
   - 데이터: localStorage (이 브라우저에만 저장)
   - 책 정보: Open Library 공개 API
   - 도서관 계정 동기화: 크롬 확장(window.postMessage 브리지) 또는 붙여넣기
   ============================================================= */
'use strict';

(() => {

const LS_KEY = 'qpl-planner.v1';
const DEFAULT_QPL_URL = 'https://www.queenslibrary.org/search?query={q}';
const EXT_GUIDE_URL = 'https://github.com/icallingyou/Korean-App/blob/claude/korean-learning-app-ds2o4p/reading-planner/extension/README.md';
const SYNC_MSG = 'LRP_SYNC';          // 확장 → 페이지
const SYNC_REQ = 'LRP_SYNC_REQUEST';  // 페이지 → 확장
const GENERIC_SUBJECT = /^(fiction|accessible book|protected daisy|in library|large type books|long now manual for civilization|open library staff picks|new york times bestseller|reading level[- ]grade.*|juvenile fiction|general|literature|english|novels?|ficci[oó]n|romans?|nouvelles|lending library|overdrive|internet archive wishlist|popular print disabled books|translations? into .*|history and criticism|adult|nyt:.*|award:.*|collectionid:.*|children's fiction|fiction, general|fiction, .*|literary|literary fiction)$/i;

// ---------------------------------------------------------------
// 상태
// ---------------------------------------------------------------
const DEFAULTS = () => ({
  books: [],
  settings: { lang: '', capacity: 60, bufferDays: 1, loanDays: 21, qplSearchUrl: '', qplSearchUrlAuto: '' },
  sync: { at: null, count: 0, sourceUrl: '' },
  recs: { date: '', items: [] }
});
let state = load();
function load() {
  const d = DEFAULTS();
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && typeof s === 'object') {
      d.books = Array.isArray(s.books) ? s.books : [];
      Object.assign(d.settings, s.settings || {});
      Object.assign(d.sync, s.sync || {});
      Object.assign(d.recs, s.recs || {});
    }
  } catch (_) { /* 손상된 데이터는 무시 */ }
  return d;
}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) { /* quota */ } }

const ui = { view: 'today', shelfFilter: 'reading', calSel: null, q: '', searchResults: null, searching: false, recsLoading: false, recsError: false };

// ---------------------------------------------------------------
// i18n / 헬퍼
// ---------------------------------------------------------------
function lang() {
  if (state.settings.lang) return state.settings.lang;
  return (navigator.language || 'en').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
function t(key, vars) {
  const table = window.I18N[lang()] || window.I18N.en;
  let s = table[key] ?? window.I18N.en[key] ?? key;
  if (typeof s !== 'string') return s;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
function applyStaticI18n() {
  document.documentElement.lang = lang();
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
}

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function titleMatch(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 4 && l.startsWith(s);
}
const today = () => Planner.todayISO();
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const opts = { month: 'short', day: 'numeric' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Intl.DateTimeFormat(lang() === 'ko' ? 'ko-KR' : 'en-US', opts).format(new Date(y, m - 1, d));
}
function fmtRel(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return t('just_now');
  const rtf = new Intl.RelativeTimeFormat(lang() === 'ko' ? 'ko' : 'en', { numeric: 'auto' });
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}
function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
function coverHtml(b, cls = '') {
  return b.coverUrl
    ? `<img class="cover ${cls}" src="${esc(b.coverUrl)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;cover ph ${cls}&quot;>${esc((b.title || '?').trim()[0] || '?')}</div>'">`
    : `<div class="cover ph ${cls}">${esc((b.title || '?').trim()[0] || '?')}</div>`;
}
function qplTemplate() { return state.settings.qplSearchUrl || state.settings.qplSearchUrlAuto || DEFAULT_QPL_URL; }
function qplLink(title) { const tpl = qplTemplate(); return tpl.includes('{q}') ? tpl.replace('{q}', encodeURIComponent(title)) : tpl; }
function plan() { return Planner.buildPlan(state.books, { bufferDays: state.settings.bufferDays, capacity: state.settings.capacity }); }
const bookById = id => state.books.find(b => b.id === id);

const ICON = {
  speaker: '',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M11 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

// ---------------------------------------------------------------
// 책 데이터 조작
// ---------------------------------------------------------------
function addBook(data) {
  const b = Object.assign({
    id: uid(), title: '', author: '', pages: null, currentPage: 0, due: null, status: 'reading',
    coverUrl: '', olKey: '', subjects: [], rating: null, source: 'manual', addedAt: Date.now(), log: []
  }, data);
  b.title = String(b.title || '').trim();
  state.books.unshift(b);
  save();
  return b;
}
function removeBook(id) { state.books = state.books.filter(b => b.id !== id); save(); }
function setProgress(b, page) {
  const pages = Number(b.pages) || 0;
  let p = Math.max(0, Math.round(Number(page) || 0));
  if (pages) p = Math.min(p, pages);
  b.currentPage = p;
  b.log = (b.log || []).filter(l => l.date !== today());
  b.log.push({ date: today(), page: p });
  if (pages && p >= pages) { b.status = 'done'; b.finishedAt = today(); }
  save();
}
function markDone(b) { b.status = 'done'; if (b.pages) b.currentPage = b.pages; b.finishedAt = today(); save(); }

/** Open Library에서 페이지 수·표지·주제 보강 */
async function enrich(b) {
  if (!navigator.onLine) return false;
  try {
    const hit = await OL.lookup(b.title, b.author);
    if (!hit) return false;
    let changed = false;
    if (!b.pages && hit.pages) { b.pages = hit.pages; changed = true; }
    if (!b.coverUrl && hit.coverUrl) { b.coverUrl = hit.coverUrl; changed = true; }
    if (!b.olKey && hit.olKey) { b.olKey = hit.olKey; changed = true; }
    if (!(b.subjects || []).length && hit.subjects.length) { b.subjects = hit.subjects; changed = true; }
    if (!b.author && hit.author) { b.author = hit.author; changed = true; }
    if (changed) save();
    return changed;
  } catch (_) { return false; }
}
let enriching = false;
async function enrichMissing() {
  if (enriching) return;
  enriching = true;
  try {
    const todo = state.books.filter(b => !b.enrichedAt && (!b.pages || !b.coverUrl || !(b.subjects || []).length));
    for (const b of todo) {
      const changed = await enrich(b);
      b.enrichedAt = Date.now(); save();
      if (changed) render();
    }
  } finally { enriching = false; }
}

// ---------------------------------------------------------------
// 도서관 동기화 / 가져오기
// ---------------------------------------------------------------
function mergeItems(items, source) {
  let added = 0, updated = 0;
  for (const it of items || []) {
    if (!it || !it.title) continue;
    const ex = state.books.find(b => titleMatch(b.title, it.title));
    if (ex) {
      let ch = false;
      if (it.due && ex.due !== it.due) { ex.due = it.due; ch = true; }
      if (ex.status === 'queued') { ex.status = 'reading'; ch = true; }
      if (!ex.author && it.author) { ex.author = it.author; ch = true; }
      if (source === 'library') ex.source = 'library';
      if (ch) updated++;
    } else {
      addBook({ title: it.title, author: it.author || '', due: it.due || null, status: 'reading', source });
      added++;
    }
  }
  save();
  return { added, updated };
}
function applySync(payload) {
  if (!payload || typeof payload !== 'object') return;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const r = mergeItems(items, 'library');
  if (typeof payload.searchTemplate === 'string' && payload.searchTemplate.includes('{q}')) state.settings.qplSearchUrlAuto = payload.searchTemplate;
  if (items.length) state.sync = { at: Number(payload.syncedAt) || Date.now(), count: items.length, sourceUrl: String(payload.sourceUrl || '') };
  save();
  render();
  if (r.added || r.updated) { toast(t('toast_synced', { n: items.length })); enrichMissing(); }
}
window.addEventListener('message', e => {
  if (e.source !== window || !e.data || e.data.type !== SYNC_MSG) return;
  applySync(e.data.payload);
});

// ---------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------
const views = { today: $('#view-today'), shelf: $('#view-shelf'), discover: $('#view-discover'), settings: $('#view-settings') };
function setView(name) {
  ui.view = name;
  document.querySelectorAll('.tab').forEach(tb => {
    const on = tb.dataset.view === name;
    tb.classList.toggle('is-active', on);
    tb.setAttribute('aria-selected', on);
  });
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  render();
}
document.querySelectorAll('.tab').forEach(tb => tb.addEventListener('click', () => setView(tb.dataset.view)));
function render() {
  applyStaticI18n();
  if (ui.view === 'today') renderToday();
  else if (ui.view === 'shelf') renderShelf();
  else if (ui.view === 'discover') renderDiscover();
  else renderSettings();
}

// ---------------------------------------------------------------
// 오늘
// ---------------------------------------------------------------
function dueText(it) {
  if (it.dueIn === null || it.dueIn === undefined) return t('no_due');
  if (it.dueIn < 0) return t('overdue_by', { n: -it.dueIn });
  if (it.dueIn === 0) return t('due_today');
  if (it.dueIn === 1) return t('due_tomorrow') + ' · ' + fmtDate(it.due);
  return t('due_in', { n: it.dueIn }) + ' · ' + fmtDate(it.due);
}
function statusBadge(st) {
  const cls = { ok: 'ok', tight: 'tight', overdue: 'overdue', done: 'done', nodue: '', nopages: '' }[st] || '';
  return `<span class="badge ${cls}">${esc(t('st_' + st))}</span>`;
}
function suggestionHtml(s) {
  const b = s.bookId ? bookById(s.bookId) : null;
  const title = b ? b.title : '';
  const map = {
    over_capacity: ['', t('sug_over_capacity', { total: s.totalToday, cap: s.capacity, title })],
    overdue: ['danger', t('sug_overdue', { title })],
    set_pages: ['info', t('sug_set_pages', { title })],
    set_due: ['info', t('sug_set_due', { title })],
    mark_done: ['info', t('sug_mark_done', { title })]
  };
  const [cls, text] = map[s.type] || ['', ''];
  if (!text) return '';
  const action = (s.type === 'set_pages' || s.type === 'set_due') && b ? `<button class="link-btn" data-edit="${b.id}">${esc(t('btn_edit'))}</button>` :
    s.type === 'mark_done' && b ? `<button class="link-btn" data-finish="${b.id}">${esc(t('btn_finish'))}</button>` : '';
  return `<div class="sug ${cls}"><span>${esc(text)}</span>${action}</div>`;
}
function taskCard(it) {
  const b = it.book;
  const scheduled = it.status === 'ok' || it.status === 'tight' || it.status === 'overdue';
  let goal;
  if (scheduled && it.perDay > 0) goal = `<p class="goal">${esc(t('read_pages', { from: it.currentPage + 1, to: it.currentPage + it.perDay, n: it.perDay }))}</p>`;
  else if (it.status === 'nopages') goal = `<p class="goal soft">${esc(t('no_pages'))}</p>`;
  else if (it.status === 'nodue') goal = `<p class="goal soft">${esc(t('no_due'))}</p>`;
  else if (it.status === 'done') goal = `<p class="goal">${esc(t('st_done'))} 🎉</p>`;
  else goal = '';
  const prog = it.pages ? `
    <div class="prog-line">
      <div class="pbar"><i style="width:${it.progressPct}%"></i></div>
      <span>${esc(t('progress', { cur: it.currentPage, total: it.pages }))}</span>
    </div>` : '';
  return `
    <article class="task st-${it.status}" data-id="${b.id}">
      ${coverHtml(b)}
      <div class="task-main">
        <div class="task-top">${statusBadge(it.status)}<span>${esc(dueText(it))}</span>${b.source === 'library' ? `<span class="badge library">${esc(t('from_library'))}</span>` : ''}</div>
        <h3>${esc(b.title)}</h3>
        <p class="author">${esc(b.author || t('unknown_author'))}</p>
        ${goal}
        ${prog}
        <div class="task-actions">
          ${scheduled && it.perDay > 0 ? `<button class="btn small primary" data-act="done-today" data-id="${b.id}">${ICON.check} ${esc(t('btn_done_today'))}</button>` : ''}
          ${it.pages ? `<button class="btn small" data-act="set-page" data-id="${b.id}">${esc(t('btn_set_page'))}</button>` : ''}
          <button class="btn small" data-act="edit" data-id="${b.id}">${esc(t('btn_change_due'))}</button>
          ${it.status !== 'done' ? `<button class="btn small ghost" data-act="finish" data-id="${b.id}">${esc(t('btn_finish'))}</button>` : ''}
        </div>
      </div>
    </article>`;
}
function calendarHtml(p) {
  const wd = t('weekdays');
  const first = p.calendar[0].date;
  const [fy, fm, fd] = first.split('-').map(Number);
  const startDow = new Date(fy, fm - 1, fd).getDay();
  const dueDays = new Set(state.books.filter(b => b.status === 'reading' && b.due).map(b => b.due));
  const sel = ui.calSel && p.calendar.some(d => d.date === ui.calSel) ? ui.calSel : first;
  ui.calSel = sel;
  const head = Array.from({ length: 7 }, (_, i) => `<div class="cal-wd">${esc(wd[(startDow + i) % 7])}</div>`).join('');
  const cells = p.calendar.map((d, i) => {
    const [y, m, day] = d.date.split('-').map(Number);
    const showMonth = i === 0 || day === 1;
    const over = d.total > p.capacity;
    return `<button class="cal-day ${i === 0 ? 'is-today' : ''} ${d.date === sel ? 'is-sel' : ''} ${d.total ? 'has' : ''} ${dueDays.has(d.date) ? 'due-day' : ''}" data-date="${d.date}">
      <span class="cal-num">${showMonth ? `<span class="cal-month">${esc(new Intl.DateTimeFormat(lang() === 'ko' ? 'ko-KR' : 'en-US', { month: 'short' }).format(new Date(y, m - 1, day)))}</span><br>` : ''}${day}</span>
      <span class="cal-total ${over ? 'over' : ''}">${d.total ? esc(t('cal_pages', { n: d.total })) : ''}</span>
    </button>`;
  }).join('');
  const selDay = p.calendar.find(d => d.date === sel);
  const dueHere = state.books.filter(b => b.status === 'reading' && b.due === sel);
  const detail = `
    <div class="cal-detail">
      <b>${esc(fmtDate(sel))}</b> · ${selDay && selDay.total ? esc(t('cal_pages', { n: selDay.total })) : esc(t('cal_day_empty'))}
      ${selDay && selDay.entries.length ? `<ul>${selDay.entries.map(e => `<li>${esc(e.title)} — ${esc(t('read_pages', { from: e.from, to: e.to, n: e.pages }))}</li>`).join('')}</ul>` : ''}
      ${dueHere.length ? `<ul>${dueHere.map(b => `<li>📚 ${esc(t('row_due', { date: fmtDate(b.due) }))}: ${esc(b.title)}</li>`).join('')}</ul>` : ''}
    </div>`;
  return `<div class="calendar"><div class="cal-grid">${head}${cells}</div>${detail}</div>`;
}

function renderToday() {
  const el = views.today;
  if (!state.books.length) {
    el.innerHTML = `
      <div class="empty">
        <h2>${esc(t('empty_title'))}</h2>
        <p>${esc(t('empty_body'))}</p>
        <div class="btn-row" style="justify-content:center">
          <button class="btn primary" data-act="add">${ICON.plus} ${esc(t('btn_add_book'))}</button>
          <button class="btn" data-act="import">${ICON.ext} ${esc(t('btn_import'))}</button>
        </div>
      </div>`;
    bindCommon(el);
    return;
  }
  const p = plan();
  const pct = Math.min(100, Math.round(p.totalToday / p.capacity * 100));
  const barCls = p.totalToday > p.capacity ? 'over' : pct >= 80 ? 'warn' : '';
  const [y, m, d] = p.today.split('-').map(Number);
  const dateLabel = new Intl.DateTimeFormat(lang() === 'ko' ? 'ko-KR' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(y, m - 1, d));

  el.innerHTML = `
    <div class="card hero">
      <div class="hero-top">
        <span class="hero-date">${esc(dateLabel)}</span>
        <div class="btn-row">
          <button class="btn small" data-act="add">${ICON.plus} ${esc(t('btn_add_book'))}</button>
          <button class="btn small" data-act="import">${ICON.ext} ${esc(t('btn_import'))}</button>
        </div>
      </div>
      <div class="hero-big">${p.totalToday ? esc(t('read_today', { n: p.totalToday })) : esc(t('nothing_today'))}</div>
      <div class="pbar ${barCls}"><i style="width:${pct}%"></i></div>
      <div class="hero-cap">${esc(t('capacity_of', { cap: p.capacity }))}</div>
      <div class="sync-line">
        <span class="sync-dot ${state.sync.at ? 'on' : ''}"></span>
        <span>${state.sync.at ? esc(t('sync_last', { when: fmtRel(state.sync.at), n: state.sync.count })) : esc(t('sync_never'))}</span>
        <button class="link-btn" data-act="import">${esc(t('sync_how'))}</button>
      </div>
      ${p.suggestions.length ? `<div class="suggestions">${p.suggestions.map(suggestionHtml).join('')}</div>` : ''}
    </div>

    <div class="tasks">${p.items.map(taskCard).join('')}</div>

    <div class="section-head">
      <h2>${esc(t('cal_title'))}</h2>
      <button class="btn small" data-act="ics">${ICON.cal} ${esc(t('cal_export'))}</button>
    </div>
    ${calendarHtml(p)}
  `;
  bindCommon(el);
  el.querySelectorAll('.cal-day').forEach(c => c.addEventListener('click', () => { ui.calSel = c.dataset.date; renderToday(); }));
  el.querySelectorAll('[data-act="done-today"]').forEach(btn => btn.addEventListener('click', () => {
    const b = bookById(btn.dataset.id); const it = p.items.find(x => x.id === b.id);
    if (!b || !it) return;
    setProgress(b, it.currentPage + it.perDay);
    toast(t('toast_saved')); render();
  }));
  el.querySelectorAll('[data-act="set-page"]').forEach(btn => btn.addEventListener('click', () => {
    const b = bookById(btn.dataset.id); if (!b) return;
    const v = prompt(t('prompt_set_page', { total: b.pages }), String(b.currentPage || 0));
    if (v === null || v.trim() === '' || isNaN(+v)) return;
    setProgress(b, +v); toast(t('toast_saved')); render();
  }));
  el.querySelector('[data-act="ics"]').addEventListener('click', () => {
    download('reading-plan.ics', Planner.buildICS(p, state.books, { calName: t('app_name') }), 'text/calendar;charset=utf-8');
    toast(t('toast_exported'));
  });
}

/** 여러 화면에서 공통으로 쓰는 버튼 바인딩 */
function bindCommon(root) {
  root.querySelectorAll('[data-act="add"]').forEach(b => b.addEventListener('click', () => openBookDialog()));
  root.querySelectorAll('[data-act="import"]').forEach(b => b.addEventListener('click', openImportDialog));
  root.querySelectorAll('[data-act="edit"], [data-edit]').forEach(b => b.addEventListener('click', () => {
    const book = bookById(b.dataset.id || b.dataset.edit); if (book) openBookDialog(book);
  }));
  root.querySelectorAll('[data-act="finish"], [data-finish]').forEach(b => b.addEventListener('click', () => {
    const book = bookById(b.dataset.id || b.dataset.finish); if (!book) return;
    markDone(book); toast(t('toast_saved')); render();
  }));
}

// ---------------------------------------------------------------
// 책장
// ---------------------------------------------------------------
function renderShelf() {
  const el = views.shelf;
  const f = ui.shelfFilter;
  const list = state.books.filter(b => f === 'all' || b.status === f)
    .slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const counts = { reading: 0, queued: 0, done: 0 };
  for (const b of state.books) counts[b.status] = (counts[b.status] || 0) + 1;

  el.innerHTML = `
    <div class="row-between" style="margin-bottom:12px">
      <h2 style="margin:0">${esc(t('shelf_title'))}</h2>
      <div class="btn-row">
        <button class="btn small primary" data-act="add">${ICON.plus} ${esc(t('btn_add_book'))}</button>
        <button class="btn small" data-act="import">${ICON.ext} ${esc(t('btn_import'))}</button>
      </div>
    </div>
    <div class="chips">
      ${['reading', 'queued', 'done', 'all'].map(k => `<button class="chip ${f === k ? 'is-active' : ''}" data-filter="${k}">${esc(t('filter_' + k))}${k !== 'all' ? ` · ${counts[k] || 0}` : ''}</button>`).join('')}
    </div>
    <div class="book-list">
      ${list.length ? list.map(bookRow).join('') : `<div class="empty">${esc(t('shelf_empty'))}</div>`}
    </div>`;

  bindCommon(el);
  el.querySelectorAll('[data-filter]').forEach(c => c.addEventListener('click', () => { ui.shelfFilter = c.dataset.filter; renderShelf(); }));
  el.querySelectorAll('[data-act="start"]').forEach(b => b.addEventListener('click', () => {
    const book = bookById(b.dataset.id); if (!book) return;
    book.status = 'reading'; if (!book.due) book.due = Planner.addDays(today(), state.settings.loanDays);
    save(); toast(t('toast_saved')); render();
  }));
  el.querySelectorAll('[data-act="requeue"]').forEach(b => b.addEventListener('click', () => {
    const book = bookById(b.dataset.id); if (!book) return;
    book.status = 'queued'; save(); render();
  }));
  el.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => {
    const book = bookById(b.dataset.id); if (!book) return;
    if (!confirm(`${t('btn_delete')}: ${book.title}?`)) return;
    removeBook(book.id); toast(t('toast_deleted')); render();
  }));
  el.querySelectorAll('[data-rate]').forEach(s => s.addEventListener('click', () => {
    const book = bookById(s.dataset.id); if (!book) return;
    book.rating = +s.dataset.rate; state.recs = { date: '', items: [] }; save(); renderShelf();
  }));
}
function bookRow(b) {
  const meta = [];
  if (b.pages) meta.push(t('row_pages', { n: b.pages }));
  if (b.due && b.status !== 'done') meta.push(t('row_due', { date: fmtDate(b.due) }));
  if (b.status === 'reading' && b.pages) meta.push(t('progress', { cur: b.currentPage || 0, total: b.pages }));
  const stars = b.status === 'done' ? `
    <span class="stars">${[1, 2, 3, 4, 5].map(n => `<button data-rate="${n}" data-id="${b.id}" class="${(b.rating || 0) >= n ? 'on' : ''}" aria-label="${n}">★</button>`).join('')}</span>
    ${b.rating ? '' : `<span class="stars-hint">${esc(t('rating_hint'))}</span>`}` : '';
  const actions = b.status === 'reading' ? `
      <button class="btn small" data-act="edit" data-id="${b.id}">${esc(t('btn_edit'))}</button>
      <button class="btn small" data-act="finish" data-id="${b.id}">${esc(t('btn_mark_done'))}</button>
      <button class="btn small ghost danger" data-act="delete" data-id="${b.id}">${esc(t('btn_delete'))}</button>`
    : b.status === 'queued' ? `
      <button class="btn small primary" data-act="start" data-id="${b.id}">${esc(t('btn_start'))}</button>
      <button class="btn small" data-act="edit" data-id="${b.id}">${esc(t('btn_edit'))}</button>
      <button class="btn small ghost danger" data-act="delete" data-id="${b.id}">${esc(t('btn_delete'))}</button>`
    : `
      ${stars}
      <button class="btn small ghost" data-act="requeue" data-id="${b.id}">${esc(t('btn_requeue'))}</button>
      <button class="btn small ghost danger" data-act="delete" data-id="${b.id}">${esc(t('btn_delete'))}</button>`;
  return `
    <div class="book-row">
      ${coverHtml(b)}
      <div class="book-main">
        <div class="book-title">${esc(b.title)}</div>
        <div class="book-meta"><span>${esc(b.author || t('unknown_author'))}</span>${meta.map(m => `<span>${esc(m)}</span>`).join('')}${b.source === 'library' ? `<span class="badge library">${esc(t('from_library'))}</span>` : ''}</div>
        <div class="book-actions">${actions}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------
// 찾기 (검색 + 추천)
// ---------------------------------------------------------------
let searchTimer = 0;
function resultCard(w, reason) {
  const onShelf = state.books.some(b => titleMatch(b.title, w.title));
  const meta = [w.author || t('unknown_author'), w.year, w.pages ? t('row_pages', { n: w.pages }) : null].filter(Boolean).join(' · ');
  const key = encodeURIComponent(JSON.stringify({ title: w.title, author: w.author, pages: w.pages, coverUrl: w.coverUrl, olKey: w.olKey, subjects: (w.subjects || []).slice(0, 15) }));
  return `
    <div class="result">
      ${coverHtml(w)}
      <div class="result-main">
        <div class="result-title">${esc(w.title)}</div>
        <div class="result-meta">${esc(meta)}</div>
        ${reason ? `<div class="result-reason">${esc(reason)}</div>` : ''}
        <div class="result-actions">
          <a class="btn small" href="${esc(qplLink(w.title))}" target="_blank" rel="noopener">${ICON.ext} ${esc(t('btn_check_qpl'))}</a>
          ${onShelf ? `<span class="badge done">${esc(t('on_shelf'))}</span>` : `
            <button class="btn small primary" data-pick="${key}" data-status="reading">${ICON.plus} ${esc(t('btn_add'))}</button>
            <button class="btn small" data-pick="${key}" data-status="queued">${esc(t('btn_want'))}</button>`}
        </div>
      </div>
    </div>`;
}
function renderDiscover() {
  const el = views.discover;
  const recs = state.recs.items || [];
  el.innerHTML = `
    <h2>${esc(t('discover_title'))}</h2>
    <label class="search-box">${ICON.search}<input id="disc-q" type="search" placeholder="${esc(t('search_ph'))}" value="${esc(ui.q)}" autocomplete="off"></label>
    <div class="results" id="disc-results">
      ${ui.searching ? `<div class="loading">${esc(t('add_searching'))}</div>` :
        ui.searchResults === 'error' ? `<div class="loading">${esc(t('search_error'))}</div>` :
        Array.isArray(ui.searchResults) ? (ui.searchResults.length ? ui.searchResults.map(w => resultCard(w)).join('') : `<div class="loading">${esc(t('add_results_empty'))}</div>`) : ''}
    </div>
    <div class="section-head">
      <h2>${esc(t('recs_title'))}</h2>
      <button class="btn small" id="recs-refresh">${ICON.refresh} ${esc(t('recs_refresh'))}</button>
    </div>
    <div class="results" id="recs">
      ${ui.recsLoading ? `<div class="loading">${esc(t('recs_loading'))}</div>` :
        ui.recsError ? `<div class="loading">${esc(t('recs_error'))}</div>` :
        recs.length ? recs.map(r => resultCard(r.work, reasonText(r.reason))).join('') : `<div class="loading">${esc(t('recs_empty'))}</div>`}
    </div>`;

  const inp = $('#disc-q');
  inp.addEventListener('input', () => {
    ui.q = inp.value;
    clearTimeout(searchTimer);
    if (!ui.q.trim()) { ui.searchResults = null; renderResultsOnly(); return; }
    searchTimer = setTimeout(runSearch, 400);
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });
  $('#recs-refresh').addEventListener('click', () => computeRecs(true));
  bindPicks(el);
  if (!recs.length && !ui.recsLoading && !ui.recsError && navigator.onLine) computeRecs(false);
  else if (recs.length && state.recs.date !== today() && navigator.onLine) computeRecs(true);
}
function renderResultsOnly() {
  if (ui.view === 'discover') { const pos = $('#disc-q') ? $('#disc-q').selectionStart : 0; renderDiscover(); const i = $('#disc-q'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
}
async function runSearch() {
  const q = ui.q.trim();
  if (!q) return;
  ui.searching = true; renderResultsOnly();
  try { ui.searchResults = await OL.search(q, { limit: 15 }); }
  catch (_) { ui.searchResults = 'error'; }
  finally { ui.searching = false; renderResultsOnly(); }
}
function bindPicks(root) {
  root.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
    let w; try { w = JSON.parse(decodeURIComponent(btn.dataset.pick)); } catch (_) { return; }
    if (btn.dataset.status === 'queued') {
      addBook(Object.assign({}, w, { status: 'queued', source: 'rec' }));
      toast(t('toast_saved')); render();
    } else {
      openBookDialog(null, Object.assign({}, w, { status: 'reading' }));
    }
  }));
}
function reasonText(r) {
  if (!r) return '';
  if (r.type === 'author') return t('reason_author', { author: r.value });
  if (r.type === 'subject') return t('reason_subject', { subject: r.value });
  return t('reason_trending');
}
async function computeRecs(force) {
  if (ui.recsLoading) return;
  const key = today();
  if (!force && state.recs.date === key && state.recs.items.length) return;
  ui.recsLoading = true; ui.recsError = false;
  if (ui.view === 'discover') renderDiscover();
  try {
    const shelf = state.books;
    const liked = shelf.filter(b => b.status === 'done' && (b.rating || 0) >= 4);
    const seeds = (liked.length ? liked : shelf.filter(b => b.status !== 'queued')).slice(0, 8);
    const bucket = new Map();
    const add = (w, score, reason) => {
      if (!w || !w.title) return;
      if (shelf.some(b => titleMatch(b.title, w.title))) return;
      const k = w.olKey || norm(w.title);
      const cur = bucket.get(k) || { work: w, score: 0, reason };
      cur.score += score;
      if (!cur.work.coverUrl && w.coverUrl) cur.work = Object.assign({}, w);
      bucket.set(k, cur);
    };
    if (seeds.length) {
      const authorCount = {};
      for (const s of seeds) if (s.author) authorCount[s.author] = (authorCount[s.author] || 0) + ((s.rating || 3) / 3);
      const topAuthors = Object.entries(authorCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
      for (const a of topAuthors) { try { (await OL.byAuthor(a, 8)).forEach(w => add(w, 3, { type: 'author', value: a })); } catch (_) { /* skip */ } }
      const subjCount = {};
      for (const s of seeds) for (const sub of (s.subjects || [])) {
        if (GENERIC_SUBJECT.test(sub) || sub.length > 30 || /[:=]/.test(sub)) continue;
        subjCount[sub] = (subjCount[sub] || 0) + 1;
      }
      const topSubjects = Object.entries(subjCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
      for (const s of topSubjects) { try { (await OL.bySubject(s, 12)).forEach(w => add(w, 1 + (subjCount[s] > 1 ? 1 : 0), { type: 'subject', value: s })); } catch (_) { /* skip */ } }
    }
    if (!bucket.size) (await OL.trending(12)).forEach(w => add(w, 1, { type: 'trending' }));
    const items = [...bucket.values()].sort((a, b) => b.score - a.score).slice(0, 12);
    state.recs = { date: key, items }; save();
  } catch (_) {
    ui.recsError = true;
  } finally {
    ui.recsLoading = false;
    if (ui.view === 'discover') renderDiscover();
  }
}

// ---------------------------------------------------------------
// 설정
// ---------------------------------------------------------------
function renderSettings() {
  const el = views.settings;
  const s = state.settings;
  const tpl = qplTemplate();
  el.innerHTML = `
    <h2>${esc(t('set_title'))}</h2>
    <div class="settings-grid">
      <div class="setting-card">
        <div class="setting-row">
          <label class="grow" for="set-lang">${esc(t('set_lang'))}</label>
          <select id="set-lang"><option value="en" ${lang() === 'en' ? 'selected' : ''}>English</option><option value="ko" ${lang() === 'ko' ? 'selected' : ''}>한국어</option></select>
        </div>
        <div class="setting-row">
          <label class="grow" for="set-cap">${esc(t('set_capacity'))}</label>
          <input id="set-cap" type="number" min="5" max="1000" step="5" value="${s.capacity}">
        </div>
        <div class="setting-row">
          <label class="grow" for="set-buf">${esc(t('set_buffer'))}</label>
          <input id="set-buf" type="number" min="0" max="7" value="${s.bufferDays}">
        </div>
        <div class="setting-row">
          <label class="grow" for="set-loan">${esc(t('set_loan'))}</label>
          <input id="set-loan" type="number" min="1" max="90" value="${s.loanDays}">
        </div>
      </div>

      <div class="setting-card">
        <h3>${esc(t('set_qpl_url'))}</h3>
        <p class="hint">${esc(t('set_qpl_hint'))}</p>
        <div class="setting-col">
          <input id="set-qpl" type="url" value="${esc(s.qplSearchUrl || '')}" placeholder="${esc(s.qplSearchUrlAuto || DEFAULT_QPL_URL)}">
          <div class="row-between">
            <span class="small muted">${s.qplSearchUrlAuto && !s.qplSearchUrl ? '✓ ' + esc(t('set_qpl_auto')) : ''}</span>
            <a class="btn small" href="${esc(tpl.replace('{q}', encodeURIComponent('Pachinko')))}" target="_blank" rel="noopener">${ICON.ext} ${esc(t('set_qpl_test'))}</a>
          </div>
        </div>
      </div>

      <div class="setting-card">
        <h3>${esc(t('set_ext'))}</h3>
        <p class="hint">${esc(t('import_how_ext'))}</p>
        <div class="row-between">
          <span class="small">${state.sync.at ? esc(t('set_ext_status', { when: fmtRel(state.sync.at), n: state.sync.count })) : esc(t('set_ext_status_never'))}</span>
          <a class="btn small" href="${EXT_GUIDE_URL}" target="_blank" rel="noopener">${ICON.ext} ${esc(t('set_ext_guide'))}</a>
        </div>
      </div>

      <div class="setting-card">
        <h3>${esc(t('set_data'))}</h3>
        <p class="hint">${esc(t('set_data_hint'))}</p>
        <div class="btn-row">
          <button class="btn small" id="btn-export">${esc(t('btn_export_json'))}</button>
          <label class="btn small">${esc(t('btn_import_json'))}<input id="file-import" type="file" accept="application/json" hidden></label>
          <button class="btn small danger" id="btn-reset">${esc(t('btn_reset'))}</button>
        </div>
      </div>

      <div class="setting-card"><p class="hint" style="margin:0">${esc(t('set_about'))}</p></div>
    </div>`;

  $('#set-lang').addEventListener('change', e => { s.lang = e.target.value; save(); render(); });
  $('#set-cap').addEventListener('change', e => { s.capacity = Math.max(5, +e.target.value || 60); save(); });
  $('#set-buf').addEventListener('change', e => { s.bufferDays = Math.max(0, Math.min(7, +e.target.value || 0)); save(); });
  $('#set-loan').addEventListener('change', e => { s.loanDays = Math.max(1, +e.target.value || 21); save(); });
  $('#set-qpl').addEventListener('change', e => { s.qplSearchUrl = e.target.value.trim(); save(); renderSettings(); });
  $('#btn-export').addEventListener('click', () => download('library-reading-planner-backup.json', JSON.stringify(state, null, 1), 'application/json'));
  $('#file-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.books)) throw new Error('bad');
      const d = DEFAULTS();
      d.books = data.books; Object.assign(d.settings, data.settings || {}); Object.assign(d.sync, data.sync || {});
      state = d; save(); toast(t('toast_restored')); render();
    } catch (_) { toast(t('toast_bad_file')); }
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm(t('confirm_reset'))) return;
    state = DEFAULTS(); save(); render();
  });
}

// ---------------------------------------------------------------
// 다이얼로그: 책 추가/수정
// ---------------------------------------------------------------
const dlg = $('#dlg');
function openDlg(html) { dlg.innerHTML = `<div class="dlg-inner">${html}</div>`; if (!dlg.open) dlg.showModal(); }
function closeDlg() { if (dlg.open) dlg.close(); dlg.innerHTML = ''; }
dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); });
dlg.addEventListener('close', () => { dlg.innerHTML = ''; });

/**
 * @param {Object|null} book    수정할 책 (없으면 추가)
 * @param {Object} [prefill]    검색 결과 등에서 미리 채울 값
 */
function openBookDialog(book, prefill) {
  if (!book && !prefill) return renderBookSearchStep();
  renderBookFormStep(book, prefill || {});
}
function renderBookSearchStep() {
  openDlg(`
    <h2>${esc(t('add_title'))}</h2>
    <label class="search-box">${ICON.search}<input id="bk-q" type="search" placeholder="${esc(t('add_search_ph'))}" autocomplete="off" autofocus></label>
    <div class="pick-list" id="bk-results"></div>
    <div class="dlg-actions">
      <button class="btn" id="bk-manual">${esc(t('add_manual'))}</button>
      <button class="btn ghost" id="bk-cancel">${esc(t('cancel'))}</button>
    </div>`);
  const q = $('#bk-q'), res = $('#bk-results');
  let timer = 0;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    const v = q.value.trim();
    if (!v) { res.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      res.innerHTML = `<div class="loading">${esc(t('add_searching'))}</div>`;
      try {
        const docs = await OL.search(v, { limit: 10 });
        res.innerHTML = docs.length ? docs.map((w, i) => `
          <button class="pick" data-i="${i}">
            ${coverHtml(w)}
            <div><b>${esc(w.title)}</b><span>${esc([w.author, w.year, w.pages ? t('row_pages', { n: w.pages }) : null].filter(Boolean).join(' · '))}</span></div>
          </button>`).join('') : `<div class="loading">${esc(t('add_results_empty'))}</div>`;
        res.querySelectorAll('.pick').forEach(p => p.addEventListener('click', () => renderBookFormStep(null, Object.assign({}, docs[+p.dataset.i], { status: 'reading' }))));
      } catch (_) { res.innerHTML = `<div class="loading">${esc(t('search_error'))}</div>`; }
    }, 350);
  });
  $('#bk-manual').addEventListener('click', () => renderBookFormStep(null, { title: q.value.trim() }));
  $('#bk-cancel').addEventListener('click', closeDlg);
  setTimeout(() => q.focus(), 50);
}
function renderBookFormStep(book, pre) {
  const v = Object.assign({ title: '', author: '', pages: '', due: '', currentPage: 0, status: 'reading' }, book || {}, book ? {} : pre);
  if (!book && !v.due && v.status === 'reading') v.due = Planner.addDays(today(), state.settings.loanDays);
  openDlg(`
    <h2>${esc(book ? t('edit_title') : t('add_title'))}</h2>
    <form id="bk-form">
      <div class="field"><label>${esc(t('f_title'))}</label><input name="title" required value="${esc(v.title)}"></div>
      <div class="field"><label>${esc(t('f_author'))}</label><input name="author" value="${esc(v.author)}"></div>
      <div class="field-row">
        <div class="field"><label>${esc(t('f_pages'))}</label><input name="pages" type="number" min="1" max="5000" value="${esc(v.pages || '')}"></div>
        <div class="field"><label>${esc(t('f_current_page'))}</label><input name="currentPage" type="number" min="0" max="5000" value="${esc(v.currentPage || 0)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>${esc(t('f_due'))}</label><input name="due" type="date" value="${esc(v.due || '')}"><span class="small muted">${esc(t('add_default_due_hint', { n: state.settings.loanDays }))}</span></div>
        <div class="field"><label>${esc(t('f_status'))}</label>
          <select name="status">
            <option value="reading" ${v.status === 'reading' ? 'selected' : ''}>${esc(t('filter_reading'))}</option>
            <option value="queued" ${v.status === 'queued' ? 'selected' : ''}>${esc(t('filter_queued'))}</option>
            <option value="done" ${v.status === 'done' ? 'selected' : ''}>${esc(t('filter_done'))}</option>
          </select>
        </div>
      </div>
      <div class="dlg-actions">
        ${book ? '' : `<button type="button" class="btn ghost" id="bk-back">${esc(t('add_back_search'))}</button>`}
        <button type="button" class="btn ghost" id="bk-cancel">${esc(t('cancel'))}</button>
        <button type="submit" class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`);
  $('#bk-cancel').addEventListener('click', closeDlg);
  const back = $('#bk-back'); if (back) back.addEventListener('click', renderBookSearchStep);
  $('#bk-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const patch = {
      title: String(fd.get('title') || '').trim(),
      author: String(fd.get('author') || '').trim(),
      pages: +fd.get('pages') || null,
      currentPage: Math.max(0, +fd.get('currentPage') || 0),
      due: fd.get('due') || null,
      status: fd.get('status')
    };
    if (!patch.title) return;
    if (patch.pages && patch.currentPage > patch.pages) patch.currentPage = patch.pages;
    if (patch.status === 'done' && patch.pages) patch.currentPage = patch.pages;
    if (book) {
      Object.assign(book, patch);
      if (patch.status === 'done' && !book.finishedAt) book.finishedAt = today();
      save();
    } else {
      addBook(Object.assign({}, { coverUrl: pre.coverUrl || '', olKey: pre.olKey || '', subjects: pre.subjects || [], source: pre.olKey ? 'search' : 'manual' }, patch));
    }
    closeDlg(); toast(t('toast_saved')); render();
    enrichMissing();
  });
}

// ---------------------------------------------------------------
// 다이얼로그: 도서관에서 가져오기 (붙여넣기)
// ---------------------------------------------------------------
function openImportDialog() {
  openDlg(`
    <h2>${esc(t('import_title'))}</h2>
    <div class="how-box">🧩 ${esc(t('import_how_ext'))} <a href="${EXT_GUIDE_URL}" target="_blank" rel="noopener">${esc(t('import_ext_link'))} ↗</a></div>
    <div class="how-box">📋 ${esc(t('import_how_paste'))}</div>
    <div class="field"><textarea id="imp-text" placeholder="${esc(t('import_ph'))}"></textarea></div>
    <div id="imp-preview"></div>
    <div class="dlg-actions">
      <button class="btn ghost" id="imp-cancel">${esc(t('cancel'))}</button>
      <button class="btn" id="imp-parse">${esc(t('import_parse'))}</button>
      <button class="btn primary" id="imp-do" hidden></button>
    </div>`);
  let found = [];
  const preview = $('#imp-preview'), doBtn = $('#imp-do');
  $('#imp-cancel').addEventListener('click', closeDlg);
  $('#imp-parse').addEventListener('click', () => {
    found = CheckoutParser.parseCheckoutsFromText($('#imp-text').value);
    if (!found.length) { preview.innerHTML = `<div class="loading">${esc(t('import_none'))}</div>`; doBtn.hidden = true; return; }
    preview.innerHTML = `<p class="small" style="margin:6px 0 0"><b>${esc(t('import_found', { n: found.length }))}</b></p>
      <div class="preview-list">${found.map((it, i) => `
        <label class="preview-item"><input type="checkbox" data-i="${i}" checked>
          <span class="pi-main"><b>${esc(it.title)}</b>${it.author ? `<br><span class="small muted">${esc(it.author)}</span>` : ''}</span>
          <span class="pi-due">${esc(fmtDate(it.due))}${it.overdue ? ' ⚠️' : ''}</span></label>`).join('')}</div>`;
    doBtn.hidden = false; doBtn.textContent = t('import_do', { n: found.length });
    preview.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      const n = preview.querySelectorAll('input:checked').length; doBtn.textContent = t('import_do', { n }); doBtn.disabled = !n;
    }));
  });
  doBtn.addEventListener('click', () => {
    const sel = [...preview.querySelectorAll('input:checked')].map(cb => found[+cb.dataset.i]);
    if (!sel.length) return;
    mergeItems(sel, 'library');
    state.sync = { at: Date.now(), count: sel.length, sourceUrl: 'paste' };
    save(); closeDlg(); toast(t('import_done', { n: sel.length })); render();
    enrichMissing();
  });
}

// ---------------------------------------------------------------
// 시작
// ---------------------------------------------------------------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 온라인 전용으로 동작 */ });
}
applyStaticI18n();
render();
window.postMessage({ type: SYNC_REQ }, '*'); // 확장이 있으면 최신 동기화 데이터를 보내 줌
if (navigator.onLine) enrichMissing();

// 디버깅/테스트용 최소 노출
window.LRP = { applySync, get state() { return state; } };

})();
