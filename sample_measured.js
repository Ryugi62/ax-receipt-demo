// 실기록 영수증·지도사 칸 출력을 명령줄로 낸다(서식2 빌드와 시연 재현용). 사용: node sample_measured.js [receipt|supervisor]
const R = require('./core.js'), fs = require('fs'), path = require('path');
const agg = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'measured-aggregate.json'), 'utf8'));
const m = R.measuredReceipt(agg);
console.log(process.argv[2] === 'supervisor' ? R.supervisorReport(m).text : R.renderMeasuredText(m));
