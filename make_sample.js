// 합성(비식별) 시연 로그 생성 — 고정 시드, 실제 사업장 기록이 아니다.
let s = 20261102; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const perWeek = [31, 36, 38, 41], out = [];
const start = Date.parse('2026-09-28T00:00:00Z');
perWeek.forEach((n, w) => { for (let i = 0; i < n; i++) {
  const day = Math.floor(rnd() * 7), h = 9 + Math.floor(rnd() * 12), m = Math.floor(rnd() * 60);
  const d = new Date(start + (w * 7 + day) * 86400000).toISOString().slice(0, 10);
  const fail = rnd() < 0.05;
  out.push(`${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} 예약 문의 자동답장 ${fail ? '실패' : '성공'}`);
} });
for (let i = 0; i < 3; i++) out.push(`2026-10-0${i + 2} 15:30 매장 청소 점검 성공`);
out.sort();
require('fs').writeFileSync(__dirname + '/data/sample-log-synthetic.txt', out.join('\n') + '\n');
require('fs').writeFileSync(__dirname + '/data/sample-diagnosis.json', JSON.stringify({ industry: '식당', answers: [
  { code: 'reserve', perWeek: 40 }, { code: 'review', perWeek: 15 }, { code: 'order', perWeek: 5 }, { code: 'sns', perWeek: 4 }] }, null, 1));
console.log(out.length + '줄');
