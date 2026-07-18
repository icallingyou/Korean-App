/* =============================================================
   중급 한국어 단어장 — 앱 로직
   - 한국어 낭독: Web Speech API (speechSynthesis, ko-KR)
   - 진도/설정 저장: localStorage
   ============================================================= */
'use strict';

(() => {

// ---------------------------------------------------------------
// 데이터
// ---------------------------------------------------------------
const RAW = [...(window.WORDS || []), ...(window.WORDS_EXTRA || [])];
const WORDS = RAW.map((r, i) => ({
  id: i,
  w: r.w,
  p: r.p || '',
  pos: r.pos || '',
  cat: r.cat || '기타',
  en: r.en || '',
  def: r.def || '',
  ko: r.ko || '',
  ex: (r.ex || []).map(e => ({ ko: e[0], en: e[1] || '' }))
}));
const CATS = ['전체', ...new Set(WORDS.map(w => w.cat))];

// ---------------------------------------------------------------
// 저장소
// ---------------------------------------------------------------
const LS_KEY = 'kvoca.v1';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { saved = {}; }
const fav = new Set(saved.fav || []);
const learned = new Set(saved.learned || []);
const settings = Object.assign({
  rate: 0.95,        // 한국어 낭독 속도
  autoRead: true,    // 카드 이동 시 단어 자동 낭독
  readEn: true,      // 자동 읽기에 영어 해설 포함
  showKo: true,      // 한국어 뜻풀이 표시
  cont: false,       // 연속 재생 (자동으로 다음 카드)
  koVoice: '',
  enVoice: ''
}, saved.settings || {});

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      fav: [...fav], learned: [...learned], settings
    }));
  } catch (_) { /* 시크릿 모드 등에서 저장 실패는 무시 */ }
}

