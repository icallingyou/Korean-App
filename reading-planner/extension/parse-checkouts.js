/* =============================================================
   parse-checkouts.js — 도서관 "대출 중(Checked out)" 페이지 파서
   -------------------------------------------------------------
   - 특정 도서관 시스템(Vega Discover, BiblioCommons, Encore 등)의
     DOM 구조에 의존하지 않고, 화면 텍스트에서
     "제목 → (저자) → (형식) → 반납일(Due ...)" 패턴을 찾아냅니다.
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
    MON + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}' +   // Nov 14, 2026 / November 14 2026
    '|\\d{1,2}(?:st|nd|rd|th)?\\s+' + MON + ',?\\s+\\d{4}' +  // 14 Nov 2026
    '|\\d{1,2}/\\d{1,2}/\\d{2,4}' +                       // 11/14/2026
    '|\\d{4}-\\d{2}-\\d{2}' +                             // 2026-11-14
    '|' + MON + '\\s+\\d{1,2}(?:st|nd|rd|th)?(?![\\d/])' + // Nov 14 (연도 없음)
    ')';
  const DATE_RE = new RegExp(DATE_SRC, 'i');
  const DATE_ONLY_RE = new RegExp('^' + DATE_SRC + '$', 'i');
  const DUE_WORD_RE = /\b(due|return(?:\s+by)?|expires?)\b/i;
  const RELATIVE_RE = /\bdue\b[^\n]*?\b(today|tomorrow|in\s+(\d+)\s+days?)\b/i;
  const OVERDUE_RE = /\boverdue\b/i;

  const NOISE_RE = /^(renew(\s+all|\s+now)?|renewed|place\s+hold|hold|return|details|more|save|share|select|check(ed)?\s*out|checkouts?|items?\s+out|on\s+loan|loans?|sort\s+by|filter|download|read\s+online|borrow|learn\s+more|log\s*out|sign\s*out|my\s+account|account|home|search|menu|close|back|next|previous|page\s+\d+|\d+|[\W_]*)$/i;
  const META_RE = /^(renewal|renewals?\s+(left|remaining)|times?\s+renewed|barcode|item\s+(id|barcode|number)|call\s+(number|no)|copy|status|checked\s+out\s+(on|date)|borrowed|loaned?\s+on|from|branch|location|pickup|library:|requested|expires?|hold\s+position|not\s+renewable|renewable|can\s+be\s+renewed|cannot\s+be\s+renewed|auto[- ]renew)/i;
  const FORMAT_RE = /^(book|print\s+book|e-?book|e-?audiobook|audiobook|audio\s*book|large\s+print|dvd|blu-?ray|cd|music\s+cd|magazine|graphic\s+novel|comic|paperback|hardcover|kindle|video\s*game|board\s+book|manga|playaway|kit|map)\b/i;
  const AUTHOR_BY_RE = /^by\s+(.+)$/i;
  // "Haig, Matt" / "Haig, Matt, 1975-" 같은 '성, 이름' 형태
  const AUTHOR_LAST_FIRST_RE = /^[A-Z][\w'’.\- ]{1,40},\s+[A-Z][\w'’.\- ]{1,40}(?:,\s*[\d\s\-–]+)?\.?$/;

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

  function cleanTitle(s) {
    return s.replace(/\s+/g, ' ')
      .replace(/^(title:?\s*)/i, '')
      .replace(/\s*[\[(](e-?book|audiobook|large print|book|dvd)[\])]\s*$/i, '')
      .replace(/\s*[:/]\s*$/, '')
      .trim();
  }
  function cleanAuthor(s) {
    return s.replace(/^by\s+/i, '').replace(/,?\s*(author|illustrator|narrator|\d{4}-(\d{4})?)\.?$/i, '').replace(/\s+/g, ' ').trim();
  }

  function isAuthorLike(line) { return AUTHOR_BY_RE.test(line) || AUTHOR_LAST_FIRST_RE.test(line); }
  function isDateLike(line) { return DATE_ONLY_RE.test(line) || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(line); }
  function isNoise(line) { return line.length < 2 || NOISE_RE.test(line) || META_RE.test(line); }

  /** 텍스트를 줄 단위로 정리 (탭으로 구분된 표 셀은 각각 한 줄로). */
  function toLines(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      for (const cell of raw.split('\t')) {
        const s = cell.replace(/ /g, ' ').trim();
        if (s) out.push(s);
      }
    }
    return out;
  }

  /**
   * 대출 목록 텍스트 → [{title, author, due, format, overdue}]
   * @param {string} text  페이지 전체 텍스트(innerText) 또는 붙여넣은 텍스트
   * @param {{now?: Date}} [opts]
   */
  function parseCheckoutsFromText(text, opts) {
    const now = opts && opts.now;
    const lines = toLines(text);
    const items = [];
    const seen = new Set();
    // 표 형태(제목 | 저자 | 날짜)처럼 날짜 셀에 'Due'가 없을 때를 위해:
    // 문서 어딘가에 'Due' 표제가 있으면 "가까운 미래의 날짜만 있는 줄"도 반납일로 본다.
    const hasDueHeader = /\bdue\b/i.test(String(text || ''));
    const today = todayISO(now);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let due = null;
      let labelIdx = i; // 제목 탐색 시작점(이 줄 위부터)

      if (DUE_WORD_RE.test(line) && DATE_RE.test(line)) {
        due = parseDueDate(line, now);
      } else if (RELATIVE_RE.test(line)) {
        due = parseRelativeDue(line, now);
      } else if (isDateLike(line) && i > 0 && DUE_WORD_RE.test(lines[i - 1]) && !DATE_RE.test(lines[i - 1])) {
        // "Due date" 라벨 다음 줄에 날짜만 있는 형태
        due = parseDueDate(line, now);
        labelIdx = i - 1;
      } else if (hasDueHeader && isDateLike(line)) {
        const d = parseDueDate(line, now);
        if (d) { const off = diffDaysISO(today, d); if (off >= -30 && off <= 180) due = d; }
      }
      if (!due) continue;

      // 위로 올라가며 제목 후보 찾기
      let title = null, titleIdx = -1;
      for (let j = labelIdx - 1; j >= Math.max(0, labelIdx - 8); j--) {
        const cand = lines[j];
        if (isNoise(cand) || isAuthorLike(cand) || FORMAT_RE.test(cand) || isDateLike(cand)) continue;
        if (DUE_WORD_RE.test(cand) && DATE_RE.test(cand)) break; // 이전 항목의 반납일을 넘어가면 중단
        if (cand.length > 160) continue;
        title = cleanTitle(cand); titleIdx = j; break;
      }
      if (!title) continue;

      // 제목~반납일 사이에서 저자/형식 찾기
      let author = '', format = '';
      let overdue = OVERDUE_RE.test(line);
      for (let j = titleIdx + 1; j <= i; j++) {
        const s = lines[j];
        if (!author && isAuthorLike(s)) author = cleanAuthor(s);
        if (!format && FORMAT_RE.test(s)) format = s.match(FORMAT_RE)[0];
        if (OVERDUE_RE.test(s)) overdue = true;
      }
      // 바로 아래 한두 줄에 "Overdue" 표시가 있는 경우
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2); j++) if (OVERDUE_RE.test(lines[j])) overdue = true;

      const key = title.toLowerCase() + '|' + due;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title, author, due, format, overdue });
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
    const keys = ['query', 'q', 'searchTerm', 'term', 'search', 'keyword', 'lookfor', 'searchString', 'text', 'keywords'];
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (v && v.trim().length > 0) {
        u.searchParams.set(k, '__Q__');
        return u.toString().replace('__Q__', '{q}');
      }
    }
    // 해시 라우팅(#/search?query=) 형태
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
    _internal: { toLines, isAuthorLike, isNoise, todayISO }
  };
});
