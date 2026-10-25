/* =============================================================
   content-planner.js — 플래너 웹앱 페이지에서 실행되는 브리지
   chrome.storage(확장) → window.postMessage → 플래너 페이지
   플래너의 책 조회 요청(LRP_LOOKUP) → 백그라운드(교보문고) → 결과 전달
   (manifest의 content_scripts로 자동 주입되거나, background.js가
    이미 열려 있던 탭에 뒤늦게 주입하기도 한다)
   ============================================================= */
(() => {
  'use strict';
  if (window.__lrpPlannerBridge) return;
  window.__lrpPlannerBridge = true;

  const VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
  function hello() { window.postMessage({ type: 'LRP_HELLO', from: 'extension', version: VERSION, caps: ['lookup'] }, '*'); }

  function send() {
    hello();
    chrome.storage.local.get(['lastSync', 'searchTemplate'], d => {
      if (chrome.runtime.lastError) return;
      if (!d.lastSync && !d.searchTemplate) return;
      const payload = Object.assign({ items: [] }, d.lastSync || {}, { searchTemplate: d.searchTemplate || '' });
      window.postMessage({ type: 'LRP_SYNC', payload, from: 'extension' }, '*');
    });
  }

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'LRP_SYNC_REQUEST') send();
    else if (e.data.type === 'LRP_LOOKUP' && e.data.id) {
      const id = e.data.id;
      try {
        chrome.runtime.sendMessage({ type: 'LRP_LOOKUP', title: e.data.title, author: e.data.author }, res => {
          const result = (!chrome.runtime.lastError && res && res.result) ? res.result : null;
          window.postMessage({ type: 'LRP_LOOKUP_RESULT', id, result, from: 'extension' }, '*');
        });
      } catch (_) {
        window.postMessage({ type: 'LRP_LOOKUP_RESULT', id, result: null, from: 'extension' }, '*');
      }
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.lastSync || changes.searchTemplate)) send();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(send, 300));
  else setTimeout(send, 300);
})();