// ---------------------------------------------------------------
// TTS (음성 합성)
// ---------------------------------------------------------------
const TTS = {
  ok: 'speechSynthesis' in window,
  voices: [],
  current: null, // GC 방지용 참조
  refresh() { if (this.ok) this.voices = speechSynthesis.getVoices(); },
  list(prefix) { return this.voices.filter(v => v.lang.toLowerCase().startsWith(prefix)); },
  pick(prefix, wanted, prefer) {
    const vs = this.list(prefix);
    if (wanted) { const m = vs.find(v => v.name === wanted); if (m) return m; }
    for (const re of prefer) { const m = vs.find(v => re.test(v.name)); if (m) return m; }
    return vs[0] || null;
  },
  ko() { return this.pick('ko', settings.koVoice, [/google/i, /yuna|sora|heami|injoon/i]); },
  en() { return this.pick('en', settings.enVoice, [/google us english/i, /samantha|aria|zira|jenny/i]); },
  speak(text, lang = 'ko', rate) {
    if (!this.ok || !text) return Promise.resolve(false);
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'en' ? 'en-US' : 'ko-KR';
      const v = lang === 'en' ? this.en() : this.ko();
      if (v) u.voice = v;
      u.rate = rate ?? (lang === 'en' ? Math.min(1.05, settings.rate + 0.1) : settings.rate);
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      this.current = u;
      speechSynthesis.speak(u);
    });
  },
  stop() { if (this.ok) speechSynthesis.cancel(); }
};
if (TTS.ok) {
  TTS.refresh();
  speechSynthesis.onvoiceschanged = () => {
    TTS.refresh();
    if (ui.view === 'settings') renderSettings();
  };
} else {
  document.getElementById('tts-banner').hidden = false;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
let speakToken = 0;

/** 여러 구간을 순서대로 낭독. 중간에 stopSpeech()가 불리면 즉시 중단. */
async function speakSeq(parts) {
  const tok = ++speakToken;
  for (const part of parts) {
    if (tok !== speakToken) return false;
    const el = part.el || null;
    if (el) el.classList.add('speaking');
    await TTS.speak(part.text, part.lang, part.rate);
    if (el) el.classList.remove('speaking');
    if (tok !== speakToken) return false;
    await wait(part.pause ?? 260);
    if (tok !== speakToken) return false;
  }
  return true;
}

function stopSpeech() {
  speakToken++;
  TTS.stop();
  document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
  if (ui.playing) { ui.playing = false; syncPlayBtn(); }
}

// ---------------------------------------------------------------
// 상태
// ---------------------------------------------------------------
const ui = {
  view: 'study',
  cat: '전체',
  onlyFav: false,
  hideLearned: false,
  order: [],
  pos: 0,
  revealed: false,
  playing: false,
  q: '',
  listCat: '전체',
  quiz: null
};

function pool() {
  return WORDS.filter(w =>
    (ui.cat === '전체' || w.cat === ui.cat) &&
    (!ui.onlyFav || fav.has(w.id)) &&
    (!ui.hideLearned || !learned.has(w.id))
  );
}

function rebuildOrder() {
  const keep = ui.order[ui.pos];
  ui.order = pool().map(w => w.id);
  const at = ui.order.indexOf(keep);
  ui.pos = at >= 0 ? at : 0;
}

function cur() { return WORDS[ui.order[ui.pos]]; }

function shuffleArr(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const sample = (arr, n) => shuffleArr(arr).slice(0, n);

// ---------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------
const $ = sel => document.querySelector(sel);
const esc = s => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const ICONS = {
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h3.5L13 19V5L7.5 9H4z" fill="currentColor"/><path d="M16.2 8.6a4.4 4.4 0 0 1 0 6.8M18.6 6.2a7.6 7.6 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.2 6.9 19l1.1-5.6-4.2-3.9 5.7-.7L12 3.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.2 6.9 19l1.1-5.6-4.2-3.9 5.7-.7L12 3.6z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5L8 5.5z" fill="currentColor"/></svg>',
  stopIc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c4 0 6 10 10 10H21m0 0l-2.5-2.5M21 17l-2.5 2.5M3 17h3.5c1.6 0 2.9-1.6 4-3.4M21 7h-4.5c-1.6 0-2.9 1.6-4 3.4M21 7l-2.5-2.5M21 7l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="2.7" fill="currentColor"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  ear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9a5.5 5.5 0 1 1 11 0c0 2.4-1.6 3.4-2.8 4.6-.9.9-1.2 1.8-1.4 3a2.8 2.8 0 0 1-5.5-.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  ab: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17L7.5 6.5 12 17M4.8 13.5h5.4M14.5 6.5h3.6a2.5 2.5 0 0 1 0 5h-3.6zm0 5h4.1a2.75 2.75 0 0 1 0 5.5h-4.1z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

// ---------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------
const views = { study: $('#view-study'), list: $('#view-list'), quiz: $('#view-quiz'), settings: $('#view-settings') };

function setView(name) {
  stopSpeech();
  ui.view = name;
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.view === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', on);
  });
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  render(name);
}

document.querySelectorAll('.tab').forEach(t =>
  t.addEventListener('click', () => setView(t.dataset.view)));

function render(name) {
  if (name === 'study') renderStudy();
  else if (name === 'list') renderList();
  else if (name === 'quiz') renderQuiz();
  else renderSettings();
}

// ---------------------------------------------------------------
// 학습(카드) 화면
// ---------------------------------------------------------------
function renderStudy() {
  rebuildOrder();
  const total = ui.order.length;
  const el = views.study;

  const chips = CATS.map(c =>
    `<button class="chip ${ui.cat === c ? 'is-active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('') +
    `<button class="chip is-toggle ${ui.onlyFav ? 'is-active' : ''}" data-toggle="fav">⭐ 즐겨찾기</button>` +
    `<button class="chip is-toggle ${ui.hideLearned ? 'is-active' : ''}" data-toggle="unlearned">🎯 안 외운 단어만</button>`;

  if (!total) {
    el.innerHTML = `
      <div class="filter-row">${chips}</div>
      <div class="empty"><b>조건에 맞는 단어가 없어요.</b><br>필터를 바꾸거나 즐겨찾기·암기 표시를 확인해 보세요.</div>`;
    bindFilterRow(el);
    return;
  }

  const w = cur();
  const learnedCnt = pool().filter(x => learned.has(x.id)).length;
  const pct = Math.round(((ui.pos + 1) / total) * 100);

  el.innerHTML = `
    <div class="filter-row">${chips}</div>
    <div class="progress-row">
      <span><b>${ui.pos + 1}</b> / ${total}</span>
      <div class="pbar"><i style="width:${pct}%"></i></div>
      <span>외운 단어 <b>${learnedCnt}</b></span>
    </div>

    <article class="card" id="study-card" aria-live="polite">
      <div class="card-top">
        <span class="badge level">중급</span>
        <span class="badge">${esc(w.cat)}</span>
        <span class="badge">${esc(w.pos)}</span>
        <span class="spacer"></span>
        <button class="icon-btn good ${learned.has(w.id) ? 'is-on' : ''}" id="btn-learned" title="외웠어요 표시 (L)">${ICONS.check}</button>
        <button class="icon-btn ${fav.has(w.id) ? 'is-on' : ''}" id="btn-fav" title="즐겨찾기 (F)">${fav.has(w.id) ? ICONS.starFill : ICONS.star}</button>
      </div>

      <div class="word-line">
        <h2 class="word" id="el-word">${esc(w.w)}</h2>
        ${w.p ? `<span class="pron">[${esc(w.p)}]</span>` : ''}
        <button class="speak-btn" id="btn-speak-word" title="단어 낭독 (P)">${ICONS.speaker}</button>
      </div>

      ${ui.revealed ? `
      <div class="card-back">
        <span class="meaning" id="el-meaning">${esc(w.en)}</span>
        <div class="defs">
          <span class="def-en" id="el-def">${esc(w.def)}</span>
          ${settings.showKo && w.ko ? `<div class="def-ko">${esc(w.ko)}</div>` : ''}
        </div>
        <div class="examples">
          ${w.ex.map((e, i) => `
            <div class="ex">
              <button class="speak-btn small ex-speak" data-ex="${i}" title="예문 낭독">${ICONS.speaker}</button>
              <div class="ex-body">
                <span class="ex-ko" id="el-ex-ko-${i}">${esc(e.ko)}</span>
                <span class="ex-en" id="el-ex-en-${i}">${esc(e.en)}</span>
              </div>
            </div>`).join('')}
        </div>
      </div>` : `
      <div class="reveal-hint">카드를 누르면 <b>영어 뜻·해설·예문</b>이 보여요 <kbd>Space</kbd></div>`}
    </article>

    <div class="controls">
      <button class="ctrl-btn" id="btn-prev" ${ui.pos === 0 ? 'disabled' : ''}>${ICONS.prev} 이전</button>
      <button class="ctrl-btn" id="btn-reveal">${ICONS.eye} ${ui.revealed ? '뜻 가리기' : '뜻 보기'}</button>
      <button class="ctrl-btn primary ${ui.playing ? 'playing' : ''}" id="btn-autoplay">${ui.playing ? ICONS.stopIc + ' 정지' : ICONS.play + ' 자동 읽기'}</button>
      <button class="ctrl-btn" id="btn-shuffle">${ICONS.shuffle} 섞기</button>
      <button class="ctrl-btn" id="btn-next" ${ui.pos >= total - 1 ? 'disabled' : ''}>다음 ${ICONS.next}</button>
    </div>
    <p class="kbd-hint"><kbd>←</kbd><kbd>→</kbd> 이동 · <kbd>Space</kbd> 뜻 보기 · <kbd>P</kbd> 단어 낭독 · <kbd>A</kbd> 자동 읽기 · <kbd>F</kbd> 즐겨찾기 · <kbd>L</kbd> 외웠어요</p>
  `;

  bindFilterRow(el);

  const card = $('#study-card');
  card.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    toggleReveal();
  });
  $('#btn-reveal').addEventListener('click', toggleReveal);
  $('#btn-prev').addEventListener('click', () => move(-1));
  $('#btn-next').addEventListener('click', () => move(1));
  $('#btn-shuffle').addEventListener('click', () => {
    stopSpeech();
    ui.order = shuffleArr(ui.order);
    ui.pos = 0;
    ui.revealed = false;
    renderStudy();
    autoReadWord();
  });
  $('#btn-speak-word').addEventListener('click', () => {
    stopSpeech();
    speakSeq([{ text: w.w, lang: 'ko', el: $('#el-word') }]);
  });
  $('#btn-fav').addEventListener('click', () => { toggleFav(w.id); renderStudy(); });
  $('#btn-learned').addEventListener('click', () => { toggleLearned(w.id); renderStudy(); });
  $('#btn-autoplay').addEventListener('click', () => ui.playing ? stopSpeech() : playCard());
  el.querySelectorAll('.ex-speak').forEach(b =>
    b.addEventListener('click', () => {
      const i = +b.dataset.ex;
      stopSpeech();
      speakSeq([{ text: w.ex[i].ko, lang: 'ko', el: $(`#el-ex-ko-${i}`) }]);
    }));
}

