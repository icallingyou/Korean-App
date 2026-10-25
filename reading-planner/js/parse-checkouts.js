/* =============================================================
   parse-checkouts.js — 도서관 "대출 중(Checked out)" 페이지 파서
   -------------------------------------------------------------
   - 특정 도서관 시스템의 DOM 구조에 의존하지 않고, 화면 텍스트에서
     "제목 → (저자) → (형식/상태) → 반납일" 패턴을 찾아냅니다.
   - 검증된 레이아웃: 퀸즈 공공도서관(queenslibrary.org/my-account/checkouts),
     Vega Discover, BiblioCommons, 표 형태, 마크다운 복사본.
   - 웹앱(붙여넣기 가져오기)과 크롬 확장(콘텐츠 스크립트)이 공유합니다.
   - 브라우저(window) / 확장 / Node(테스트) 어디서든 동작하도록 UMD 형태.
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CheckoutParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };
  const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  const WD = '(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?';
  // 날짜 표기 패턴 (연도 있는 것 → 없는 것 순서)
  const DATE_SRC =
    WD + '(?:' +
    MON + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}' +        // Nov 14, 2026 / November 14 2026 / Oct 08, 2026
    '|\\d{1,2}(?:st|nd|rd|th)?\\s+' + MON + ',?\\s+\\d{4}' +  // 14 Nov 2026
    '|\\d{1,2}/\\d{1,2}/\\d{2,4}' +                            // 11/14/2026
    '|\\d{4}-\\d{2}-\\d{2}' +                                  // 2026-11-14
    '|' + MON + '\\s+\\d{1,2}(?:st|nd|rd|th)?(?![\\d/])' +     // Nov 14 (연도 없음)
    ')';
  const DATE_RE = new RegExp(DATE_SRC, 'i');
  const DATE_ONLY_RE = new RegExp('^' + DATE_SRC + '$', 'i');
  const DUE_WORD_RE = /\b(due|return(?:\s+by)?|expires?)\b/i;
  const RELATIVE_RE = /\bdue\b[^\n]*?\b(today|tomorrow|in\s+(\d+)\s+days?)\b/i;
  const DAYS_ONLY_RE = /^(\d+)\s+days?(\s+overdue|\s+late)?$/i;
  const OVERDUE_RE = /\b(overdue|past\s+due|assumed\s+lost|lost|billed)\b/i;

  // 버튼·내비게이션 등 제목이 될 수 없는 짧은 줄
  const NOISE_RE = /^(renew(\s+all|\s+now|\s+selected)?|renewed|place\s+(a\s+)?hold|hold|return|details|more|save|share|select(\s+all)?|check(ed)?\s*out(\s*\(\d+\))?|checkouts?(\s*\(\d+\))?|items?\s+out|on\s+loan|loans?|sort\s+by.*|filter|download|read\s+online|borrow|learn\s+more|log\s*out|sign\s*out|my\s+account|my\s+checked\s+out|account(\s+overview)?|home|search|menu|close|back|next|previous|page\s+\d+|\d+|\d+\s+items?|due\s+(first|last)|checked\s+out\s+(first|last)|view\s+a\s+list.*|fees|messages|requests|wishlist)$/i;
  // 대출 항목의 부가 정보 줄 (제목 후보에서 제외)
  const META_RE = /^(renewal|renewals?\s+(left|remaining)|times?\s+renewed|you\s+have\s+renewed|why\s+can'?t\s+i\s+renew|\(?checked\s+out\b|barcode|item\s+(id|barcode|number)|call\s+(number|no)|copy|status|borrowed|loaned?\s+on|from|branch|location|pickup|library:|requested|expires?|hold\s+position|not\s+renewable|renewable|can\s+be\s+renewed|cannot\s+be\s+renewed|auto[- ]renew|\d+\s+days?\b|\d+\s+of\s+\d+)/i;
  // 대출 상태 라벨 (한 줄 전체) — 절대 제목이 되지 않음
  const STATUS_RE = /^(overdue|past\s+due|due\s+soon|assumed\s+lost|lost(\s+and\s+paid)?|billed|checked\s+out|on\s+loan|in\s+transit|on\s+hold|ready\s+for\s+pickup|requested\s+by\s+another\s+(customer|patron|user|borrower)|requested|not\s+renewable|renewable|renewed(\s+\d+\s+times?)?|returned|claimed\s+returned|on\s+time|late|available|unavailable)[.!]?$/i;
  const FORMAT_RE = /^(book|print\s+book|e-?book|e-?audiobook|audiobook|audio\s*book|large\s+print|dvd|blu-?ray|cd|music\s+cd|magazine|graphic\s+novel|comic|paperback|hardcover|kindle|video\s*game|board\s+book|manga|playaway|kit|map)\b/i;
  const FORMAT_SUFFIX_RE = /\s*(book|print\s+book|e-?book|e-?audiobook|audiobook|large\s+print|dvd|blu-?ray|cd|magazine|graphic\s+novel|paperback|hardcover|kindle|playaway|kit)\.?$/i;
  const AUTHOR_BY_RE = /^by\s+(.+)$/i;
  // "Haig, Matt" / "Haig, Matt, 1975-" 같은 '성, 이름' 형태 (라틴 문자)
  const AUTHOR_LAST_FIRST_RE = /^[A-Z][\w'’.\- ]{1,40},\s+[A-Z][\w'’.\- ]{1,40}(?:,\s*[\d\s\-–]+)?\.?$/;
  const NO_LETTERS_RE = /^[^\p{L}\p{N}]*$/u;
  const CJK_RE = /[ㄱ-힝一-鿿぀-ヿ]/;
  const ELLIPSIS_RE = /\s*(\.{3}|…)\s*$/;
  const NO_RENEW_RE = /why\s+can'?t\s+i\s+renew|requested\s+by\s+another|not\s+renewable|cannot\s+be\s+renewed|\((\d+)\s+of\s+\1\s+allowed\)/i;

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  function todayISO(now) {
    const d = now || new Date();
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function addDaysISO(isoStr, n) {
    const [y, m, d] = isoStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function diffDaysISO(a, b) {
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  }

  /** 문자열 속 첫 날짜를 YYYY-MM-DD로. 연도가 없으면 오늘 기준 가장 가까운 '앞으로의' 해로 추정. */
  function parseDueDate(str, now) {
    if (!str) return null;
    const m = DATE_RE.exec(str);
    if (!m) return null;
    const s = m[0].replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '').trim();
    let y, mo, d, r;

    if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +r[1]; mo = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) {
      mo = +r[1]; d = +r[2]; y = +r[3]; if (y < 100) y += 2000;
    }
    else if ((r = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s))) {
      mo = MONTHS[r[1].toLowerCase()]; d = +r[2]; y = +r[3];
    }
    else if ((r = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(s))) {
      d = +r[1]; mo = MONTHS[r[2].toLowerCase()]; y = +r[3];
    }
    else if ((r = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/i.exec(s))) {
      mo = MONTHS[r[1].toLowerCase()]; d = +r[2];
      const today = todayISO(now);
      y = +today.slice(0, 4);
      // 60일 이상 지난 날짜라면 내년으로 간주 (대출 반납일은 보통 앞으로의 날짜)
      if (validDate(y, mo, d) && diffDaysISO(today, iso(y, mo, d)) < -60) y += 1;
    }
    if (!mo || !validDate(y, mo, d)) return null;
    return iso(y, mo, d);
  }

  function parseRelativeDue(line, now) {
    const r = RELATIVE_RE.exec(line);
    if (!r) return null;
    const today = todayISO(now);
    if (/today/i.test(r[1])) return today;
    if (/tomorrow/i.test(r[1])) return addDaysISO(today, 1);
    if (r[2]) return addDaysISO(today, +r[2]);
    return null;
  }

  function stripMarkdown(s) {
    return s
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // [text](url) → text
      .replace(/^\s*[-*•]\s+/, '')               // 목록 기호
      .replace(/^#+\s+/, '');                    // 제목 기호
  }
  function normKey(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }

  function cleanTitle(s) {
    let t = String(s).replace(/\s+/g, ' ').replace(/^(title:?\s*)/i, '').trim();
    // "한글 제목 / Romanized title" 병기 → 앞부분만
    if (t.includes(' / ')) {
      const first = t.split(' / ')[0].trim();
      if (CJK_RE.test(first) && first.length >= 2) t = first;
    }
    return t.replace(/\s*[\[(](e-?book|audiobook|large print|book|dvd)[\])]\s*$/i, '').replace(/\s*[:/]\s*$/, '').trim();
  }
  function cleanAuthor(s) {
    let a = String(s).replace(/^by\s+/i, '').trim();
    if (a.includes(' / ')) a = a.split(' / ')[0];                 // "한 강, 1970- / Han, Kang, 1970-" → 앞부분
    a = a.replace(/\s*\([^)]*\)/g, '');                            // (Viktor Emil), (Cultural commentator)
    // 역할어 제거: 끝에 오는 "…, author." / "… author." 와 쉼표 뒤의 "…, author, …" (성이 "Author"인 경우 보호)
    const ROLE = '(author|illustrator|narrator|editor|translator|compiler|contributor|photographer)';
    a = a.replace(new RegExp('(,\\s*|\\s+)' + ROLE + '\\b\\.?$', 'i'), '');
    a = a.replace(new RegExp(',\\s*' + ROLE + '\\b\\.?(?=,|$)', 'gi'), '');
    a = a.replace(/,?\s*\b\d{4}\s*[-–]\s*(\d{4})?\.?/g, '');        // 1970- / 1905-1997
    a = a.replace(/\s+/g, ' ').replace(/[,\s]+$/, '');
    if (/\.$/.test(a) && !/(^|[\s,])[A-Z]\.$/.test(a)) a = a.slice(0, -1); // 끝 마침표 제거 (이니셜 "E."은 유지)
    return a.trim();
  }

  function isAuthorLike(line) { return AUTHOR_BY_RE.test(line) || AUTHOR_LAST_FIRST_RE.test(line); }
  function isDateLike(line) { return DATE_ONLY_RE.test(line) || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(line); }
  function isStatus(line) { return STATUS_RE.test(line); }
  function isNoise(line) { return line.length < 2 || NO_LETTERS_RE.test(line) || NOISE_RE.test(line) || META_RE.test(line) || isStatus(line); }
  function isTitleCandidate(line) {
    return !(isNoise(line) || isAuthorLike(line) || FORMAT_RE.test(line) || isDateLike(line) || line.length > 200);
  }

  /** 텍스트를 줄 단위로 정리 (탭으로 구분된 표 셀은 각각 한 줄로, 마크다운 링크는 텍스트만). */
  function toLines(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      for (const cell of raw.split('\t')) {
        const s = stripMarkdown(cell.replace(/ /g, ' ')).trim();
        if (s) out.push(s);
      }
    }
    return out;
  }

  /**
   * 잘린 표시 제목("… ...") 바로 위에 "전체 제목 + 형식" 줄이 있으면 전체 제목을 돌려준다.
   * 예) "순간을 달리는 할머니. 2   / Sun'gan ŭl ... 2 Book" + "순간을 달리는 할머니. 2 ..."
   */
  function preferFullTitle(lines, j) {
    const cand = lines[j];
    if (j === 0) return cand;
    const above = lines[j - 1];
    if (!above || isNoise(above) || isAuthorLike(above) || isDateLike(above)) return cand;
    const stripped = above.replace(FORMAT_SUFFIX_RE, '').trim();
    if (!stripped) return cand;
    const base = cand.replace(ELLIPSIS_RE, '').trim();
    const nb = normKey(base), ns = normKey(stripped);
    if (nb.length >= 3 && ns.length >= nb.length && ns.startsWith(nb)) return stripped;
    return cand;
  }

  /**
   * 대출 목록 텍스트 → [{title, author, due, format, status, overdue, renewable}]
   * @param {string} text  페이지 전체 텍스트(innerText) 또는 붙여넣은 텍스트
   * @param {{now?: Date}} [opts]
   */
  function parseCheckoutsFromText(text, opts) {
    const now = opts && opts.now;
    const lines = toLines(text);
    const items = [];
    const seen = new Set();
    const hasDueHeader = /\bdue\b/i.test(String(text || ''));
    const today = todayISO(now);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let due = null;
      let labelIdx = i;      // 제목 탐색 시작점(이 줄 위부터)
      let inferredLost = false;

      if (DUE_WORD_RE.test(line) && DATE_RE.test(line)) {
        due = parseDueDate(line, now);
      } else if (RELATIVE_RE.test(line)) {
        due = parseRelativeDue(line, now);
      } else if (isDateLike(line) && i > 0 && DUE_WORD_RE.test(lines[i - 1]) && !DATE_RE.test(lines[i - 1])) {
        due = parseDueDate(line, now);          // "Due date" 라벨 다음 줄에 날짜만
        labelIdx = i - 1;
      } else if (DAYS_ONLY_RE.test(line) && i > 0 && OVERDUE_RE.test(lines[i - 1]) && isStatus(lines[i - 1])) {
        // 퀸즈 도서관 "Assumed lost" / "Overdue" 다음 줄 "59 days" = 연체 일수 → 반납일 역산
        due = addDaysISO(today, -(+DAYS_ONLY_RE.exec(line)[1]));
        labelIdx = i - 1;
        inferredLost = true;
      } else if (hasDueHeader && isDateLike(line)) {
        const d = parseDueDate(line, now);     // 표 형태: 날짜만 있는 셀
        if (d) { const off = diffDaysISO(today, d); if (off >= -30 && off <= 180) due = d; }
      }
      if (!due) continue;

      // 위로 올라가며 제목 후보 찾기
      let title = null, titleIdx = -1;
      for (let j = labelIdx - 1; j >= Math.max(0, labelIdx - 8); j--) {
        const cand = lines[j];
        if (DUE_WORD_RE.test(cand) && DATE_RE.test(cand)) break;   // 이전 항목의 반납일을 넘어가면 중단
        if (!isTitleCandidate(cand)) continue;
        title = cleanTitle(preferFullTitle(lines, j)); titleIdx = j; break;
      }
      if (!title) continue;

      // 제목~반납일(+뒤 4줄) 범위에서 저자/형식/상태/연장 가능 여부
      let author = '', format = '', status = '';
      let overdue = inferredLost || OVERDUE_RE.test(line);
      const blockEnd = Math.min(lines.length - 1, i + 4);
      let noRenew = false;
      for (let j = titleIdx + 1; j <= blockEnd; j++) {
        const s = lines[j];
        if (j > i && isTitleCandidate(s)) break;          // 다음 항목 시작
        if (!author && isAuthorLike(s)) author = cleanAuthor(s);
        if (!format && FORMAT_RE.test(s)) format = s.match(FORMAT_RE)[0];
        if (!status && isStatus(s)) status = s.replace(/[.!]$/, '');
        if (OVERDUE_RE.test(s) && (isStatus(s) || j <= i)) overdue = true;
        if (NO_RENEW_RE.test(s)) noRenew = true;
      }
      if (!status && overdue) status = 'Overdue';
      if (diffDaysISO(today, due) < 0) overdue = true;

      const key = normKey(title) + '|' + due;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title, author, due, format, status, overdue, renewable: !noRenew });
    }
    return items;
  }

  /** DOM 문서에서 파싱 (innerText 기반). 확장 콘텐츠 스크립트에서 사용. */
  function parseCheckoutsFromDocument(doc, opts) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.body) return [];
    const text = d.body.innerText || d.body.textContent || '';
    return parseCheckoutsFromText(text, opts);
  }

  /** URL이 '대출 중' 계정 페이지처럼 보이는지 */
  function looksLikeCheckoutsUrl(url) {
    return /check(ed)?-?outs?|items-?out|on-?loan|loans|my-?account|account|borrowed|myaccount/i.test(String(url || ''));
  }

  /**
   * 도서관 사이트의 검색 결과 URL에서 검색어 자리를 {q}로 바꾼 템플릿을 만든다.
   * 예) https://lib.example/search?query=harry+potter&type=all → https://lib.example/search?query={q}&type=all
   */
  function detectSearchTemplate(urlString) {
    let u;
    try { u = new URL(urlString); } catch (_) { return null; }
    const keys = ['query', 'q', 'searchTerm', 'term', 'search', 'keyword', 'lookfor', 'searchString', 'text', 'keywords', 'searchField'];
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (v && v.trim().length > 0 && v.trim() !== '*') {
        u.searchParams.set(k, '__Q__');
        return u.toString().replace('__Q__', '{q}');
      }
    }
    const hm = /[?&](query|q|searchTerm|term|keyword)=([^&#]+)/i.exec(u.hash || '');
    if (hm) return urlString.replace(hm[0], hm[0].replace(hm[2], '{q}'));
    return null;
  }

  return {
    parseDueDate,
    parseCheckoutsFromText,
    parseCheckoutsFromDocument,
    looksLikeCheckoutsUrl,
    detectSearchTemplate,
    _internal: { toLines, isAuthorLike, isNoise, isStatus, todayISO, cleanAuthor, cleanTitle }
  };
});
