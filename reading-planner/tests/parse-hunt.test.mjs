import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../js/parse-checkouts.js');

// 적대적 검증에서 발견된 회귀/누락 사례들
const NOW = new Date(2026, 9, 25); // 2026-10-25
const qplBlock = (full, disp, by, barcode, status, dueLine) =>
  `${full} Book\n${disp}\n${by}\n${barcode}\n${status}\n${dueLine}\n(Checked out Oct 07, 2026)\n`;

test('형식/부가정보 단어로 시작하는 제목이 버려지지 않음 (Book lovers, Map of…, From…, Status…)', () => {
  const text = 'My Checked Out\nSelect All\nRENEW SELECTEDSort by: \nDue First\n' +
    qplBlock('Book Lovers', 'Book Lovers', 'By Henry, Emily, author.', '0228500000101', 'Checked Out', 'Due: Nov 06, 2026') +
    qplBlock('Map of the Heart', 'Map of the Heart', 'By Wiggs, Susan, author.', '0228500000102', 'Checked Out', 'Due: Nov 06, 2026') +
    qplBlock('From the Mixed-Up Files of Mrs. Basil E. Frankweiler', 'From the Mixed-Up Files ...', 'By Konigsburg, E. L., author.', '0228500000103', 'Checked Out', 'Due: Nov 07, 2026') +
    qplBlock('Status Anxiety', 'Status Anxiety', 'By De Botton, Alain, author.', '0228500000104', 'Checked Out', 'Due: Nov 07, 2026') +
    qplBlock('Copycat', 'Copycat', 'By Goldman, Alex, author.', '0228500000105', 'Checked Out', 'Due: Nov 08, 2026') +
    qplBlock('Borrowed Time', 'Borrowed Time', 'By Monk, Paul, author.', '0228500000106', 'Checked Out', 'Due: Nov 08, 2026') +
    qplBlock('The Hobbit', 'The Hobbit', 'By Tolkien, J. R. R., author.', '0228500000107', 'Checked Out', 'Due: Nov 09, 2026');
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.deepEqual(items.map(i => i.title), ['Book Lovers', 'Map of the Heart', 'From the Mixed-Up Files of Mrs. Basil E. Frankweiler', 'Status Anxiety', 'Copycat', 'Borrowed Time', 'The Hobbit']);
  assert.ok(!items.some(i => /sort by|renew selected/i.test(i.title)), '고정 헤더가 제목으로 새지 않음');
});

test('저자 모양 제목 (Hello, Universe / By Any Other Name / Olive, Again) — 제목 쌍 구조 우선', () => {
  const text =
    qplBlock('Hello, Universe', 'Hello, Universe', 'By Kelly, Erin Entrada, author.', '0228500000201', 'Checked Out', 'Due: Nov 08, 2026') +
    qplBlock('By Any Other Name', 'By Any Other Name', 'By Picoult, Jodi, 1966- author.', '0228500000202', 'Checked Out', 'Due: Nov 08, 2026') +
    qplBlock('Olive, Again', 'Olive, Again', 'By Strout, Elizabeth, author.', '0228500000203', 'Checked Out', 'Due: Nov 09, 2026') +
    qplBlock('1984', '1984', 'By Orwell, George, 1903-1950, author.', '0228500000204', 'Checked Out', 'Due: Nov 09, 2026') +
    qplBlock('Home', 'Home', 'By Morrison, Toni, author.', '0228500000205', 'Checked Out', 'Due: Nov 10, 2026');
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.deepEqual(items.map(i => i.title), ['Hello, Universe', 'By Any Other Name', 'Olive, Again', '1984', 'Home']);
  assert.deepEqual(items.map(i => i.author), ['Kelly, Erin Entrada', 'Picoult, Jodi', 'Strout, Elizabeth', 'Orwell, George', 'Morrison, Toni']);
});

test('Vega 레이아웃: 저자 줄에 By가 없어도 제목을 잃지 않음', () => {
  const text = `Beta\nSmith, John, 1950-2020, editor.\nBook\nDue Nov 02, 2026\nRenew\nDelta\nHaig, Matt, 1975- author.\nBook\nDue Nov 03, 2026\nRenew\nEpsilon\n한 강, 1970-\nBook\nDue Nov 04, 2026\nRenew\nHello, Universe\nKelly, Erin Entrada\nBook\nDue Nov 05, 2026\nRenew`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.deepEqual(items.map(i => i.title), ['Beta', 'Delta', 'Epsilon', 'Hello, Universe']);
  assert.deepEqual(items.map(i => i.author), ['Smith, John', 'Haig, Matt', '한 강', 'Kelly, Erin Entrada']);
});

test('상대 반납일 줄은 제목이 되지 않고, 이전 항목으로 넘어가지 않음', () => {
  const text = `Pachinko\nby Lee, Min Jin\neBook\nDue in 3 days\nDue by Oct 28, 2026\nRenew\nDune\nHerbert, Frank\nBook\nDue in 3 days\nRenew\nHome\nMorrison, Toni\nBook\nDue Nov 06, 2026`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.deepEqual(items.map(i => [i.title, i.due]), [['Pachinko', '2026-10-28'], ['Dune', '2026-10-28'], ['Home', '2026-11-06']]);
});

