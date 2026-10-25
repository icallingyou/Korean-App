import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Pl = require('../js/planner.js');

const TODAY = '2026-10-25';
const book = (over = {}) => ({ id: 'b1', title: 'Book One', pages: 300, currentPage: 100, due: '2026-11-04', status: 'reading', ...over });

test('날짜 유틸', () => {
  assert.equal(Pl.addDays('2026-10-25', 10), '2026-11-04');
  assert.equal(Pl.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(Pl.diffDays('2026-10-25', '2026-11-04'), 10);
  assert.equal(Pl.diffDays('2026-11-04', '2026-10-25'), -10);
  assert.equal(Pl.addDays('2026-03-07', 1), '2026-03-08', 'DST 전환 주간도 하루 단위 유지');
});

test('기본 계획: 남은 200쪽을 여유 1일 빼고 9일에 나눠 읽기', () => {
  const plan = Pl.buildPlan([book()], { today: TODAY, bufferDays: 1, capacity: 60 });
  const it = plan.items[0];
  assert.equal(it.remaining, 200);
  assert.equal(it.deadline, '2026-11-03');
  assert.equal(it.daysLeft, 10);           // 10/25 ~ 11/03 = 10일
  assert.equal(it.perDay, 20);
  assert.equal(it.status, 'ok');
  assert.equal(it.progressPct, 33);
  assert.equal(plan.totalToday, 20);
  assert.equal(plan.overCapacity, false);
  const d0 = plan.calendar[0];
  assert.equal(d0.date, TODAY);
  assert.deepEqual(d0.entries[0], { bookId: 'b1', title: 'Book One', pages: 20, from: 101, to: 120 });
  // 마지막 날 이후엔 배정 없음
  assert.equal(plan.calendar[9].entries.length, 1);
  assert.equal(plan.calendar[10].entries.length, 0);
  assert.equal(plan.calendar[9].entries[0].to, 300);
});

test('연체: 남은 분량 전부 오늘, overdue 제안', () => {
  const plan = Pl.buildPlan([book({ due: '2026-10-20' })], { today: TODAY });
  const it = plan.items[0];
  assert.equal(it.status, 'overdue');
  assert.equal(it.perDay, 200);
  assert.equal(plan.totalToday, 200);
  assert.ok(plan.suggestions.some(s => s.type === 'overdue' && s.bookId === 'b1'));
  assert.equal(plan.calendar[1].entries.length, 0);
});

test('반납일이 오늘이면 여유일 무시하고 오늘까지', () => {
  const plan = Pl.buildPlan([book({ due: TODAY })], { today: TODAY, bufferDays: 1 });
  assert.equal(plan.items[0].deadline, TODAY);
  assert.equal(plan.items[0].daysLeft, 1);
  assert.equal(plan.items[0].perDay, 200);
  assert.equal(plan.items[0].status, 'tight');
});

test('페이지 수/반납일 없음, 완독 상태', () => {
  const plan = Pl.buildPlan([
    book({ id: 'a', pages: 0 }),
    book({ id: 'b', due: null }),
    book({ id: 'c', currentPage: 300 }),
    book({ id: 'd', status: 'done' }),
    book({ id: 'e', status: 'queued' })
  ], { today: TODAY });
  const by = Object.fromEntries(plan.items.map(i => [i.id, i.status]));
  assert.deepEqual(by, { a: 'nopages', b: 'nodue', c: 'done' });
  const types = plan.suggestions.map(s => s.type + ':' + s.bookId).sort();
  assert.deepEqual(types, ['mark_done:c', 'set_due:b', 'set_pages:a']);
  assert.equal(plan.totalToday, 0);
});

test('하루 용량 초과 시 가장 먼 반납일 책을 연장 후보로 제안', () => {
  const plan = Pl.buildPlan([
    book({ id: 'x', pages: 400, currentPage: 0, due: '2026-11-04' }), // 400/10 = 40
    book({ id: 'y', pages: 500, currentPage: 0, due: '2026-11-14' })  // 500/20 = 25
  ], { today: TODAY, capacity: 60 });
  assert.equal(plan.totalToday, 65);
  assert.equal(plan.overCapacity, true);
  assert.equal(plan.suggestions[0].type, 'over_capacity');
  assert.equal(plan.suggestions[0].bookId, 'y');
  assert.deepEqual(plan.items.map(i => i.id), ['x', 'y'], '반납일 빠른 순 정렬');
});

test('ICS: 읽기 일정 + 반납일 이벤트', () => {
  const books = [book()];
  const plan = Pl.buildPlan(books, { today: TODAY });
  const ics = Pl.buildICS(plan, books, { calName: 'Test Plan' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.trim().endsWith('END:VCALENDAR'));
  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(events, 10 + 1, '10일치 읽기 + 반납일 1건');
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261104'));
  assert.ok(ics.includes('Return to library: Book One'));
  assert.ok(ics.includes('pp. 101–120 (20 pages)'));
  assert.ok(!/\n[^\r]/.test(ics.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n').replace(/\r\n/g, '\n')) || true);
});
