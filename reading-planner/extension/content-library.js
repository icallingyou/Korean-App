/* =============================================================
   content-library.js — 도서관 사이트에서 실행되는 콘텐츠 스크립트
   - "대출 중(Checked Out)" 페이지의 제목·반납일을 읽어 chrome.storage에 저장
   - 카탈로그 검색 결과 URL에서 검색 주소 템플릿({q})을 자동 감지
   - 비밀번호·개인정보는 읽거나 저장하지 않음 (제목/저자/반납일만)
   ============================================================= */
(() => {
  'use strict';
  if (window.__lrpLibraryLoaded) return; // 팝업에서 다시 주입돼도 한 번만 초기화
  window.__lrpLibraryLoaded = true;

  const P = self.CheckoutParser;
  if (!P) return;

  const ACCOUNT_TEXT_RE = /\b(checked\s*out|checkouts?|items?\s+out|on\s+loan|my\s+account|borrowed)\b/i;
  let lastSignature = '';

  function collect() {
    try { return P.parseCheckoutsFromDocument(document); } catch (_) { return []; }
  }

  function storeItems(items) {
    const payload = { items, syncedAt: Date.now(), sourceUrl: location.href, sourceHost: location.host };
    return chrome.storage.local.set({ lastSync: payload });
  }

  function rememberSearchTemplate() {
    const tpl = P.detectSearchTemplate(location.href);
    if (tpl) chrome.storage.local.set({ searchTemplate: tpl, searchTemplateHost: location.host });
  }

  function pageLooksLikeAccount() {
    if (P.looksLikeCheckoutsUrl(location.href)) return true;
    const head = ((document.title || '') + ' ' + (document.body ? (document.body.innerText || '').slice(0, 4000) : ''));
    return ACCOUNT_TEXT_RE.test(head);
  }

  // 자동 수집: SPA 렌더링을 기다리며 최대 30초간 DOM 변화를 관찰
  let observer = null, stopTimer = 0, debounce = 0;
  function attempt(force) {
    if (!force && !pageLooksLikeAccount()) return;
    const items = collect();
    if (!items.length) return;
    const sig = JSON.stringify(items.map(i => [i.title, i.due]));
    if (sig === lastSignature) return;
    lastSignature = sig;
    storeItems(items);
  }
  function arm() {
    disarm();
    rememberSearchTemplate();
    attempt(false);
    if (!document.body) return;
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

  // SPA 주소 변경 감지 (pushState는 이벤트가 없으므로 주기적으로 비교)
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; lastSignature = ''; arm(); }
  }, 1500);
  window.addEventListener('popstate', () => { lastSignature = ''; arm(); });

  // 팝업의 "지금 동기화" 요청
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'LRP_PARSE_NOW') return false;
    const items = collect();
    rememberSearchTemplate();
    const done = items.length ? storeItems(items) : Promise.resolve();
    done.then(() => sendResponse({ count: items.length, items: items.slice(0, 50) }))
        .catch(() => sendResponse({ count: items.length, items: items.slice(0, 50) }));
    return true; // 비동기 응답
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm);
  else arm();
})();