test('한 줄에 대출일과 반납일이 함께 있으면 반납 단어 뒤의 날짜를 쓴다', () => {
  assert.equal(P.parseDueDate('Checked out Oct 07, 2026 · Due Nov 14, 2026', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('Due Nov 14, 2026 · Checked out Oct 07, 2026', NOW), '2026-11-14');
  assert.equal(P.parseDueDate('4 days until due: Oct 28, 2026', NOW), '2026-10-28');
  const items = P.parseCheckoutsFromText('Dune\nHerbert, Frank\nBook\nChecked out Oct 07, 2026 · Due Nov 14, 2026', { now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].due, '2026-11-14');
  assert.equal(items[0].overdue, false);
});

test('표에 대출일 열과 반납일 열이 함께 있으면 반납일만 (가장 늦은 날짜)', () => {
  const text = `Title\tAuthor\tChecked out\tDue\nDune\tHerbert, Frank\t10/07/2026\t11/14/2026\nThe Hobbit\tTolkien, J. R. R.\t10/01/2026\t11/05/2026`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.deepEqual(items.map(i => [i.title, i.due, i.overdue]), [['Dune', '2026-11-14', false], ['The Hobbit', '2026-11-05', false]]);
  const vertical = `Pachinko\nLee, Min Jin\nChecked out\n10/07/2026\nDue date\n11/22/2026`;
  const v = P.parseCheckoutsFromText(vertical, { now: NOW });
  assert.deepEqual(v.map(i => [i.title, i.due]), [['Pachinko', '2026-11-22']]);
});

test('하이픈 날짜(Sierra WebPAC) 인식', () => {
  assert.equal(P.parseDueDate('DUE 11-14-26', NOW), '2026-11-14');
  const items = P.parseCheckoutsFromText('Dune / Frank Herbert\t31234000001\tDUE 11-14-26\tFIC HERBERT', { now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].due, '2026-11-14');
});

test('예약(hold) 만료일은 대출로 들어오지 않음', () => {
  const holds = `Holds (1)\nThe Hobbit\nTolkien, J. R. R.\nBook\nReady for pickup\nExpires Nov 01, 2026`;
  assert.deepEqual(P.parseCheckoutsFromText(holds, { now: NOW }), []);
  const ebook = `Project Hail Mary\nWeir, Andy\neBook\nExpires Nov 01, 2026`;
  assert.equal(P.parseCheckoutsFromText(ebook, { now: NOW }).length, 1);
});

test('다음 카드의 상태 배지를 이 항목에 붙이지 않음 (BiblioCommons)', () => {
  const text = `OVERDUE\nProject Hail Mary\nby Weir, Andy\nBook - 2021\nDue by Oct 20, 2026\nRenew\nPlace a hold\nDUE SOON\nPachinko\nby Lee, Min Jin\nBook - 2017\nDue by Oct 27, 2026\nRenew`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Project Hail Mary');
  assert.match(items[0].status, /overdue/i);
  assert.equal(items[0].overdue, true);
  assert.equal(items[1].title, 'Pachinko');
  assert.match(items[1].status, /due soon/i);
  assert.equal(items[1].format, 'Book');
});

test('마크다운: 굵게·파이프 표', () => {
  const md = `- **[The Midnight Library](https://lib/bib/1)**\nby Haig, Matt\nBook\nDue Nov 14, 2026\n\n| Title | Author | Due |\n|---|---|---|\n| Dune | Herbert, Frank | 2026-11-05 |\n| The Hobbit | Tolkien, J. R. R. | Due in 3 days |`;
  const items = P.parseCheckoutsFromText(md, { now: NOW });
  assert.deepEqual(items.map(i => [i.title, i.due]), [['The Midnight Library', '2026-11-14'], ['Dune', '2026-11-05'], ['The Hobbit', '2026-10-28']]);
});

test('저자 정리: 약어·공동 저자·First Last 순서', () => {
  const c = P._internal.cleanAuthor;
  assert.equal(c('By Seuss, Dr.'), 'Seuss, Dr.');
  assert.equal(c('By Preston, Douglas, author ; Child, Lincoln, author.'), 'Preston, Douglas');
  assert.equal(c('By Author, Viktor E. (Viktor Emil), 1905-1997, author.'), 'Author, Viktor E.');
  assert.equal(c('By Smith, John, 1950-2020, editor.'), 'Smith, John');
  assert.equal(c('by J. K. Rowling'), 'J. K. Rowling');
});

test('분실 항목: 연체 일수 역산 날짜와 명시 날짜가 어긋나면 명시 날짜 유지, "3 days overdue" 단독 줄도 인식', () => {
  const text = `Same bed different dreams Book\nSame bed different dreams\nBy Park, Ed, author.\n0228645465110\nOverdue\n18 days\nDue: Oct 08, 2026\n(Checked out Aug 27, 2026)`;
  const items = P.parseCheckoutsFromText(text, { now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].due, '2026-10-08');
  assert.equal(items[0].dueInferred, false);
  const late = `Educated\nWestover, Tara\nBook\n3 days overdue`;
  const l = P.parseCheckoutsFromText(late, { now: NOW });
  assert.deepEqual(l.map(i => [i.title, i.due, i.overdue]), [['Educated', '2026-10-22', true]]);
});

test('looksLikeCheckoutsUrl: 계정 개요/예약/수수료 페이지는 제외', () => {
  assert.equal(P.looksLikeCheckoutsUrl('https://www.queenslibrary.org/my-account/checkouts'), true);
  assert.equal(P.looksLikeCheckoutsUrl('https://lib.example.org/checkedout'), true);
  assert.equal(P.looksLikeCheckoutsUrl('https://www.queenslibrary.org/my-account'), false);
  assert.equal(P.looksLikeCheckoutsUrl('https://www.queenslibrary.org/my-account/requests'), false);
  assert.equal(P.looksLikeCheckoutsUrl('https://www.queenslibrary.org/bib/1136972'), false);
});
