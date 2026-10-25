import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../js/parse-checkouts.js');

// queenslibrary.org/my-account/checkouts 의 실제 innerText 구조를 익명화한 표본.
// 항목마다: [전체 제목 + 형식] / [잘린 제목] / By 저자 / 바코드 / 상태 / 반납 정보 / (대출일) / 연장 안내
const NOW = new Date(2026, 9, 25); // 2026-10-25
const QPL = `My Checked Out
View a list of currently checked out materials.


Select All
RENEW SELECTEDSort by:
Due First
The Tiny Robot Handbook Book
The Tiny Robot Handbook

By Example, Alice, author.

0228500000001

Assumed lost

59 days

(Checked out Jun 23, 2026)

You have renewed 2 time(s) (2 of 3 allowed)

 Why can't I renew?

 바다의 노래 : 가상 장편소설. / Pada ŭi norae : kasang changp'yŏn sosŏl.Book
바다의 노래 : 가상 ...

By 홍 길동, 1970- / Hong, Kil-tong, 1970-

0228500000002

Assumed lost

32 days

(Checked out Jun 29, 2026)

You have renewed 3 time(s) (3 of 3 allowed)

 Why can't I renew?

Quiet Rivers : a novel in three parts Book
Quiet Rivers : a novel in three ...

By Sample, Bob, 1970- author.

0228500000003

Overdue

Due: Oct 08, 2026

(Checked out Aug 27, 2026)

You have renewed 1 time(s) (1 of 3 allowed)

 달리는 고양이. 2   / Tallinŭn koyangi. 2 Book
달리는 고양이. 2 ...

By 김 예시, illustrator / Kim, Ye-si, author, illustrator.

0228500000004

Checked Out

4 days until due: Oct 28, 2026

(Checked out Oct 07, 2026)

Wednesday morning : stories Book
Wednesday morning : stories

By Writer, Jane, 1972- author.

0228500000005

Checked Out

6 days until due: Oct 30, 2026

(Checked out Aug 28, 2026)

You have renewed 2 time(s) (2 of 3 allowed)

 기억의 서재 : 어느 독서가의 인생 강의   / Kiŏk ŭi sŏjae : ŏnŭ toksŏga ŭi insaeng kangŭi Book
기억의 서재 : ...

By Author, Viktor E. (Viktor Emil), 1905-1997, author.

0228500000006

Requested by another customer

Due: Nov 06, 2026

(Checked out Oct 16, 2026)

 Why can't I renew?

MY ACCOUNT
Account Overview
Checked Out
Fees
`;

test('QPL 대출 중 페이지: 6권 모두 인식 (분실 처리·연체·예약·일반)', () => {
  const items = P.parseCheckoutsFromText(QPL, { now: NOW });
  assert.equal(items.length, 6, JSON.stringify(items.map(i => i.title)));
  assert.deepEqual(items.map(i => i.title), [
    'The Tiny Robot Handbook',
    '바다의 노래 : 가상 장편소설.',
    'Quiet Rivers : a novel in three parts',
    '달리는 고양이. 2',
    'Wednesday morning : stories',
    '기억의 서재 : 어느 독서가의 인생 강의'
  ]);
});

test('QPL: 상태 라벨은 제목이 되지 않음', () => {
  const items = P.parseCheckoutsFromText(QPL, { now: NOW });
  for (const it of items) assert.ok(!/^(overdue|assumed lost|checked out|requested by another customer)$/i.test(it.title), it.title);
});

test('QPL: 반납일 — 명시된 날짜, "N days until due", 분실 항목은 "N days" 연체로 역산', () => {
  const items = P.parseCheckoutsFromText(QPL, { now: NOW });
  const by = Object.fromEntries(items.map(i => [i.title, i]));
  assert.equal(by['Quiet Rivers : a novel in three parts'].due, '2026-10-08');
  assert.equal(by['Quiet Rivers : a novel in three parts'].overdue, true);
  assert.equal(by['달리는 고양이. 2'].due, '2026-10-28');
  assert.equal(by['Wednesday morning : stories'].due, '2026-10-30');
  assert.equal(by['기억의 서재 : 어느 독서가의 인생 강의'].due, '2026-11-06');
  assert.equal(by['The Tiny Robot Handbook'].due, '2026-08-27', '59일 연체 → 오늘 - 59일');
  assert.equal(by['The Tiny Robot Handbook'].overdue, true);
  assert.match(by['The Tiny Robot Handbook'].status || '', /lost/i);
  assert.equal(by['바다의 노래 : 가상 장편소설.'].due, '2026-09-23');
});

test('QPL: 저자 정리 (By 제거, 역할어·생몰년·로마자 병기 제거)', () => {
  const items = P.parseCheckoutsFromText(QPL, { now: NOW });
  const by = Object.fromEntries(items.map(i => [i.title, i.author]));
  assert.equal(by['The Tiny Robot Handbook'], 'Example, Alice');
  assert.equal(by['바다의 노래 : 가상 장편소설.'], '홍 길동');
  assert.equal(by['Quiet Rivers : a novel in three parts'], 'Sample, Bob');
  assert.equal(by['달리는 고양이. 2'], '김 예시');
  assert.equal(by['기억의 서재 : 어느 독서가의 인생 강의'], 'Author, Viktor E.');
});

test('QPL: 연장 가능 여부·상태 플래그', () => {
  const items = P.parseCheckoutsFromText(QPL, { now: NOW });
  const by = Object.fromEntries(items.map(i => [i.title, i]));
  assert.equal(by['기억의 서재 : 어느 독서가의 인생 강의'].renewable, false);
  assert.match(by['기억의 서재 : 어느 독서가의 인생 강의'].status, /requested/i);
  assert.equal(by['달리는 고양이. 2'].renewable, true);
  assert.equal(by['The Tiny Robot Handbook'].renewable, false);
});

test('QPL: 마크다운 복사본(링크 대괄호, 형식이 별도 줄)도 인식', () => {
  const md = `Book
[달리는 고양이. 2 ...](https://www.queenslibrary.org/bib/1)
By 김 예시, illustrator / Kim, Ye-si, author, illustrator.
0228500000004
Checked Out
4 days until due: Oct 28, 2026
(Checked out Oct 07, 2026)
Book
[Quiet Rivers : a novel ...](https://www.queenslibrary.org/bib/2)
By Sample, Bob, 1970- author.
0228500000003
Overdue
Due: Oct 08, 2026
(Checked out Aug 27, 2026)`;
  const items = P.parseCheckoutsFromText(md, { now: NOW });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '달리는 고양이. 2 ...');
  assert.equal(items[0].due, '2026-10-28');
  assert.equal(items[1].title, 'Quiet Rivers : a novel ...');
  assert.equal(items[1].overdue, true);
});

test('한글만 있는 제목 줄이 잡음으로 버려지지 않음', () => {
  const txt = `작별하지 않는다 : 한강 ...
By 한 강, 1970-
0228632939564
Checked Out
6 days until due: Oct 30, 2026`;
  const items = P.parseCheckoutsFromText(txt, { now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '작별하지 않는다 : 한강 ...');
});
