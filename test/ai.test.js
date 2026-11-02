const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const R = require('../core.js'), A = require('../ai.js');

const ok = (obj) => async () => ({ text: JSON.stringify(obj), usage: { in: 100, out: 50 }, ms: 10, model: 'fake-model' });
const boom = async () => { throw new Error('호출 실패(시험용)'); };

test('진단 AI: 올바른 JSON이면 출처 AI, 절감 분 내림차순', async () => {
  const call = ok({ tasks: [
    { name: '예약 답장', perWeek: 70, manualMin: 4, afterMin: 0.5, tools: ['자동답장'] },
    { name: '리뷰 답글', perWeek: 10, manualMin: 6, afterMin: 1, tools: ['글쓰기 도우미'] }] });
  const r = await A.diagnoseAI(call, '식당', '하루 10건 예약 문의에 답하고 주 10건 리뷰에 답글을 단다');
  assert.equal(r.source, 'AI'); assert.equal(r.model, 'fake-model');
  assert.equal(r.diag.all[0].name, '예약 답장'); assert.equal(r.diag.all[0].estMinPerWeek, 245);
  assert.ok(r.diag.all[0].estMinPerWeek >= r.diag.all[1].estMinPerWeek);
});
test('진단 AI: 호출 예외면 규칙으로 떨어지고 출처 규칙', async () => {
  const r = await A.diagnoseAI(boom, '식당', '예약 문의는 하루 10건, 리뷰 답글은 주 5건 정도 한다');
  assert.equal(r.source, '규칙'); assert.ok(r.diag.all.length >= 1); assert.ok(r.error);
});
test('진단 AI: 스키마 위반 항목(음수 건수·분 역전)은 버린다', async () => {
  const call = ok({ tasks: [
    { name: '정상', perWeek: 5, manualMin: 10, afterMin: 2, tools: [] },
    { name: '음수', perWeek: -3, manualMin: 10, afterMin: 2, tools: [] },
    { name: '역전', perWeek: 3, manualMin: 2, afterMin: 9, tools: [] }] });
  const r = await A.diagnoseAI(call, '제조', '업무 설명');
  assert.equal(r.source, 'AI'); assert.deepEqual(r.diag.all.map(x => x.name), ['정상']);
});
test('진단 AI: 유효 항목이 하나도 없으면 규칙으로 대체', async () => {
  const r = await A.diagnoseAI(ok({ tasks: [{ name: 'x', perWeek: -1, manualMin: 1, afterMin: 0 }] }), '식당', '예약 문의 하루 3건');
  assert.equal(r.source, '규칙');
});
test('규칙 진단: 하루 건수는 7배, 주 건수는 그대로', () => {
  const t = A.ruleDiagnose('식당', '예약 문의가 하루 10건이고 리뷰 답글은 주 5건이다');
  const rv = t.find(x => /예약/.test(x.name)), rw = t.find(x => /리뷰/.test(x.name));
  assert.equal(rv.perWeek, 70); assert.equal(rw.perWeek, 5);
});
test('분류 AI: 시각 없는 메신저 원문도 업무코드로 분류, 출처 AI', async () => {
  const diag = await A.diagnoseAI(ok({ tasks: [{ name: '예약 답장', perWeek: 10, manualMin: 4, afterMin: 1 }, { name: '리뷰 답글', perWeek: 4, manualMin: 6, afterMin: 1 }] }), '식당', 'x');
  const lines = ['손님: 오늘 저녁 자리 있나요 / 봇: 7시 가능합니다', '리뷰에 감사 답글 게시됨', '재료 입고'];
  const call = ok([{ i: 0, code: 'a1', status: '성공' }, { i: 1, code: 'a2', status: '성공' }, { i: 2, code: 'none', status: '성공' }]);
  const r = await A.classifyAI(call, diag.table, lines);
  assert.deepEqual(r.codes, ['a1', 'a2', null]); assert.deepEqual(r.sources, ['AI', 'AI', 'AI']);
});
test('분류 AI: 없는 코드를 돌려주면 그 줄만 규칙으로 재분류', async () => {
  const table = R.TABLE['식당'];
  const call = ok([{ i: 0, code: 'zzz', status: '성공' }, { i: 1, code: 'review', status: '실패' }]);
  const r = await A.classifyAI(call, table, ['예약 문의 답장 완료', '리뷰 답글']);
  assert.equal(r.codes[0], 'reserve'); assert.equal(r.sources[0], '규칙');
  assert.equal(r.codes[1], 'review'); assert.equal(r.statuses[1], '실패'); assert.equal(r.sources[1], 'AI');
});
test('분류 AI: 호출 예외여도 영수증이 나온다(규칙)', async () => {
  const lines = Array.from({ length: 10 }, (_, i) => `2026-10-0${1 + i % 7} 12:0${i} 예약 문의 자동답장 성공`);
  const c = await A.classifyAI(boom, R.TABLE['식당'], lines);
  assert.ok(c.sources.every(s => s === '규칙'));
  const rc = R.receipt(lines, { industry: '식당', codes: c.codes, statuses: c.statuses, sources: c.sources });
  assert.equal(rc.counted, 10); assert.equal(rc.ruleCount, 10); assert.equal(rc.aiCount, 0);
});
test('영수증: 날짜 없는 줄은 직전 줄 날짜를 따른다(관대 모드)', () => {
  const rc = R.receipt(['2026-10-01 09:00 예약 문의 성공', '예약 문의 또 하나', '리뷰 답글'], { industry: '식당', lenient: true });
  assert.equal(rc.counted, 3); assert.equal(rc.malformed, 0);
});
test('영수증: AI 분류 코드와 상태를 쓰면 출처별 집계가 나온다', () => {
  const lines = ['a', 'b', 'c'];
  const rc = R.receipt(lines, { industry: '식당', lenient: true, fallbackDate: '2026-10-01',
    codes: ['reserve', 'review', null], statuses: ['성공', '실패', '성공'], sources: ['AI', 'AI', 'AI'] });
  assert.equal(rc.counted, 1); assert.equal(rc.failed, 1); assert.equal(rc.unclassified, 1); assert.equal(rc.aiCount, 1);
});
test('키 값이 저장소 파일에 없다(변수 이름만 허용)', () => {
  const dir = path.join(__dirname, '..');
  const bad = [];
  (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? 0 : walk(p);
    if (/\.(js|html|json|md|txt|jsonl)$/.test(e.name) && /AIza[0-9A-Za-z_\-]{20,}/.test(fs.readFileSync(p, 'utf8'))) bad.push(p);
  }); })(dir);
  assert.deepEqual(bad, []);
});
