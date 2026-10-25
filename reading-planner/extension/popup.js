/* popup.js — 확장 팝업 */
const PLANNER_URL = 'https://icallingyou.github.io/Korean-App/reading-planner/';
const PLANNER_PATTERNS = [PLANNER_URL + '*', 'http://localhost/*reading-planner*', 'http://127.0.0.1/*reading-planner*'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rel(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
function fmtDue(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function show(msg, warn) { const el = $('#msg'); el.textContent = msg; el.hidden = false; el.classList.toggle('warn', !!warn); }

async function refresh() {
  const d = await chrome.storage.local.get(['lastSync', 'searchTemplate']);
  const s = d.lastSync;
  $('#status-line').textContent = s ? `Last sync ${rel(s.syncedAt)} · ${s.items.length} items · ${s.sourceHost || ''}` : 'Not synced yet';
  const ul = $('#items');
  ul.innerHTML = s && s.items.length
    ? s.items.map(i => `<li><b title="${esc(i.title)}">${esc(i.title)}</b><span>${esc(fmtDue(i.due))}${i.overdue ? ' ⚠️' : ''}</span></li>`).join('')
    : '<li class="muted">Nothing synced yet.</li>';
}

$('#open').addEventListener('click', async () => {
  // 이미 열린 플래너 탭이 있으면 그 탭으로 가서 최신 데이터를 밀어 넣고, 없으면 새로 연다
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: PLANNER_PATTERNS }); } catch (_) { /* ignore */ }
  if (tabs.length) {
    const tab = tabs[0];
    try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) { /* ignore */ }
    try { await chrome.runtime.sendMessage({ type: 'LRP_PUSH_PLANNER' }); } catch (_) { /* ignore */ }
  } else {
    chrome.tabs.create({ url: PLANNER_URL });
  }
});

$('#copy-text').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.body.innerText });
    await navigator.clipboard.writeText(res && res.result ? res.result : '');
    show('Page text copied. Paste it into the planner’s “Import from library” box, or send it for troubleshooting (remove personal details first).');
  } catch (_) {
    show('Could not read this page.', true);
  }
});

$('#sync').addEventListener('click', async () => {
  const btn = $('#sync');
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('no tab');
    // 콘텐츠 스크립트가 아직 없으면(다른 도서관 도메인 등) activeTab 권한으로 주입
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['parse-checkouts.js', 'content-library.js'] });
    } catch (_) { /* chrome:// 등 주입 불가 페이지 */ }
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'LRP_PARSE_NOW' });
    if (res && res.count) {
      show(`Found ${res.count} checked-out item${res.count > 1 ? 's' : ''}. Open the planner to see your plan.`);
      try { await chrome.runtime.sendMessage({ type: 'LRP_PUSH_PLANNER' }); } catch (_) { /* ignore */ }
    }
    else show('No due dates found on this page. Open your library account’s “Checked Out” page and try again.', true);
  } catch (_) {
    show('Cannot read this page. Open your library’s “Checked Out” page in this tab and try again.', true);
  } finally {
    btn.disabled = false;
    refresh();
  }
});

$('#test-lookup').addEventListener('click', async () => {
  const title = $('#test-title').value.trim();
  const out = $('#test-result');
  if (!title) return;
  out.hidden = false; out.textContent = 'Looking up…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'LRP_LOOKUP', title, author: '' });
    out.textContent = res && res.result ? JSON.stringify(res.result, null, 1) : 'Not found (null) — Kyobo returned no usable result for this title.';
  } catch (e) {
    out.textContent = 'Error: ' + (e && e.message ? e.message : e);
  }
});

chrome.storage.onChanged.addListener(refresh);
refresh();
