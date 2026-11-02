// 지도사용 결과보고서 문단 샘플을 stdout으로 낸다(서식2 제작용).
const R = require('./core.js'), fs = require('fs');
const d = JSON.parse(fs.readFileSync(__dirname + '/data/sample-diagnosis.json'));
const dg = R.diagnose(d.industry, d.answers);
const rc = R.receipt(fs.readFileSync(__dirname + '/data/sample-log-synthetic.txt', 'utf8').split('\n'), { industry: d.industry, diagnosis: dg });
console.log(R.consultantBlock(rc, '예약 문의 자동답장(시연)'));
