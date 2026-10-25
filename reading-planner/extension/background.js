/* =============================================================
   background.js — 확장 서비스 워커
   - 동기화 데이터가 바뀌면, 이미 열려 있는 플래너 탭에도 브리지를 주입해
     (확장 설치 전에 열어 둔 탭 포함) 새로고침 없이 전달되게 한다.
   - 플래너의 요청으로 교보문고에서 책의 쪽수·표지를 찾아 준다
     (웹페이지는 CORS 때문에 직접 조회할 수 없어 확장이 대신 조회).
   ============================================================= */
const PLANNER_URLS = [
  'https://icallingyou.github.io/Korean-App/reading-planner/*',
  'http://localhost/*reading-planner*',
  'http://127.0.0.1/*reading-planner*'
];

async function pushToPlannerTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: PLANNER_URLS }); } catch (_) { return 0; }
  let n = 0;
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      // 이미 주입돼 있으면 스크립트 안의 가드가 중복 초기화를 막고,
      // 기존 storage.onChanged 리스너가 최신 데이터를 보낸다.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-planner.js'] });
      n++;
    } catch (_) { /* 닫히는 중인 탭 등 */ }
  }
  return n;
}

// ---------- 교보문고 조회 ----------
const kyoboCache = new Map();
const normT = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function mainTitle(title) {
  return String(title || '').replace(/\s*(\.{3}|…)\s*$/, '').split(/\s[:=]\s|\s\/\s/)[0].replace(/[.:]\s*$/, '').trim();
}
async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: ctrl.signal, headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}
function metaContent(html, prop) {
  const tag = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*>', 'i'));
  if (!tag) return '';
  const c = tag[0].match(/content=["']([^"']*)["']/i);
  return c ? c[1] : '';
}
function pickPages(html) {
  const pats = [
    /"numberOfPages"\s*:\s*"?(\d{2,4})/,
    /"pageCnt"\s*:\s*"?(\d{2,4})/,
    /"page_cnt"\s*:\s*"?(\d{2,4})/,
    /쪽수[\s\S]{0,120}?(\d{2,4})\s*쪽/,
    /(\d{2,4})\s*쪽(?![\p{L}])/u,
    /(\d{2,4})\s*(?:p|pages)\b/i
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m) { const n = +m[1]; if (n >= 20 && n <= 5000) return n; }
  }
  return null;
}
/**
 * 교보문고 검색 → 상세 페이지에서 쪽수·표지를 찾는다. 실패 시 null.
 * @returns {Promise<null|{pages:number|null, coverUrl:string, url:string, title:string, source:'kyobo'}>}
 */
async function kyoboLookup(title, author) {
  const main = mainTitle(title);
  if (!main) return null;
  const key = main + '|' + (author || '');
  if (kyoboCache.has(key)) return kyoboCache.get(key);
  let result = null;
  try {
    const q = author && /[ㄱ-힝]/.test(author) ? `${main} ${author.split(/[,/]/)[0].trim()}` : main;
    const html = await fetchText(`https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(q)}&gbCode=TOT&target=total`);
    let ids = [...new Set([...html.matchAll(/detail\/(S\d{9,})/g)].map(m => m[1]))];
    if (!ids.length && q !== main) {
      const html2 = await fetchText(`https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(main)}&gbCode=TOT&target=total`);
      ids = [...new Set([...html2.matchAll(/detail\/(S\d{9,})/g)].map(m => m[1]))];
    }
    const want = normT(main);
    for (const id of ids.slice(0, 4)) {
      let page;
      try { page = await fetchText(`https://product.kyobobook.co.kr/detail/${id}`); } catch (_) { continue; }
      const ogTitle = metaContent(page, 'og:title') || (page.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
      const got = normT(ogTitle.split('|')[0]);
      if (want.length >= 2 && got && !(got.includes(want) || want.includes(got))) continue; // 다른 책
      const pages = pickPages(page);
      const coverUrl = metaContent(page, 'og:image');
      if (pages || coverUrl) { result = { pages, coverUrl, url: `https://product.kyobobook.co.kr/detail/${id}`, title: ogTitle.split('|')[0].trim(), source: 'kyobo' }; break; }
    }
  } catch (_) { result = null; }
  kyoboCache.set(key, result);
  return result;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.lastSync || changes.searchTemplate)) pushToPlannerTabs();
});
chrome.runtime.onInstalled.addListener(() => { pushToPlannerTabs(); });
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'LRP_PUSH_PLANNER') {
    pushToPlannerTabs().then(n => sendResponse({ tabs: n })).catch(() => sendResponse({ tabs: 0 }));
    return true;
  }
  if (msg.type === 'LRP_LOOKUP') {
    kyoboLookup(msg.title, msg.author).then(result => sendResponse({ result })).catch(() => sendResponse({ result: null }));
    return true;
  }
  return false;
});
