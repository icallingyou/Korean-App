/* =============================================================
   background.js — 확장 서비스 워커
   - 동기화 데이터가 바뀌면, 이미 열려 있는 플래너 탭에도 브리지를 주입해
     (확장 설치 전에 열어 둔 탭 포함) 새로고침 없이 전달되게 한다.
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.lastSync || changes.searchTemplate)) pushToPlannerTabs();
});
chrome.runtime.onInstalled.addListener(() => { pushToPlannerTabs(); });
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'LRP_PUSH_PLANNER') return false;
  pushToPlannerTabs().then(n => sendResponse({ tabs: n })).catch(() => sendResponse({ tabs: 0 }));
  return true;
});