function bindFilterRow(root) {
  root.querySelectorAll('.chip[data-cat]').forEach(c =>
    c.addEventListener('click', () => {
      stopSpeech();
      ui.cat = c.dataset.cat;
      ui.pos = 0;
      ui.revealed = false;
      renderStudy();
    }));
  root.querySelectorAll('.chip[data-toggle]').forEach(c =>
    c.addEventListener('click', () => {
      stopSpeech();
      if (c.dataset.toggle === 'fav') ui.onlyFav = !ui.onlyFav;
      else ui.hideLearned = !ui.hideLearned;
      ui.pos = 0;
      ui.revealed = false;
      renderStudy();
    }));
}

function toggleReveal() {
  ui.revealed = !ui.revealed;
  renderStudy();
}

function move(dir) {
  const total = ui.order.length;
  const nx = ui.pos + dir;
  if (nx < 0 || nx >= total) return;
  stopSpeech();
  ui.pos = nx;
  ui.revealed = false;
  renderStudy();
  autoReadWord();
}

function autoReadWord() {
  if (!settings.autoRead || !TTS.ok) return;
  const w = cur();
  if (w) speakSeq([{ text: w.w, lang: 'ko', el: $('#el-word') }]);
}

function toggleFav(id) {
  fav.has(id) ? fav.delete(id) : fav.add(id);
  persist();
}
function toggleLearned(id) {
  learned.has(id) ? learned.delete(id) : learned.add(id);
  persist();
}

