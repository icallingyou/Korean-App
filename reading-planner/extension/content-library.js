/* =============================================================
   content-library.js — 도서관 사이트에서 실행되는 콘텐츠 스크립트
   - "대출 중(Checked Out)" 페이지의 제목·반납일을 읽어 chrome.storage에 저장
     (자동 수집은 주소가 대출 중 페이지일 때만; 팝업의 "Sync this page now"는 어디서나)
   - 카탈로그 검색 결과 URL에서 검색 주소 템플릿({q})을 자동 감지
   - 비밀번호·개인정보는 읽거나 저장하지 않음 (제목/저자/반납일 + 바코드를 지운 페이지 텍스트)
   ============================================================= */
(() => {
  'use strict';
  if (window.__lrpLibraryLoaded) return; // 팝업에서 다시 주입돼도 한 번만 초기화
  window.__lrpLibraryLoaded = true;

  const P = self.CheckoutParser;
  if (!P) return;

  let lastSignature = '';
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };

  function collect() {
    try { return P.parseCheckoutsFromDocument(document); } catch (_) { return []; }
  }

  function scrubText(text) {
    // 바코드·카드번호 같은 긴 숫자열과 이메일은 저장 전에 지운다
    return String(text || '').replace(/\b\d{10,}\b/g, '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '').slice(0, 300000);
  }

  function storeItems(items) {
    if (!alive()) return Promise.resolve();
    let pageText = '';
    try { pageText = scrubText(document.body.innerText || ''); } catch (_) { /* ignore */ }
    const payload = { items, syncedAt: Date.now(), sourceUrl: location.href, sourceHost: location.host, pageText };
    return chrome.storage.local.set({ lastSync: payload });
  }

  function rememberSearchTemplate() {
    if (!alive()) return;
    const tpl = P.detectSearchTemplate(location.href);
    if (tpl) chrome.storage.local.set({ searchTemplate: tpl, searchTemplateHost: location.host });
  }

  // 자동 수집: 대출 중 페이지에서만, SPA 렌더링을 기다리며 최대 30초간 DOM 변화를 관찰
  let observer = null, stopTimer = 0, debounce = 0, poll = 0;
  function attempt(force) {
    if (!force && !P.looksLikeCheckoutsUrl(location.href)) return;
    const items = collect();
    if (!items.length) return;
    const sig = JSON.stringify(items.map(i => [i.title, i.due]));
    if (sig === lastSignature) return;
    lastSignature = sig;
    storeItems(items);
  }
  function arm() {
    disarm();
    if (!alive()) { clearInterval(poll); return; }
    rememberSearchTemplate();
    attempt(false);
    if (!document.body || !P.looksLikeCheckoutsUrl(location.href)) return;
    observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => attempt(false), 800);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    stopTimer = setTimeout(disarm, 30000);
  }
  function disarm() {
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(stopTimer); clearTimeout(debounce);
  }

  // SPA 주소 변경 감지 (pushState는 이벤트가 없으므로 주기적으로 비교), 탭으로 돌아올 때 다시 수집
  let lastHref = location.href;
  poll = setInterval(() => {
    if (!alive()) { clearInterval(poll); disarm(); return; }
    if (location.href !== lastHref) { lastHref = location.href; lastSignature = ''; arm(); }
  }, 1500);
  window.addEventListener('popstate', () => { lastSignature = ''; arm(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastSignature = ''; arm(); } });
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('button, a, input[type=submit]');
    if (b && /renew/i.test(b.textContent || b.value || '')) setTimeout(() => { lastSignature = ''; arm(); }, 2500);
  }, true);

  // 팝업의 "지금 동기화" 요청 (어느 페이지에서든 강제 수집)
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== 'LRP_PARSE_NOW') return false;
      const items = collect();
      rememberSearchTemplate();
      const done = items.length ? storeItems(items) : Promise.resolve();
      done.then(() => sendResponse({ count: items.length, items: items.slice(0, 50) }))
          .catch(() => sendResponse({ count: items.length, items: items.slice(0, 50) }));
      return true; // 비동기 응답
    });
  } catch (_) { /* 확장이 다시 로드된 경우 */ }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm);
  else arm();
})();
