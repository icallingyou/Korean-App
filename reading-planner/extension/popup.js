/* popup.js — 확장 팝업 */
const PLANNER_URL = 'https://icallingyou.github.io/Korean-App/reading-planner/';

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

$('#open').addEventListener('click', () => chrome.tabs.create({ url: PLANNER_URL }));

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
    if (res && res.count) show(`Found ${res.count} checked-out item${res.count > 1 ? 's' : ''}. Open the planner to see your plan.`);
    else show('No due dates found on this page. Open your library account’s “Checked Out” page and try again.', true);
  } catch (_) {
    show('Cannot read this page. Open your library’s “Checked Out” page in this tab and try again.', true);
  } finally {
    btn.disabled = false;
    refresh();
  }
});

chrome.storage.onChanged.addListener(refresh);
refresh();
