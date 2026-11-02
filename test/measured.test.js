const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const R = require('../core.js');
const AGG = { launched: 120, excluded_privacy: 10, no_end_or_overlong: 5, sample: 105, total_minutes: 1050, period_start: '2026-10-01', period_end: '2026-10-28', active_days: 20,
  types: { '심사·검토': { count: 60, minutes: 300, median_min: 3 }, '문서 작성': { count: 20, minutes: 400, median_min: 18 }, '제작·구현': { count: 25, minutes: 350, median_min: 12 } },
  method: '시작·종료 시각 차이', source: '작업 기록 파일 1개' };

test('실기록 영수증: 종류별 건수·분과 합계, 건수 내림차순이 아니라 분 내림차순', () => {
  const m = R.measuredReceipt(AGG);
  assert.equal(m.rows[0].name, '문서 작성');
  assert.equal(m.sample, 105); assert.equal(m.totalMinutes, 1050); assert.equal(m.hours, 17.5); assert.equal(m.kinds, 3);
  assert.equal(m.rows.reduce((s, r) => s + r.count, 0), 105);
});
test('실기록 영수증: 표본 10 미만이면 거부', () => {
  assert.throws(() => R.measuredReceipt({ ...AGG, sample: 9 }));
});
test('실기록 영수증: 종류별 합이 표본·합계와 어긋나면 거부', () => {
  assert.throws(() => R.measuredReceipt({ ...AGG, sample: 100 }));
});
test('실기록 영수증: 환산액(원)을 만들지 않는다 — 사람 수작업 분이 미측정이기 때문', () => {
  const m = R.measuredReceipt(AGG);
  assert.equal(m.won, undefined);
  assert.doesNotMatch(R.renderMeasuredText(m), /\d원/);
});
test('실기록 영수증: 「실측」 범위와 「미측정」을 명기한다', () => {
  const t = R.renderMeasuredText(R.measuredReceipt(AGG));
  assert.match(t, /실측/); assert.match(t, /미측정/); assert.match(t, /2026-10-01 ~ 2026-10-28/); assert.match(t, /표본 105건/);
  assert.match(t, /병렬/);
});
test('지도사 결과보고서 칸: 문제·조치·효과·근거 4칸이 모두 채워진다', () => {
  const s = R.supervisorReport(R.measuredReceipt(AGG));
  ['문제', '조치', '효과', '근거'].forEach(k => { assert.ok(s.fields[k] && s.fields[k].length > 20, k); });
  assert.match(s.text, /^\[문제\]/m); assert.match(s.text, /^\[조치\]/m); assert.match(s.text, /^\[효과\]/m); assert.match(s.text, /^\[근거\]/m);
});
test('지도사 칸: 효과 칸에 실측 숫자만 쓰고 절감액·절감 시간은 쓰지 않는다', () => {
  const s = R.supervisorReport(R.measuredReceipt(AGG));
  assert.match(s.fields['효과'], /105건/); assert.match(s.fields['효과'], /17\.5시간/);
  assert.doesNotMatch(s.text, /\d원/); assert.match(s.fields['효과'], /미측정/);
});
test('지도사 칸: 근거 칸에 기간·표본·제외 건수·방법·한계가 있다', () => {
  const f = R.supervisorReport(R.measuredReceipt(AGG)).fields['근거'];
  assert.match(f, /2026-10-01/); assert.match(f, /105/); assert.match(f, /제외 15/); assert.match(f, /시작·종료 시각 차이/); assert.match(f, /한계/);
});
test('지도사 칸: 개인 식별 낱말(이름·계정·전화)이 없다', () => {
  const t = R.supervisorReport(R.measuredReceipt(AGG)).text;
  assert.doesNotMatch(t, /@|010-|전화|계정/);
});
test('첫 영수증 경로: 사람 표본은 0이라 「미측정(사람 표본 0)」, 단계·클릭만 숫자', () => {
  const p = R.firstReceiptPath();
  assert.equal(p.humanSamples, 0); assert.equal(p.humanLabel, '미측정(사람 표본 0)');
  assert.equal(typeof p.keyless.steps, 'number'); assert.equal(typeof p.keyless.clicks, 'number');
  assert.ok(p.keyless.steps <= p.ownPaste.steps);
});
test('화면: 첫 화면이 열리면 클릭 없이 영수증을 그리고, 실기록 영수증 단추가 있다', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(h, /checkServer\(\)\.then\(function\(\)\{ruleLocal\(\);render\(\)\}\)/);
  assert.match(h, /id="btnMeasured"/); assert.match(h, /measured-aggregate\.js/);
});
