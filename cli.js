#!/usr/bin/env node
// 사용: node cli.js diagnose data/sample-diagnosis.json | node cli.js receipt data/sample-diagnosis.json data/sample-log-synthetic.txt [시급]
const fs = require('fs'), R = require('./core.js');
const [cmd, a, b, c] = process.argv.slice(2);
try {
  if (cmd === 'diagnose') {
    const d = JSON.parse(fs.readFileSync(a, 'utf8')), r = R.diagnose(d.industry, d.answers);
    console.log('=== 5분 진단: AI로 아낄 수 있는 업무 상위 3 (추정, 주당 분) ===');
    r.top3.forEach((x, i) => console.log(`${i + 1}. ${x.name} 주 ${x.perWeek}건 -> 추정 ${x.estMinPerWeek}분`));
    console.log('다음 행동: 1위 업무 하나만 AI 도구를 켜고, 실행 기록을 한 줄씩 남기십시오.');
  } else if (cmd === 'receipt') {
    const d = JSON.parse(fs.readFileSync(a, 'utf8')), diag = R.diagnose(d.industry, d.answers);
    const lines = fs.readFileSync(b, 'utf8').split('\n');
    const t0 = process.hrtime.bigint();
    const rc = R.receipt(lines, { industry: d.industry, wage: c ? Number(c) : R.WAGE_2026, diagnosis: diag });
    console.log(R.renderText(rc));
    console.error('생성 ' + Number(process.hrtime.bigint() - t0) / 1e6 + 'ms');
  } else { console.error('사용: diagnose <진단.json> | receipt <진단.json> <로그.txt> [시급]'); process.exit(2); }
} catch (e) { console.error('오류: ' + e.message); process.exit(1); }
