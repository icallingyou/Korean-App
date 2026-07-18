#!/usr/bin/env node
/**
 * 국립국어원 한국어기초사전 오픈 API로 단어를 가져와
 * data/words.extra.js 에 추가하는 스크립트입니다.
 *
 * 준비물
 *   1) API 키 발급(무료): https://krdict.korean.go.kr/openApi/openApiRegister
 *   2) Node.js 18 이상
 *
 * 사용법
 *   KRDICT_API_KEY=발급받은키 node scripts/fetch-krdict.mjs 관습 성취 극복하다
 *   KRDICT_API_KEY=발급받은키 node scripts/fetch-krdict.mjs --file 단어목록.txt   (한 줄에 한 단어)
 *
 * 동작
 *   - 단어별로 검색 API(영어 번역 포함)에서 표제어를 찾고,
 *     상세 API에서 발음·품사·뜻풀이·예문(문장형 최대 2개)을 가져옵니다.
 *   - 결과를 data/words.extra.js 에 병합해 저장합니다(기존 항목 유지, 같은 단어는 갱신).
 *   - 예문의 "영어 번역"은 API가 제공하지 않으므로 빈 값으로 저장됩니다.
 *     (앱에서는 한국어 예문만 낭독·표시되며, 번역은 직접 채워 넣을 수 있어요.)
 *
 * 저작권
 *   한국어기초사전 콘텐츠는 CC BY-SA 2.0 KR 로 제공됩니다.
 *   가져온 데이터를 배포할 때는 출처(국립국어원 한국어기초사전)를 밝히고
 *   동일 조건 변경 허락 조건을 지켜 주세요.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://krdict.korean.go.kr/api';
const KEY = process.env.KRDICT_API_KEY;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'words.extra.js');
const TRANS_LANG_EN = 1; // 다국어 번역 언어 코드: 1 = 영어

if (!KEY) {
  console.error('❌ 환경 변수 KRDICT_API_KEY 가 필요합니다.');
  console.error('   발급: https://krdict.korean.go.kr/openApi/openApiRegister');
  console.error('   예시: KRDICT_API_KEY=xxxx node scripts/fetch-krdict.mjs 관습 성취');
  process.exit(1);
}

// ---------- 인자 파싱 ----------
let args = process.argv.slice(2);
if (args[0] === '--file') {
  if (!args[1]) { console.error('❌ --file 뒤에 파일 경로를 주세요.'); process.exit(1); }
  args = readFileSync(args[1], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
if (!args.length) {
  console.error('❌ 가져올 단어를 하나 이상 적어 주세요. 예) node scripts/fetch-krdict.mjs 관습 성취');
  process.exit(1);
}

// ---------- 아주 작은 XML 헬퍼 (이 API의 고정된 응답 형식 전용) ----------
const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&')
  .trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};
const blocks = (xml, name) =>
  [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const err = tag(text, 'error_code');
      if (err) throw new Error(`API 오류 ${err}: ${tag(text, 'message')}`);
      return text;
    } catch (e) {
      if (i === 2) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

// ---------- API 호출 ----------
async function searchWord(word) {
  const u = `${API}/search?key=${KEY}&q=${encodeURIComponent(word)}&part=word&method=exact` +
            `&translated=y&trans_lang=${TRANS_LANG_EN}&num=10&sort=dict`;
  const xml = await get(u);
  const items = blocks(xml, 'item');
  return items.find(it => tag(it, 'word') === word) || items[0] || null;
}

async function viewByTargetCode(code) {
  const u = `${API}/view?key=${KEY}&method=target_code&q=${code}&translated=y&trans_lang=${TRANS_LANG_EN}`;
  return get(u);
}

function firstSense(xml) {
  const senses = blocks(xml, 'sense_info');
  return senses[0] || '';
}

async function fetchEntry(word) {
  const hit = await searchWord(word);
  if (!hit) { console.warn(`  ⚠️ '${word}' 검색 결과 없음 — 건너뜁니다.`); return null; }
  const code = tag(hit, 'target_code');
  const view = await viewByTargetCode(code);
  const sense = firstSense(view);

  const pron = tag(view, 'pronunciation');
  const entry = {
    w: tag(view, 'word') || word,
    pos: tag(view, 'pos') || tag(hit, 'pos') || '',
    cat: '추가 단어',
    en: tag(sense, 'trans_word') || tag(hit, 'trans_word') || '',
    def: tag(sense, 'trans_dfn') || '',
    ko: tag(sense, 'definition') || '',
    ex: blocks(sense, 'example_info')
      .filter(b => tag(b, 'type') === '문장')
      .slice(0, 2)
      .map(b => [tag(b, 'example'), '']) // 예문 영어 번역은 API 미제공 → 직접 채워 넣기
  };
  if (pron && pron !== entry.w) entry.p = pron;
  return entry;
}

// ---------- 기존 파일 병합 ----------
function loadExisting() {
  if (!existsSync(OUT)) return [];
  const src = readFileSync(OUT, 'utf8');
  const m = src.match(/window\.WORDS_EXTRA\s*=\s*(\[[\s\S]*\]);/);
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}

const existing = loadExisting();
const results = [];
for (const word of args) {
  console.log(`▸ ${word} 가져오는 중...`);
  try {
    const entry = await fetchEntry(word);
    if (entry) { results.push(entry); console.log(`  ✓ ${entry.w} (${entry.en || '번역 없음'})`); }
  } catch (e) {
    console.warn(`  ⚠️ '${word}' 실패: ${e.message}`);
  }
  await sleep(250); // 서버 부담을 줄이기 위한 간격
}

const merged = [...existing.filter(e => !results.some(r => r.w === e.w)), ...results];
const body =
  '// scripts/fetch-krdict.mjs 가 생성한 추가 단어 파일입니다.\n' +
  '// 출처: 국립국어원 한국어기초사전 (CC BY-SA 2.0 KR) — https://krdict.korean.go.kr\n' +
  '// 예문의 영어 번역("")은 API가 제공하지 않으므로 필요하면 직접 채워 넣으세요.\n' +
  'window.WORDS_EXTRA = ' + JSON.stringify(merged, null, 1) + ';\n';
writeFileSync(OUT, body, 'utf8');
console.log(`\n✅ ${results.length}개 단어를 저장했습니다 → data/words.extra.js (총 ${merged.length}개)`);