/** 자동 읽기: 단어 → 영어 뜻/해설 → 예문(한국어+영어). 연속 재생이 켜져 있으면 다음 카드로. */
async function playCard() {
  if (!TTS.ok) return;
  stopSpeech();
  ui.playing = true;
  if (!ui.revealed) { ui.revealed = true; }
  renderStudy(); // playing 상태·뜻 공개를 반영해 다시 그림

  const w = cur();
  if (!w) { ui.playing = false; syncPlayBtn(); return; }

  const parts = [{ text: w.w, lang: 'ko', el: $('#el-word'), pause: 420 }];
  if (settings.readEn) {
    parts.push({ text: w.en, lang: 'en', el: $('#el-meaning'), pause: 300 });
    if (w.def) parts.push({ text: w.def, lang: 'en', el: $('#el-def'), pause: 460 });
  }
  w.ex.forEach((e, i) => {
    parts.push({ text: e.ko, lang: 'ko', el: $(`#el-ex-ko-${i}`), pause: 320 });
    if (settings.readEn && e.en) parts.push({ text: e.en, lang: 'en', el: $(`#el-ex-en-${i}`), pause: 420 });
  });

  const finished = await speakSeq(parts);

  if (finished && settings.cont && ui.pos < ui.order.length - 1) {
    ui.pos++;
    ui.revealed = true;
    renderStudy();
    return playCard();
  }
  ui.playing = false;
  syncPlayBtn();
}

function syncPlayBtn() {
  const b = $('#btn-autoplay');
  if (!b) return;
  b.classList.toggle('playing', ui.playing);
  b.innerHTML = ui.playing ? ICONS.stopIc + ' 정지' : ICONS.play + ' 자동 읽기';
}

