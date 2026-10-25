import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

test('확장 프로그램의 파서 사본이 원본(js/parse-checkouts.js)과 동일해야 함', () => {
  const a = readFileSync(join(here, '..', 'js', 'parse-checkouts.js'), 'utf8');
  const b = readFileSync(join(here, '..', 'extension', 'parse-checkouts.js'), 'utf8');
  assert.equal(a, b, '원본을 고쳤다면 extension/parse-checkouts.js 로 복사하세요: cp js/parse-checkouts.js extension/');
});

test('확장 manifest 유효성', () => {
  const m = JSON.parse(readFileSync(join(here, '..', 'extension', 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.content_scripts.some(cs => cs.js.includes('parse-checkouts.js') && cs.js.includes('content-library.js')));
  assert.ok(m.content_scripts.some(cs => cs.js.includes('content-planner.js')));
  for (const cs of m.content_scripts) for (const f of cs.js) readFileSync(join(here, '..', 'extension', f)); // 파일 존재
  for (const p of Object.values(m.icons)) readFileSync(join(here, '..', 'extension', p));
});
