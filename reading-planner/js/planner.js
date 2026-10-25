/* =============================================================
   planner.js — 독서 계획 계산 (순수 함수, 브라우저/Node 공용)
   -------------------------------------------------------------
   buildPlan(books, opts) → 오늘 읽을 분량, 책별 상태, 28일 캘린더
   buildICS(plan, books)  → 캘린더 앱에 넣을 .ics 텍스트
   ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Planner = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const pad = n => String(n).padStart(2, '0');

  function todayISO(d) {
    const t = d || new Date();
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }
  function toUTC(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function fromUTC(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  function addDays(iso, n) { return fromUTC(toUTC(iso) + n * DAY); }
  function diffDays(fromISO, toISO) { return Math.round((toUTC(toISO) - toUTC(fromISO)) / DAY); }
  function isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  /**
   * @param {Array} books  {id,title,pages,currentPage,due,status}
   * @param {Object} opts  {today, bufferDays=1, capacity=60, horizon=28}
   */
  function buildPlan(books, opts) {
    const o = opts || {};
    const today = o.today || todayISO();
    const buffer = Number.isFinite(o.bufferDays) ? o.bufferDays : 1;
    const capacity = Number.isFinite(o.capacity) && o.capacity > 0 ? o.capacity : 60;
    const horizon = o.horizon || 28;

    const items = [];
    for (const b of books || []) {
      if (b.status !== 'reading') continue;
      const pages = Math.max(0, Number(b.pages) || 0);
      const cur = Math.min(Math.max(0, Number(b.currentPage) || 0), pages || Infinity);
      const remaining = pages ? Math.max(0, pages - cur) : null;
      const due = isISO(b.due) ? b.due : null;

      let deadline = null, daysLeft = null, dueIn = null;
      if (due) {
        dueIn = diffDays(today, due);
        deadline = addDays(due, -buffer);
        // 여유일을 빼면 이미 지났지만 반납일 자체는 안 지났으면 반납일을 마감으로
        if (diffDays(today, deadline) < 0 && dueIn >= 0) deadline = due;
        daysLeft = diffDays(today, deadline) + 1;
      }

      let status, perDay = 0;
      if (pages && remaining === 0) status = 'done';
      else if (!due) status = 'nodue';
      else if (!pages) status = 'nopages';
      else if (daysLeft <= 0) status = 'overdue'; // 연체: 일정에 넣지 않고 반납/연장을 제안 (연장하면 새 반납일로 다시 계산)
      else {
        perDay = Math.ceil(remaining / daysLeft);
        status = perDay > capacity ? 'tight' : 'ok';
      }

      items.push({
        id: b.id, book: b, pages, currentPage: pages ? cur : (Number(b.currentPage) || 0),
        remaining, due, dueIn, deadline, daysLeft, perDay, status,
        progressPct: pages ? Math.round(cur / pages * 100) : 0
      });
    }

    // 정렬: 연체 → 반납일 빠른 순 → 반납일 없는 것
    const rank = { overdue: 0, tight: 1, ok: 1, nopages: 2, done: 3, nodue: 4 };
    items.sort((a, b) => (rank[a.status] - rank[b.status]) || ((a.due || '9999').localeCompare(b.due || '9999')));

    // 캘린더(오늘부터 horizon일): 책별로 하루 perDay씩 배분
    const calendar = [];
    for (let k = 0; k < horizon; k++) calendar.push({ date: addDays(today, k), total: 0, entries: [] });
    for (const it of items) {
      if (!(it.status === 'ok' || it.status === 'tight')) continue;
      let page = it.currentPage, left = it.remaining;
      const span = it.daysLeft;
      for (let k = 0; k < span && k < horizon && left > 0; k++) {
        const n = Math.min(it.perDay, left);
        calendar[k].entries.push({ bookId: it.id, title: it.book.title, pages: n, from: page + 1, to: page + n });
        calendar[k].total += n;
        page += n; left -= n;
      }
    }

    const totalToday = calendar[0] ? calendar[0].total : 0;
    const overCapacity = totalToday > capacity;

    // 제안
    const suggestions = [];
    for (const it of items) {
      if (it.status === 'overdue') suggestions.push({ type: 'overdue', bookId: it.id });
      else if (it.status === 'done') suggestions.push({ type: 'mark_done', bookId: it.id });
      else if (it.status === 'nopages') suggestions.push({ type: 'set_pages', bookId: it.id });
      else if (it.status === 'nodue') suggestions.push({ type: 'set_due', bookId: it.id });
    }
    if (overCapacity) {
      // 가장 반납일이 먼 책을 연장/보류 후보로
      const scheduled = items.filter(it => it.status === 'ok' || it.status === 'tight');
      const farthest = scheduled.slice().sort((a, b) => (b.due || '').localeCompare(a.due || ''))[0];
      suggestions.unshift({ type: 'over_capacity', bookId: farthest ? farthest.id : null, totalToday, capacity });
    }

    return { today, capacity, bufferDays: buffer, items, calendar, totalToday, overCapacity, suggestions };
  }

  // ---------- ICS ----------
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsDate(iso) { return iso.replace(/-/g, ''); }
  function fold(line) {
    // RFC 5545: 75옥텟 접기 (단순 문자 기준으로 처리)
    const out = [];
    let s = line;
    while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); }
    out.push(s);
    return out.join('\r\n');
  }
  function stamp() {
    const d = new Date();
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  /**
   * @param {Object} plan     buildPlan() 결과
   * @param {Array}  books    전체 책 목록 (반납일 이벤트용)
   * @param {Object} [opts]   {calName}
   */
  function buildICS(plan, books, opts) {
    const o = opts || {};
    const name = o.calName || 'Library Reading Plan';
    const now = stamp();
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Library Reading Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(name)}`
    ];
    const push = (l) => lines.push(fold(l));

    for (const day of plan.calendar) {
      for (const e of day.entries) {
        push('BEGIN:VEVENT');
        push(`UID:read-${day.date}-${e.bookId}@library-reading-planner`);
        push(`DTSTAMP:${now}`);
        push(`DTSTART;VALUE=DATE:${icsDate(day.date)}`);
        push(`DTEND;VALUE=DATE:${icsDate(addDays(day.date, 1))}`);
        push(`SUMMARY:${icsEscape(`📖 ${e.title}: pp. ${e.from}–${e.to} (${e.pages} pages)`)}`);
        push('END:VEVENT');
      }
    }
    for (const b of books || []) {
      if (!isISO(b.due) || b.status === 'done') continue;
      push('BEGIN:VEVENT');
      push(`UID:due-${b.id}@library-reading-planner`);
      push(`DTSTAMP:${now}`);
      push(`DTSTART;VALUE=DATE:${icsDate(b.due)}`);
      push(`DTEND;VALUE=DATE:${icsDate(addDays(b.due, 1))}`);
      push(`SUMMARY:${icsEscape(`📚 Return to library: ${b.title}`)}`);
      push('BEGIN:VALARM');
      push('ACTION:DISPLAY');
      push(`DESCRIPTION:${icsEscape(`Return "${b.title}" tomorrow`)}`);
      push('TRIGGER:-P1D');
      push('END:VALARM');
      push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  return { todayISO, addDays, diffDays, buildPlan, buildICS };
});