// ---------------------------------------------------------------
// 목록 화면
// ---------------------------------------------------------------
function renderList() {
  const el = views.list;
  const q = ui.q.trim().toLowerCase();
  const rows = WORDS.filter(w =>
    (ui.listCat === '전체' || w.cat === ui.listCat) &&
    (!q || w.w.includes(q) || w.en.toLowerCase().includes(q) || w.def.toLowerCase().includes(q) || w.ko.includes(q))
  );

  el.innerHTML = `
    <div class="list-tools">
      <label class="search-box">
        ${ICONS.search}
        <input id="list-search" type="search" placeholder="단어·뜻 검색 (한국어/영어)" value="${esc(ui.q)}" autocomplete="off">
      </label>
      <select class="cat-select" id="list-cat">
        ${CATS.map(c => `<option value="${esc(c)}" ${ui.listCat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
    </div>
    <p class="count-note">${rows.length}개 단어 · ⭐ 즐겨찾기 ${fav.size} · ✅ 외운 단어 ${learned.size}</p>
    <div class="word-list">
      ${rows.map(w => `
        <div class="row" data-id="${w.id}" role="button" tabindex="0">
          <button class="speak-btn small row-speak" data-id="${w.id}" title="낭독">${ICONS.speaker}</button>
          <div class="row-main">
            <div class="row-word">${esc(w.w)}
              ${w.p ? `<span class="pron">[${esc(w.p)}]</span>` : ''}
              <span class="pos-tag">${esc(w.pos)}</span>
            </div>
            <div class="row-en">${esc(w.en)} — ${esc(w.ko || w.def)}</div>
          </div>
          <div class="row-flags">
            ${fav.has(w.id) ? `<span class="flag fav">${ICONS.starFill}</span>` : ''}
            ${learned.has(w.id) ? `<span class="flag done">${ICONS.check}</span>` : ''}
          </div>
        </div>`).join('') || '<div class="empty">검색 결과가 없어요.</div>'}
    </div>
  `;

  $('#list-search').addEventListener('input', e => {
    ui.q = e.target.value;
    const keep = e.target.selectionStart;
    renderList();
    const inp = $('#list-search');
    inp.focus();
    inp.setSelectionRange(keep, keep);
  });
  $('#list-cat').addEventListener('change', e => { ui.listCat = e.target.value; renderList(); });

  el.querySelectorAll('.row').forEach(r => {
    const open = () => {
      const id = +r.dataset.id;
      ui.cat = '전체'; ui.onlyFav = false; ui.hideLearned = false;
      ui.order = WORDS.map(w => w.id);
      ui.pos = ui.order.indexOf(id);
      ui.revealed = true;
      setView('study');
    };
    r.addEventListener('click', e => { if (!e.target.closest('.row-speak')) open(); });
    r.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
  });
  el.querySelectorAll('.row-speak').forEach(b =>
    b.addEventListener('click', () => {
      const w = WORDS[+b.dataset.id];
      stopSpeech();
      speakSeq([{ text: w.w, lang: 'ko' }]);
    }));
}

// ---------------------------------------------------------------
// 퀴즈 화면
// ---------------------------------------------------------------
const QUIZ_N = 10;

function renderQuiz() {
  const el = views.quiz;
  const qz = ui.quiz;

  if (!qz) {
    const p = pool();
    el.innerHTML = `
      <div class="quiz-setup">
        <h2>퀴즈</h2>
        <p class="sub">현재 학습 필터(<b>${esc(ui.cat)}</b>${ui.onlyFav ? ' · ⭐' : ''}${ui.hideLearned ? ' · 안 외운 단어' : ''}) 기준 <b>${p.length}</b>개 단어에서 ${Math.min(QUIZ_N, p.length)}문제가 출제돼요.</p>
        <div class="quiz-types">
          <button class="quiz-type" data-type="k2e"><b>${ICONS.ab} 한국어 → 영어</b><span>한국어 단어를 보고 영어 뜻 고르기</span></button>
          <button class="quiz-type" data-type="e2k"><b>${ICONS.ab} 영어 → 한국어</b><span>영어 뜻을 보고 한국어 단어 고르기</span></button>
          <button class="quiz-type" data-type="listen"><b>${ICONS.ear} 듣기</b><span>발음을 듣고 영어 뜻 고르기</span></button>
        </div>
        ${p.length < 4 ? '<p class="quiz-note">⚠️ 퀴즈를 만들려면 필터에 단어가 4개 이상 필요해요.</p>' : ''}
      </div>`;
    el.querySelectorAll('.quiz-type').forEach(b =>
      b.addEventListener('click', () => startQuiz(b.dataset.type)));
    return;
  }

  if (qz.i >= qz.qs.length) {
    const wrong = qz.qs.filter(q => q.picked !== null && q.picked !== q.answer);
    el.innerHTML = `
      <div class="quiz-end">
        <h2>퀴즈 완료 🎉</h2>
        <div class="score">${qz.score} / ${qz.qs.length}</div>
        <p class="sub">${qz.score === qz.qs.length ? '완벽해요! 대단합니다 👏' : qz.score >= qz.qs.length * 0.7 ? '잘했어요! 틀린 단어만 다시 확인해 보세요.' : '틀린 단어를 학습 카드에서 복습해 보세요.'}</p>
        ${wrong.length ? `<ul class="wrong-list">${wrong.map(q =>
          `<li><b>${esc(q.w.w)}</b> ${esc(q.w.en)} <span style="color:var(--muted)">— ${esc(q.w.ko || '')}</span></li>`).join('')}</ul>` : ''}
        <div class="actions">
          <button class="ctrl-btn primary" id="quiz-retry">${ICONS.play} 다시 풀기</button>
          <button class="ctrl-btn" id="quiz-new">유형 바꾸기</button>
        </div>
      </div>`;
    $('#quiz-retry').addEventListener('click', () => startQuiz(qz.type));
    $('#quiz-new').addEventListener('click', () => { ui.quiz = null; renderQuiz(); });
    return;
  }

  const q = qz.qs[qz.i];
  const answered = q.picked !== null;
  const promptHtml =
    qz.type === 'k2e' ? `<h2 class="word">${esc(q.w.w)}</h2>${q.w.p ? `<div class="pron">[${esc(q.w.p)}]</div>` : ''}` :
    qz.type === 'e2k' ? `<div class="prompt-en">${esc(q.w.en)}</div><div class="listen-hint">${esc(q.w.def)}</div>` :
    `<button class="speak-btn" id="quiz-listen" title="다시 듣기">${ICONS.speaker}</button>
     <div class="listen-hint">${answered ? `<b>${esc(q.w.w)}</b>${q.w.p ? ` [${esc(q.w.p)}]` : ''}` : '🔊 버튼을 눌러 단어를 듣고 뜻을 고르세요.'}</div>`;

  el.innerHTML = `
    <div class="quiz-run">
      <div class="quiz-head">
        <span>${qz.i + 1} / ${qz.qs.length}</span>
        <span>점수 ${qz.score}</span>
      </div>
      <div class="quiz-q">${promptHtml}</div>
      <div class="quiz-opts">
        ${q.opts.map((o, i) => {
          const label = qz.type === 'e2k' ? o.w + (o.p ? ` [${o.p}]` : '') : o.en;
          let cls = '';
          if (answered) {
            if (i === q.answer) cls = 'correct';
            else if (i === q.picked) cls = 'wrong';
          }
          return `<button class="quiz-opt ${cls}" data-i="${i}" ${answered ? 'disabled' : ''}>${esc(label)}</button>`;
        }).join('')}
      </div>
      ${answered ? `
      <div class="quiz-after">
        <span class="info">${q.picked === q.answer ? '⭕ 정답!' : '❌ 오답'} — <b>${esc(q.w.w)}</b> : ${esc(q.w.en)}</span>
        <button class="ctrl-btn primary" id="quiz-next">${qz.i === qz.qs.length - 1 ? '결과 보기' : '다음 문제'} ${ICONS.next}</button>
      </div>` : ''}
    </div>`;

  const listenBtn = $('#quiz-listen');
  if (listenBtn) listenBtn.addEventListener('click', () => {
    stopSpeech();
    speakSeq([{ text: q.w.w, lang: 'ko' }]);
  });

  el.querySelectorAll('.quiz-opt').forEach(b =>
    b.addEventListener('click', () => {
      if (q.picked !== null) return;
      q.picked = +b.dataset.i;
      if (q.picked === q.answer) qz.score++;
      stopSpeech();
      speakSeq([{ text: q.w.w, lang: 'ko' }]); // 정답 확인과 함께 발음 들려주기
      renderQuiz();
    }));

  const nextBtn = $('#quiz-next');
  if (nextBtn) nextBtn.addEventListener('click', () => {
    qz.i++;
    stopSpeech();
    renderQuiz();
    const nq = qz.qs[qz.i];
    if (nq && qz.type === 'listen') speakSeq([{ text: nq.w.w, lang: 'ko' }]);
  });
}

function startQuiz(type) {
  const p = pool();
  if (p.length < 4) return;
  const qs = sample(p, Math.min(QUIZ_N, p.length)).map(w => {
    const others = sample(WORDS.filter(x => x.id !== w.id && x.en !== w.en), 3);
    const opts = shuffleArr([w, ...others]);
    return { w, opts, answer: opts.indexOf(w), picked: null };
  });
  ui.quiz = { type, qs, i: 0, score: 0 };
  renderQuiz();
  if (type === 'listen') speakSeq([{ text: qs[0].w.w, lang: 'ko' }]);
}

// ---------------------------------------------------------------
// 설정 화면
// ---------------------------------------------------------------
function renderSettings() {
  const el = views.settings;
  const koVoices = TTS.list('ko');
  const enVoices = TTS.list('en');
  const koSel = TTS.ko();
  const enSel = TTS.en();

  el.innerHTML = `
    <div class="settings-grid">
      <div class="setting-card">
        <h3>낭독 (TTS)</h3>
        <p class="hint">브라우저에 설치된 음성을 사용해요. 한국어 음성은 Chrome·Edge·Safari에서 가장 자연스럽습니다.</p>
        <div class="setting-row">
          <label class="grow" for="set-rate">한국어 낭독 속도</label>
          <input type="range" id="set-rate" min="0.6" max="1.4" step="0.05" value="${settings.rate}">
          <span class="rate-val">${settings.rate.toFixed(2)}×</span>
        </div>
        <div class="setting-row">
          <label class="grow" for="set-ko-voice">한국어 음성</label>
          <select id="set-ko-voice" ${koVoices.length ? '' : 'disabled'}>
            ${koVoices.length
              ? koVoices.map(v => `<option value="${esc(v.name)}" ${koSel && v.name === koSel.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')
              : '<option>한국어 음성이 없어요</option>'}
          </select>
        </div>
        <div class="setting-row">
          <label class="grow" for="set-en-voice">영어 음성</label>
          <select id="set-en-voice" ${enVoices.length ? '' : 'disabled'}>
            ${enVoices.length
              ? enVoices.map(v => `<option value="${esc(v.name)}" ${enSel && v.name === enSel.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')
              : '<option>영어 음성이 없어요</option>'}
          </select>
        </div>
        <div class="setting-row">
          <span class="grow">미리 듣기</span>
          <button class="ctrl-btn" id="btn-preview">${ICONS.speaker} 안녕하세요 / Hello</button>
        </div>
      </div>

      <div class="setting-card">
        <h3>학습 방식</h3>
        <div class="setting-row">
          <label class="grow" for="set-autoread">카드를 넘길 때 단어 자동 낭독</label>
          <span class="switch"><input type="checkbox" id="set-autoread" ${settings.autoRead ? 'checked' : ''}><i></i></span>
        </div>
        <div class="setting-row">
          <label class="grow" for="set-readen">자동 읽기에 영어 해설 포함</label>
          <span class="switch"><input type="checkbox" id="set-readen" ${settings.readEn ? 'checked' : ''}><i></i></span>
        </div>
        <div class="setting-row">
          <label class="grow" for="set-cont">연속 재생 (자동으로 다음 카드로)</label>
          <span class="switch"><input type="checkbox" id="set-cont" ${settings.cont ? 'checked' : ''}><i></i></span>
        </div>
        <div class="setting-row">
          <label class="grow" for="set-showko">한국어 뜻풀이 함께 표시</label>
          <span class="switch"><input type="checkbox" id="set-showko" ${settings.showKo ? 'checked' : ''}><i></i></span>
        </div>
      </div>

      <div class="setting-card">
        <h3>학습 현황</h3>
        <div class="stat-chips">
          <span class="stat-chip">전체 단어 <b>${WORDS.length}</b></span>
          <span class="stat-chip">외운 단어 <b>${learned.size}</b></span>
          <span class="stat-chip">즐겨찾기 <b>${fav.size}</b></span>
        </div>
        <div class="cat-progress">
          ${CATS.slice(1).map(c => {
            const ws = WORDS.filter(w => w.cat === c);
            const n = ws.filter(w => learned.has(w.id)).length;
            const pct = ws.length ? Math.round(n / ws.length * 100) : 0;
            return `
            <div class="cat-progress-row">
              <span class="cat-name">${esc(c)}</span>
              <div class="pbar"><i style="width:${pct}%"></i></div>
              <span class="cat-count">${n}/${ws.length}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="setting-row" style="margin-top:10px">
          <span class="grow">진도 초기화 (외운 단어·즐겨찾기 삭제)</span>
          <button class="danger-btn" id="btn-reset">초기화</button>
        </div>
      </div>

      <div class="setting-card">
        <h3>데이터 출처</h3>
        <p class="hint" style="margin-bottom:0">
          어휘 등급 기준: 국립국어원 <a href="https://krdict.korean.go.kr" target="_blank" rel="noopener">한국어기초사전</a>의 등급별 어휘(중급) 분류 ·
          뜻풀이와 예문은 본 앱에서 학습용으로 작성했습니다.
          <code>scripts/fetch-krdict.mjs</code>로 오픈 API에서 단어를 추가할 수 있어요(README 참고).
        </p>
      </div>
    </div>`;

  $('#set-rate').addEventListener('input', e => {
    settings.rate = +e.target.value;
    el.querySelector('.rate-val').textContent = settings.rate.toFixed(2) + '×';
    persist();
  });
  $('#set-ko-voice').addEventListener('change', e => { settings.koVoice = e.target.value; persist(); });
  $('#set-en-voice').addEventListener('change', e => { settings.enVoice = e.target.value; persist(); });
  $('#btn-preview').addEventListener('click', () => {
    stopSpeech();
    speakSeq([
      { text: '안녕하세요. 만나서 반갑습니다.', lang: 'ko' },
      { text: 'Hello, nice to meet you.', lang: 'en' }
    ]);
  });
  $('#set-autoread').addEventListener('change', e => { settings.autoRead = e.target.checked; persist(); });
  $('#set-readen').addEventListener('change', e => { settings.readEn = e.target.checked; persist(); });
  $('#set-cont').addEventListener('change', e => { settings.cont = e.target.checked; persist(); });
  $('#set-showko').addEventListener('change', e => { settings.showKo = e.target.checked; persist(); });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('외운 단어와 즐겨찾기 기록을 모두 지울까요?')) return;
    fav.clear(); learned.clear(); persist();
    renderSettings();
  });
}

// ---------------------------------------------------------------
// 키보드
// ---------------------------------------------------------------
document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  if (ui.view !== 'study') return;
  const w = cur();
  switch (e.key) {
    case 'ArrowLeft': e.preventDefault(); move(-1); break;
    case 'ArrowRight': e.preventDefault(); move(1); break;
    case ' ': e.preventDefault(); toggleReveal(); break;
    case 'p': case 'P':
      if (w) { stopSpeech(); speakSeq([{ text: w.w, lang: 'ko', el: $('#el-word') }]); }
      break;
    case 'a': case 'A': ui.playing ? stopSpeech() : playCard(); break;
    case 'f': case 'F': if (w) { toggleFav(w.id); renderStudy(); } break;
    case 'l': case 'L': if (w) { toggleLearned(w.id); renderStudy(); } break;
  }
});

// ---------------------------------------------------------------
// 오프라인 지원 (서비스 워커는 https 또는 localhost에서만 동작)
// ---------------------------------------------------------------
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 미지원/실패 시 온라인 전용으로 동작 */ });
}

// ---------------------------------------------------------------
// 시작
// ---------------------------------------------------------------
ui.order = WORDS.map(w => w.id);
renderStudy();

})();
