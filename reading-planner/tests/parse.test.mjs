import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../js/parse-checkouts.js');

const NOW = new Date(2026, 9, 25); // 2026-10-25 (로컬)

test('parseDueDate: 다양한 표기', () => {
  assert.equal(P.parseDueDate('Due Nov 14, 2026', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('Due by November 14 2026', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('Due: Fri, Nov 14, 2026', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('14 Nov 2026', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('Due 11/14/2026', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('11/14/26', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('2026-11-14', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('Due Nov 14', NOW), '2026-11-14', '연도 없으면 올해');
  assert.equal(P.parseDueDate('Due Jan 5', NOW), '2027-01-05', '이미 지난 달이면 내년');
  assert.equal(P.parseDueDate('Renewals left: 2', NOW), null);
  assert.equal(P.parseDueDate('Feb 30, 2026', NOW), null, '존재하지 않는 날짜');
});

test('Vega Discover 스타일 텍스트', () => {
  const text = `
Checkouts (3)
Sort by
Due date
The Midnight Library
Haig, Matt
Book
Due Nov 14, 2026
Renew
Educated : a memoir
Westover, Tara, 1986-
Book
Renewals left: 2
Due Dec 2, 2026
Renew
Klara and the Sun
Ishiguro, Kazuo
Large print
Due Oct 20, 2026
Overdue
Renew
`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(i => i.title), ['The Midnight Library', 'Educated : a memoir', 'Klara and the Sun']);
  assert.deepEqual(items.map(i => i.author), ['Haig, Matt', 'Westover, Tara', 'Ishiguro, Kazuo']);
  assert.deepEqual(items.map(i => i.due), ['2026-11-14', '2026-12-02', '2026-10-20']);
  assert.equal(items[2].overdue, true);
  assert.equal(items[0].overdue, false);
  assert.equal(items[2].format, 'Large print');
});

test('BiblioCommons 스타일 (by 저자, 라벨 다음 줄 날짜)', () => {
  const text = `Checked Out (2)
Project Hail Mary
by Weir, Andy
Book - 2021
Due by Nov 30, 2026
Renew
Place a hold
Pachinko
Lee, Min Jin
eBook
Due date
11/22/2026`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Project Hail Mary');
  assert.equal(items[0].author, 'Weir, Andy');
  assert.equal(items[0].format, 'Book');
  assert.equal(items[0].due, '2026-11-30');
  assert.equal(items[1].title, 'Pachinko');
  assert.equal(items[1].due, '2026-11-22');
});

test('표 형태(탭 구분) + 상대 날짜', () => {
  const text = `Title\tAuthor\tDue\nDune\tHerbert, Frank\t2026-11-05\nThe Hobbit\tTolkien, J. R. R.\tDue in 3 days`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Dune');
  assert.equal(items[0].author, 'Herbert, Frank');
  assert.equal(items[0].due, '2026-11-05');
  assert.equal(items[1].title, 'The Hobbit');
  assert.equal(items[1].due, '2026-10-28');
});

test('중복 제거 및 잡음 무시', () => {
  const text = `My Account\nCheckouts\nThe Midnight Library\nHaig, Matt\nDue Nov 14, 2026\nRenew\nThe Midnight Library\nHaig, Matt\nDue Nov 14, 2026`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.equal(items.length, 1);
});

test('반납일 없는 텍스트는 빈 배열', () => {
  assert.deepEqual(P.parseCheckoutsFromText('Hello world\nNothing here', { now: NOW }), []);
  assert.deepEqual(P.parseCheckoutsFromText('', { now: NOW }), []);
});

test('detectSearchTemplate / looksLikeCheckoutsUrl', () => {
  assert.equal(P.detectSearchTemplate('https://lib.example.org/search?query=harry+potter&searchType=everything'),
    'https://lib.example.org/search?query={q}&searchType=everything');
  assert.equal(P.detectSearchTemplate('https://lib.example.org/v2/search?q=dune'), 'https://lib.example.org/v2/search?q={q}');
  assert.equal(P.detectSearchTemplate('https://lib.example.org/account/checkouts'), null);
  assert.equal(P.detectSearchTemplate('not a url'), null);
  assert.equal(P.looksLikeCheckoutsUrl('https://lib.example.org/account/checkouts'), true);
  assert.equal(P.looksLikeCheckoutsUrl('https://lib.example.org/search?q=x'), false);
});
