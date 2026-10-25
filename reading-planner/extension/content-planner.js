/* =============================================================
   content-planner.js — 플래너 웹앱 페이지에서 실행되는 브리지
   chrome.storage(확장) → window.postMessage → 플래너 페이지
   (manifest의 content_scripts로 자동 주입되거나, background.js가
    이미 열려 있던 탭에 뒤늦게 주입하기도 한다)
   ============================================================= */
(() => {
  'use strict';
  if (window.__lrpPlannerBridge) return;
  window.__lrpPlannerBridge = true;

  function hello() { window.postMessage({ type: 'LRP_HELLO', from: 'extension' }, '*'); }

  function send() {
    hello();
    chrome.storage.local.get(['lastSync', 'searchTemplate'], d => {
      if (chrome.runtime.lastError) return;
      if (!d.lastSync && !d.searchTemplate) return;
      const payload = Object.assign({ items: [] }, d.lastSync || {}, { searchTemplate: d.searchTemplate || '' });
      window.postMessage({ type: 'LRP_SYNC', payload, from: 'extension' }, '*');
    });
  }

  // 페이지가 요청하면 보내고, 저장소가 바뀌면 다시 보냄
  window.addEventListener('message', e => {
    if (e.source === window && e.data && e.data.type === 'LRP_SYNC_REQUEST') send();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.lastSync || changes.searchTemplate)) send();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(send, 300));
  else setTimeout(send, 300);
})();
