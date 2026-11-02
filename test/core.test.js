const test = require('node:test'), assert = require('node:assert');
const R = require('../core.js');
const L = (n, ok = true, txt = '예약 문의 자동답장') => Array.from({ length: n }, (_, i) => `2026-10-0${1 + (i % 7)} 12:0${i % 10} ${txt} ${ok ? '성공' : '실패'}`);

test('진단: 주당 절감 추정 분 내림차순 상위 3', () => {
  const d = R.diagnose('식당', [{ code: 'reserve', perWeek: 40 }, { code: 'review', perWeek: 15 }, { code: 'order', perWeek: 5 }, { code: 'sns', perWeek: 4 }]);
  assert.equal(d.top3.length, 3);
  assert.equal(d.top3[0].code, 'reserve');
  assert.equal(d.top3[0].estMinPerWeek, 140);
  assert.ok(d.top3[0].estMinPerWeek >= d.top3[1].estMinPerWeek);
});
test('진단: 모르는 업종·업무코드는 오류', () => {
  assert.throws(() => R.diagnose('우주선', []));
  assert.throws(() => R.diagnose('식당', [{ code: 'zzz', perWeek: 1 }]));
  assert.throws(() => R.diagnose('식당', [{ code: 'reserve', perWeek: 'x' }]));
});
test('영수증: 성공 10 + 실패 1 + 미분류 1 -> 집계 10', () => {
  const lines = [...L(10), ...L(1, false), '2026-10-05 09:00 점심 먹음 성공'];
  const rc = R.receipt(lines, { industry: '식당' });
  assert.equal(rc.counted, 10); assert.equal(rc.failed, 1); assert.equal(rc.unclassified, 1);
  assert.equal(rc.totalMinutes, 10 * 3.5);
});
test('영수증: 환산액 = 분/60 x 시급, 시급에 비례', () => {
  const a = R.receipt(L(12), { industry: '식당', wage: 10320 }), b = R.receipt(L(12), { industry: '식당', wage: 10700 });
  assert.equal(a.won, Math.round(a.totalMinutes / 60 * 10320));
  assert.ok(b.won > a.won);
});
test('영수증: 보수 환산 문장이 반드시 있다', () => {
  const rc = R.receipt(L(10), { industry: '식당' });
  assert.match(R.renderText(rc), /보수 환산이며 실제 매출·비용 절감이 아닙니다/);
});
test('영수증: 형식 오류 줄은 세고 집계하지 않는다', () => {
  const rc = R.receipt([...L(10), '아무말'], { industry: '식당' });
  assert.equal(rc.malformed, 1); assert.equal(rc.counted, 10);
});
test('분류: 더 긴 키워드가 이긴다(소매 상품설명 대 문의)', () => {
  assert.equal(R.classify('소매', '상품설명 초안'), 'desc');
  assert.equal(R.classify('제조', '견적 메일'), 'quote');
});
test('차이 표: 켜지 않은 업무는 미실행, 켠 업무 달성률 계산', () => {
  const d = R.diagnose('식당', [{ code: 'reserve', perWeek: 10 }, { code: 'review', perWeek: 10 }]);
  const rc = R.receipt(L(10), { industry: '식당', diagnosis: d });
  const g = rc.gap.rows;
  assert.equal(g.find(x => x.code === 'review').actual, null);
  assert.ok(g.find(x => x.code === 'reserve').rate > 0);
  assert.equal(rc.gap.estTurnedOn, 35);
});
test('지도사 칸 문단: 도구명·건수·환산액·한계 문장이 들어간다', () => {
  const d = R.diagnose('식당', [{ code: 'reserve', perWeek: 10 }]);
  const rc = R.receipt(L(10), { industry: '식당', diagnosis: d });
  const b = R.consultantBlock(rc, '예약 문의 자동답장');
  assert.match(b, /활용 도구: 예약 문의 자동답장/); assert.match(b, /집계/); assert.match(b, /실제 매출·비용 절감 아님/); assert.match(b, /한계/);
});
test('처리량: 10만 줄을 1초 안에 집계한다', () => {
  const big = L(100000); const t0 = Date.now();
  const rc = R.receipt(big, { industry: '식당' });
  assert.equal(rc.counted, 100000); assert.ok(Date.now() - t0 < 1000);
});
