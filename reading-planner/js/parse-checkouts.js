/* =============================================================
   parse-checkouts.js — 도서관 "대출 중(Checked out)" 페이지 파서
   -------------------------------------------------------------
   - 특정 도서관 시스템의 DOM 구조에 의존하지 않고, 화면 텍스트에서
     "제목 → (저자) → (형식/상태) → 반납일" 패턴을 찾아냅니다.
   - 검증된 레이아웃: 퀸즈 공공도서관(queenslibrary.org/my-account/checkouts),
     Vega Discover, BiblioCommons, Sierra WebPAC 표, 마크다운 복사본.
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
    MON + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}' +        // Nov 14, 2026 / Oct 08, 2026
    '|\\d{1,2}(?:st|nd|rd|th)?\\s+' + MON + ',?\\s+\\d{4}' +  // 14 Nov 2026
    '|\\d{1,2}/\\d{1,2}/\\d{2,4}' +                            // 11/14/2026
    '|\\d{4}-\\d{2}-\\d{2}' +                                  // 2026-11-14
    '|\\d{1,2}-\\d{1,2}-\\d{2,4}' +                            // 11-14-26 (Sierra WebPAC)
    '|' + MON + '\\s+\\d{1,2}(?:st|nd|rd|th)?(?![\\d/])' +     // Nov 14 (연도 없음)
    ')';
  const DATE_RE = new RegExp(DATE_SRC, 'i');
  const DATE_ONLY_RE = new RegExp('^' + DATE_SRC + '$', 'i');
  const DUE_WORD_RE = /\b(due|return(?:\s+by)?|expires?)\b/i;
  const RELATIVE_RE = /\bdue\b[^\n]*?\b(today|tomorrow|in\s+(\d+)\s+days?)\b/i;
  const DAYS_ONLY_RE = /^(\d+)\s+days?(?:\s+(overdue|late))?$/i;
  const OVERDUE_RE = /\b(overdue|past\s+due|assumed\s+lost|lost|billed|late)\b/i;
  const CARD_BUTTON_RE = /^(renew(\s+all|\s+now|\s+selected)?|place\s+(a\s+)?hold|return|cancel(\s+hold)?)$/i;

  // 버튼·내비게이션 등 제목이 될 수 없는 짧은 줄 (줄 전체 일치)
  const NOISE_RE = /^(renew(\s+all|\s+now|\s+selected).*|renew|renewed|place\s+(a\s+)?hold|hold|return|details|more|save|share|select(\s+all)?|check(ed)?\s*out(\s*\(\d+\))?|checkouts?(\s*\(\d+\))?|items?\s+out|on\s+loan|loans?|sort\s+by.*|filter|download|read\s+online|borrow|learn\s+more|log\s*out|sign\s*out|my\s+account|my\s+checked\s+out|account(\s+overview)?|home|search|menu|close|back|next|previous|page\s+\d+|\d+|\d+\s+items?|due(\s+date)?:?|due\s+(first|last)|checked\s+out\s+(first|last)|view\s+a\s+list.*|fees|messages|requests|wishlist|holds?(\s*\(\d+\))?)$/i;
  // 대출 항목의 부가 정보 줄 (제목 후보에서 제외) — 모든 대안에 경계를 둬서 제목 접두어를 오인하지 않게 함
  const META_RE = /^(?:renewals?\s+(?:left|remaining)\b|times?\s+renewed\b|you\s+have\s+renewed\b|why\s+can'?t\s+i\s+renew|\(?checked\s+out\b|item\s+(?:id|barcode|number)\b|call\s+(?:number|no)\b|loaned?\s+on\b|borrowed\s+(?:on\b|:)|hold\s+position\b|not\s+renewable\b|can(?:not)?\s+be\s+renewed\b|auto[- ]renew\b|\d+\s+days?(?:\s+(?:overdue|late|left|remaining|ago|until\s+due.*))?$|\(?\d+\s+of\s+\d+(?:\s+allowed)?\)?$|(?:renewals?|renewable|barcode|copy|status|branch|location|pickup|library|from|expires?|requested)\s*:)/i;
  // 대출 상태 라벨 (한 줄 전체) — 절대 제목이 되지 않음
  const STATUS_RE = /^(overdue|past\s+due|due\s+soon|assumed\s+lost|lost(\s+and\s+paid)?|billed|checked\s+out|on\s+loan|in\s+transit|on\s+hold|ready\s+for\s+pickup|requested\s+by\s+another\s+(customer|patron|user|borrower)|requested|not\s+renewable|renewable|renewed(\s+\d+\s+times?)?|returned|claimed\s+returned|on\s+time|late|available|unavailable)[.!]?$/i;
  const FORMATS = '(?:print\\s+book|board\\s+book|e-?book|e-?audiobook|audio\\s*book|audiobook|book|large\\s+print|dvd|blu-?ray|music\\s+cd|cd|magazine|graphic\\s+novel|comic|paperback|hardcover|kindle|video\\s*game|manga|playaway|kit|map)';
  // 형식 배지 줄: "Book", "Large print", "Book - 2021", "Book | 320 pages" (제목 앞머리의 형식 단어는 해당 없음)
  const FORMAT_LINE_RE = new RegExp('^' + FORMATS + '(?:\\s*[-–—,|·(]\\s*[^\\n]{0,40})?\\.?$', 'i');
  const FORMAT_SUFFIX_RE = new RegExp('\\s*' + FORMATS + '\\.?$', 'i');
  const AUTHOR_BY_RE = /^by\s+(.+)$/i;
  const ROLE_WORDS = '(?:author|illustrator|narrator|editor|translator|compiler|contributor|photographer|artist|writer)';
  // "Haig, Matt" / "Haig, Matt, 1975- author." / "Frankl, Viktor E. (Viktor Emil), 1905-1997, author." / "한 강, 1970-"
  const AUTHOR_LAST_FIRST_RE = new RegExp("^\\p{L}[\\p{L}\\p{M}'’.\\- ]{0,40},\\s+\\p{L}[\\p{L}\\p{M}'’.\\- ]{0,40}(?:\\s*\\([^)]*\\))?(?:,\\s*[\\d\\s\\-–]+)?(?:,?\\s*" + ROLE_WORDS + "\\.?)*\\.?$", 'u');
  const AUTHOR_YEAR_RE = /^\p{L}[\p{L}\p{M}'’.\- ]{0,40},\s*\d{4}\s*[-–]\s*(\d{4})?\.?$/u;
  const NO_LETTERS_RE = /^[^\p{L}\p{N}]*$/u;
  const CJK_RE = /[ㄱ-힝一-鿿぀-ヿ]/;
  const ELLIPSIS_RE = /\s*(\.{3}|…)\s*$/;
  const NO_RENEW_RE = /why\s+can'?t\s+i\s+renew|requested\s+by\s+another|not\s+renewable|cannot\s+be\s+renewed|\((\d+)\s+of\s+\1\s+allowed\)/i;
  const HOLD_STATUS_RE = /ready\s+for\s+pickup|on\s+hold|in\s+transit/i;
  const CHECKOUT_DATE_LABEL_RE = /checked\s*out|borrow|loan|renew|placed|pickup|expire|return/i;
  // 내비게이션 단어 한 줄("Home", "Search" …)은 보통 잡음이지만, 바로 아래에 저자 줄이 오면 제목이다 (토니 모리슨 "Home")
  const WEAK_NOISE_RE = /^(home|search|menu|back|next|previous|more|details|save|share|filter|hold|return|close|download|borrow)$/i;

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

  /** 문자열 속 날짜를 YYYY-MM-DD로 (반납 단어 뒤의 날짜를 우선). 연도가 없으면 오늘 기준 가까운 '앞으로의' 해로 추정. */
  function parseDueDate(str, now) {
    if (!str) return null;
    const dw = DUE_WORD_RE.exec(str);
    let m = DATE_RE.exec(dw ? str.slice(dw.index) : str);
    if (!m && dw) m = DATE_RE.exec(str);
    if (!m) return null;
    const s = m[0].replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '').trim();
    let y, mo, d, r;

    if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +r[1]; mo = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s))) {
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
      .replace(/(\*\*|__)(.+?)\1/g, '$2')        // **bold**
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
    a = a.split(/\s*;\s*/)[0];                                     // 공동 저자는 첫 번째만
    a = a.replace(/\s*\([^)]*\)/g, '');                            // (Viktor Emil), (Cultural commentator)
    // 역할어 제거: 끝에 오는 "…, author." / "… author." 와 쉼표 뒤의 "…, author, …" (성이 "Author"인 경우 보호)
    a = a.replace(new RegExp('(,\\s*|\\s+)' + ROLE_WORDS + '\\b\\.?$', 'i'), '');
    a = a.replace(new RegExp(',\\s*' + ROLE_WORDS + '\\b\\.?(?=,|;|$)', 'gi'), '');
    a = a.replace(/,?\s*\b\d{4}\s*[-–]\s*(\d{4})?\.?/g, '');        // 1970- / 1905-1997
    a = a.replace(/\s+/g, ' ').replace(/[,\s]+$/, '');
    // 끝 마침표 제거 (이니셜 "E."·약어 "Dr." 은 유지)
    if (/\.$/.test(a) && !/(^|[\s,])(?:[A-Z]|Dr|Jr|Sr|Mrs?|Ms|St|Prof)\.$/.test(a)) a = a.slice(0, -1);
    return a.trim();
  }

  function isAuthorLike(line) { return AUTHOR_BY_RE.test(line) || AUTHOR_LAST_FIRST_RE.test(line) || AUTHOR_YEAR_RE.test(line); }
  function isDateLike(line) { return DATE_ONLY_RE.test(line) || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(line); }
  function isStatus(line) { return STATUS_RE.test(line); }
  function isDueLine(line) { return (DUE_WORD_RE.test(line) && DATE_RE.test(line)) || RELATIVE_RE.test(line) || DAYS_ONLY_RE.test(line); }
  function isNoise(line) { return line.length < 2 || NO_LETTERS_RE.test(line) || NOISE_RE.test(line) || META_RE.test(line) || isStatus(line); }
  function isTitleCandidate(line) {
    return !(isNoise(line) || isAuthorLike(line) || FORMAT_LINE_RE.test(line) || isDateLike(line) || isDueLine(line) || line.length > 200);
  }

  /** 텍스트를 줄 단위로 정리 (탭/마크다운 표 셀은 각각 한 줄로, 마크다운 링크는 텍스트만). */
  function toLines(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      let cells;
      if (raw.includes('\t')) cells = raw.split('\t');
      else if (/^\s*\|.*\|\s*$/.test(raw)) cells = raw.trim().slice(1, -1).split('|');
      else cells = [raw];
      for (const cell of cells) {
        const s = stripMarkdown(cell.replace(/ /g, ' ')).trim();
        if (s) out.push(s);
      }
    }
    return out;
  }

  /**
   * 퀸즈 도서관처럼 "전체 제목 + 형식" 줄 바로 아래에 "표시용(잘린) 제목" 줄이 오는 쌍인지.
   * 이 구조 자체가 강한 근거이므로 단어 목록(작가 모양, 형식 단어 등)보다 우선한다.
   */
  function isTitlePair(lines, j) {
    if (j === 0) return false;
    const above = lines[j - 1], cand = lines[j];
    if (!above || isDateLike(cand) || isDueLine(cand) || isStatus(cand) || FORMAT_LINE_RE.test(cand)) return false;
    if (isDateLike(above) || isDueLine(above) || isStatus(above) || FORMAT_LINE_RE.test(above) || META_RE.test(above)) return false;
    const hasFmt = FORMAT_SUFFIX_RE.test(above);
    const hasEll = ELLIPSIS_RE.test(cand);
    if (!hasFmt && !hasEll) return false;
    const stripped = above.replace(FORMAT_SUFFIX_RE, '').trim();
    const base = cand.replace(ELLIPSIS_RE, '').trim();
    const nb = normKey(base), ns = normKey(stripped);
    return nb.length >= 1 && ns.length >= nb.length && ns.startsWith(nb);
  }
  function fullFromPair(lines, j) {
    const stripped = lines[j - 1].replace(FORMAT_SUFFIX_RE, '').trim();
    return stripped || lines[j];
  }
  /** 전체 제목 줄을 골랐을 때 바로 아래 줄이 그 제목의 (형식 없는) 복사본이면 형식 접미사를 뗀다 ("1984 Book"/"1984"). */
  function withSuffixFix(lines, j) {
    const cand = lines[j];
    if (!FORMAT_SUFFIX_RE.test(cand) || FORMAT_LINE_RE.test(cand)) return cand;
    const stripped = cand.replace(FORMAT_SUFFIX_RE, '').trim();
    const next = lines[j + 1];
    if (!stripped || !next) return cand;
    const nn = normKey(next.replace(ELLIPSIS_RE, ''));
    return nn && normKey(stripped).startsWith(nn) ? stripped : cand;
  }

  /**
   * 대출 목록 텍스트 → [{title, author, due, format, status, overdue, renewable, dueInferred}]
   * @param {string} text  페이지 전체 텍스트(innerText) 또는 붙여넣은 텍스트
   * @param {{now?: Date}} [opts]  now: 텍스트를 캡처한 시점 (상대 날짜·연체 일수 계산 기준)
   */
  function parseCheckoutsFromText(text, opts) {
    const now = opts && opts.now;
    const lines = toLines(text);
    const items = [];
    const seen = new Map(); // key → index in items
    const hasDueHeader = /\bdue\b/i.test(String(text || ''));
    const today = todayISO(now);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let due = null;
      let labelIdx = i;      // 제목 탐색 시작점(이 줄 위부터)
      let inferred = false;  // 연체 일수로 역산한 반납일
      let fromExpires = false;

      if (DUE_WORD_RE.test(line) && DATE_RE.test(line)) {
        due = parseDueDate(line, now);
        fromExpires = /\bexpires?\b/i.test(line) && !/\bdue\b/i.test(line);
      } else if (RELATIVE_RE.test(line)) {
        due = parseRelativeDue(line, now);
      } else if (isDateLike(line) && i > 0 && DUE_WORD_RE.test(lines[i - 1]) && !DATE_RE.test(lines[i - 1])) {
        due = parseDueDate(line, now);          // "Due date" 라벨 다음 줄에 날짜만
        fromExpires = /\bexpires?\b/i.test(lines[i - 1]) && !/\bdue\b/i.test(lines[i - 1]);
        labelIdx = i - 1;
      } else if (DAYS_ONLY_RE.test(line) && (
        /overdue|late/i.test(line) ||
        (i > 0 && isStatus(lines[i - 1]) && OVERDUE_RE.test(lines[i - 1])))) {
        // 퀸즈 도서관 "Assumed lost"/"Overdue" 다음 줄 "59 days" = 연체 일수 → 반납일 역산
        due = addDaysISO(today, -(+DAYS_ONLY_RE.exec(line)[1]));
        labelIdx = (i > 0 && isStatus(lines[i - 1])) ? i - 1 : i;
        inferred = true;
      } else if (hasDueHeader && isDateLike(line)) {
        // 표 형태: 인접한 날짜 셀(대출일·반납일 열) 중 가장 늦은 날짜만 반납일로 본다
        let a = i, b = i;
        while (a > 0 && isDateLike(lines[a - 1])) a--;
        while (b + 1 < lines.length && isDateLike(lines[b + 1])) b++;
        const dates = [];
        for (let k = a; k <= b; k++) { const d = parseDueDate(lines[k], now); if (d) dates.push(d); }
        const mine = parseDueDate(line, now);
        const latest = dates.sort().pop();
        const before = a > 0 ? lines[a - 1] : '';
        const beforeIsCheckoutLabel = CHECKOUT_DATE_LABEL_RE.test(before) && !/\bdue\b/i.test(before);
        if (mine && mine === latest && !beforeIsCheckoutLabel) {
          const off = diffDaysISO(today, mine);
          if (off >= -30 && off <= 180) due = mine;
        }
      }
      if (!due) continue;

      // 위로 올라가며 제목 후보 찾기 (제목 쌍 구조 우선)
      let title = null, titleIdx = -1;
      const authorish = [];
      for (let j = labelIdx - 1; j >= Math.max(0, labelIdx - 8); j--) {
        const cand = lines[j];
        if (isDueLine(cand) && !DAYS_ONLY_RE.test(cand)) break;   // 이전 항목의 반납일을 넘어가면 중단
        if (isTitlePair(lines, j)) { title = cleanTitle(fullFromPair(lines, j)); titleIdx = j; break; }
        if (WEAK_NOISE_RE.test(cand) && j + 1 < lines.length && isAuthorLike(lines[j + 1]) && !isNoise(lines[j + 1])) {
          title = cleanTitle(cand); titleIdx = j; break;
        }
        if (!isTitleCandidate(cand)) {
          if (isAuthorLike(cand) && !isNoise(cand) && !FORMAT_LINE_RE.test(cand)) authorish.unshift(j);
          continue;
        }
        title = cleanTitle(withSuffixFix(lines, j)); titleIdx = j; break;
      }
      // "Hello, Universe" / "Olive, Again" 처럼 저자 모양의 제목: 저자 모양 줄이 둘 이상이면 맨 위가 제목
      if (!title && authorish.length >= 2) { titleIdx = authorish[0]; title = cleanTitle(withSuffixFix(lines, titleIdx)); }
      if (!title) continue;

      // 제목~반납일(+뒤 4줄, 카드 버튼 전까지) 범위에서 저자/형식/상태/연장 가능 여부
      let author = '', format = '', status = '';
      let overdue = inferred || OVERDUE_RE.test(line);
      const blockEnd = Math.min(lines.length - 1, i + 4);
      let noRenew = false;
      for (let j = titleIdx + 1; j <= blockEnd; j++) {
        const s = lines[j];
        if (j > i && (CARD_BUTTON_RE.test(s) || isTitleCandidate(s) || isTitlePair(lines, j))) break;   // 다음 항목 시작
        if (!author && isAuthorLike(s)) author = cleanAuthor(s);
        if (!format && FORMAT_LINE_RE.test(s)) format = s.match(FORMAT_LINE_RE)[0].replace(/\s*[-–—,|·(].*$/, '');
        if (!status && isStatus(s)) status = s.replace(/[.!]$/, '');
        if (OVERDUE_RE.test(s) && (isStatus(s) || j <= i)) overdue = true;
        if (NO_RENEW_RE.test(s)) noRenew = true;
      }
      // BiblioCommons처럼 상태 배지가 제목 '위'에 붙는 경우
      if (!status && titleIdx > 0 && isStatus(lines[titleIdx - 1]) && !isTitlePair(lines, titleIdx)) {
        status = lines[titleIdx - 1].replace(/[.!]$/, '');
        if (OVERDUE_RE.test(status)) overdue = true;
      }
      if (fromExpires && HOLD_STATUS_RE.test(status)) continue;   // 예약(hold)의 만료일은 대출이 아님
      if (!status && overdue) status = 'Overdue';
      if (diffDaysISO(today, due) < 0) overdue = true;

      const item = { title, author, due, format, status, overdue, renewable: !noRenew, dueInferred: inferred };
      const tkey = normKey(title);
      const key = tkey + '|' + due;
      if (seen.has(key)) continue;
      // 같은 책의 '연체 일수 역산' 날짜와 명시된 반납일이 며칠 어긋나면 명시된 쪽을 남긴다
      const prevIdx = [...seen.entries()].find(([k]) => k.startsWith(tkey + '|'));
      if (prevIdx) {
        const prev = items[prevIdx[1]];
        if (prev && (prev.dueInferred || inferred) && Math.abs(diffDaysISO(prev.due, due)) <= 3) {
          if (prev.dueInferred && !inferred) { items[prevIdx[1]] = item; seen.delete(prevIdx[0]); seen.set(key, prevIdx[1]); }
          continue;
        }
      }
      seen.set(key, items.length);
      items.push(item);
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

  /** URL이 '대출 중' 계정 페이지처럼 보이는지 (계정 개요/예약/수수료 페이지는 제외) */
  function looksLikeCheckoutsUrl(url) {
    return /check(ed)?[-_]?outs?|items[-_]?out|on[-_]?loan|\/loans?\b|borrowed|checked_out/i.test(String(url || ''));
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
    _internal: { toLines, isAuthorLike, isNoise, isStatus, isTitleCandidate, todayISO, cleanAuthor, cleanTitle }
  };
});
