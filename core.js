// 도메인 코어 — 프레임워크·I/O를 모른다. 브라우저와 node에서 같이 쓴다.
(function (root) {
  'use strict';
  var WAGE_2026 = 10320, WAGE_2027 = 10700;
  var NOTE = '보수 환산이며 실제 매출·비용 절감이 아닙니다. 기준표 분 값은 작성자 가정값(출처 없음)으로, 사장님 본인 값으로 바꿔 쓰십시오.';

  // 기준표: 업종 -> 업무코드 -> {name, manual(수작업 건당 분), after(AI 처리 후 사장님 확인 분), keys}
  var TABLE = {
    '식당': {
      reserve: { name: '예약·문의 답장', manual: 4, after: 0.5, keys: ['예약', '문의'] },
      review: { name: '리뷰 답글 초안', manual: 6, after: 1, keys: ['리뷰'] },
      order: { name: '발주·재고 메모 정리', manual: 10, after: 2, keys: ['발주', '재고'] },
      sns: { name: '공지·SNS 글', manual: 15, after: 3, keys: ['공지', 'SNS', '인스타'] }
    },
    '소매': {
      cs: { name: '고객 문의 답장', manual: 5, after: 1, keys: ['문의', '답장'] },
      desc: { name: '상품 설명 작성', manual: 20, after: 4, keys: ['상품설명', '상품 설명'] },
      invoice: { name: '주문서 송장 정리', manual: 3, after: 0.5, keys: ['송장', '주문서'] },
      review: { name: '후기 답글', manual: 6, after: 1, keys: ['후기', '리뷰'] }
    },
    '제조': {
      quote: { name: '견적서 초안', manual: 25, after: 5, keys: ['견적'] },
      report: { name: '작업일지 정리', manual: 12, after: 3, keys: ['작업일지', '일지'] },
      mail: { name: '거래처 메일 초안', manual: 8, after: 2, keys: ['메일'] },
      stock: { name: '재고표 갱신', manual: 10, after: 2, keys: ['재고'] }
    }
  };

  function saving(row) { return Math.max(0, row.manual - row.after); }

  // 진단: answers = [{code, perWeek}] -> 주당 절감 추정 분 내림차순
  function diagnose(industry, answers) {
    var t = TABLE[industry];
    if (!t) throw new Error('알 수 없는 업종: ' + industry);
    var rows = [];
    answers.forEach(function (a) {
      var r = t[a.code];
      if (!r) throw new Error('알 수 없는 업무코드: ' + a.code);
      var perWeek = Number(a.perWeek);
      if (!(perWeek >= 0)) throw new Error('주당 건수가 숫자가 아닙니다: ' + a.code);
      rows.push({ code: a.code, name: r.name, perWeek: perWeek, estMinPerWeek: Math.round(perWeek * saving(r) * 10) / 10 });
    });
    rows.sort(function (x, y) { return y.estMinPerWeek - x.estMinPerWeek; });
    return { industry: industry, top3: rows.slice(0, 3), all: rows };
  }

  // 실행 기록 한 줄: 「YYYY-MM-DD HH:MM 업무 설명 상태」 (상태 = 성공|실패, 없으면 성공)
  function parseLine(line) {
    var m = /^\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+?)\s*$/.exec(line);
    if (!m) return null;
    var rest = m[3], status = '성공';
    var s = /\s(성공|실패)$/.exec(rest);
    if (s) { status = s[1]; rest = rest.slice(0, s.index); }
    return { date: m[1], time: m[2], text: rest, status: status };
  }

  function classify(industry, text) { return classifyIn(TABLE[industry], text); }
  function classifyIn(t, text) {
    var best = null, bestLen = 0;
    Object.keys(t).forEach(function (code) {
      t[code].keys.forEach(function (k) {
        if (text.indexOf(k) >= 0 && k.length > bestLen) { best = code; bestLen = k.length; }
      });
    });
    return best;
  }

  function weekIndex(date, start) {
    var d = Date.parse(date + 'T00:00:00Z'), s = Date.parse(start + 'T00:00:00Z');
    return Math.floor((d - s) / 86400000 / 7);
  }

  // 영수증: lines(문자열 배열), opts {industry, wage, diagnosis(선택)}
  function receipt(lines, opts) {
    var industry = opts.industry, wage = Number(opts.wage || WAGE_2026), t = opts.table || TABLE[industry];
    var parsed = [], bad = 0, failed = 0, unclassified = 0, counted = [], aiCount = 0, ruleCount = 0;
    var lastDate = opts.fallbackDate || new Date().toISOString().slice(0, 10);
    lines.forEach(function (ln, idx) {
      if (!ln.trim()) return;
      var p = parseLine(ln);
      if (!p && opts.lenient) {
        var m = /(\d{4}-\d{2}-\d{2})/.exec(ln);
        p = { date: m ? m[1] : lastDate, time: '', text: ln.trim(), status: '성공' };
      }
      if (!p) { bad++; return; }
      lastDate = p.date;
      if (opts.statuses && opts.statuses[idx]) p.status = opts.statuses[idx];
      parsed.push(p);
      if (p.status === '실패') { failed++; return; }
      var code = opts.codes ? opts.codes[idx] : classifyIn(t, p.text);
      if (!code || !t[code]) { unclassified++; return; }
      p.code = code; counted.push(p);
      if (opts.sources && opts.sources[idx] === 'AI') aiCount++; else ruleCount++;
    });
    var byCode = {}, total = 0;
    counted.forEach(function (p) {
      var r = t[p.code], s = saving(r);
      var b = byCode[p.code] || (byCode[p.code] = { code: p.code, name: r.name, count: 0, minutes: 0, perWeek: {} });
      b.count++; b.minutes += s; total += s;
    });
    var dates = parsed.map(function (p) { return p.date; }).sort();
    var start = dates[0], end = dates[dates.length - 1];
    var weeks = start ? weekIndex(end, start) + 1 : 0;
    counted.forEach(function (p) {
      var w = weekIndex(p.date, start), b = byCode[p.code];
      b.perWeek[w] = (b.perWeek[w] || 0) + saving(t[p.code]);
    });
    var rows = Object.keys(byCode).map(function (k) { return byCode[k]; });
    rows.sort(function (a, b) { return b.minutes - a.minutes; });
    var hours = total / 60;
    var out = {
      industry: industry, wage: wage, start: start, end: end, weeks: weeks,
      linesTotal: parsed.length + bad, counted: counted.length, failed: failed, unclassified: unclassified, malformed: bad,
      aiCount: aiCount, ruleCount: ruleCount, rows: rows, totalMinutes: Math.round(total * 10) / 10, hours: Math.round(hours * 100) / 100,
      won: Math.round(hours * wage), wonAt2027: Math.round(hours * WAGE_2027), note: NOTE
    };
    if (opts.diagnosis) out.gap = gapTable(opts.diagnosis, out);
    return out;
  }

  // 진단 추정 대 영수증 집계: 업무별 주평균 비교. 켜지 않은 업무는 「미실행」.
  function gapTable(diag, rc) {
    var weeks = Math.max(1, rc.weeks);
    var rows = diag.all.map(function (d) {
      var actual = rc.rows.filter(function (r) { return r.code === d.code; })[0];
      var act = actual ? Math.round(actual.minutes / weeks * 10) / 10 : null;
      return { code: d.code, name: d.name, est: d.estMinPerWeek, actual: act,
        rate: act === null || d.estMinPerWeek === 0 ? null : Math.round(act / d.estMinPerWeek * 1000) / 10 };
    });
    var est = 0, act = 0, estOn = 0;
    rows.forEach(function (r) { est += r.est; if (r.actual !== null) { act += r.actual; estOn += r.est; } });
    return { rows: rows, estTotal: Math.round(est * 10) / 10, actualTotal: Math.round(act * 10) / 10,
      estTurnedOn: Math.round(estOn * 10) / 10,
      rateTurnedOn: estOn ? Math.round(act / estOn * 1000) / 10 : null };
  }

  function won(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원'; }

  function renderText(rc) {
    var L = [];
    L.push('=== 주간 영수증 (' + rc.industry + ', ' + rc.start + ' ~ ' + rc.end + ', ' + rc.weeks + '주) ===');
    rc.rows.forEach(function (r) { L.push(r.name + ' ' + r.count + '건 -> ' + r.minutes + '분'); });
    L.push('집계 ' + rc.counted + '건 / 실패 ' + rc.failed + ' / 미분류 ' + rc.unclassified + ' / 형식오류 ' + rc.malformed);
    L.push('아낀 시간 ' + rc.hours + '시간 x 시급 ' + won(rc.wage) + ' = ' + won(rc.won));
    L.push('(참고: 2027년 시급 ' + won(WAGE_2027) + ' 적용 시 ' + won(rc.wonAt2027) + ')');
    L.push('※ ' + rc.note);
    if (rc.gap) {
      L.push('--- 진단 추정 대 영수증 집계 (주당 분) ---');
      rc.gap.rows.forEach(function (g) { L.push(g.name + ' | 추정 ' + g.est + ' | 집계 ' + (g.actual === null ? '미실행' : g.actual) + ' | ' + (g.rate === null ? '-' : g.rate + '%')); });
      L.push('켠 업무 기준 달성률 ' + rc.gap.rateTurnedOn + '% (추정 ' + rc.gap.estTurnedOn + ' 대 집계 ' + rc.gap.actualTotal + ')');
    }
    return L.join('\n');
  }


  // 지도사용: 서식2 「주요 기능·기대효과」 칸에 옮겨 적을 문단(진단 후 영수증 첨부용)
  function consultantBlock(rc, toolName) {
    var g = rc.gap, L = [];
    L.push('활용 도구: ' + (toolName || '(사장님이 켠 AI 도구명)') + ' · 업종 ' + rc.industry + ' · 기간 ' + rc.start + '~' + rc.end + ' (' + rc.weeks + '주)');
    L.push('실행 기록 ' + rc.counted + '건 집계(실패 ' + rc.failed + '·미분류 ' + rc.unclassified + ' 제외)');
    L.push('아낀 시간 ' + rc.hours + '시간, 시급 ' + won(rc.wage) + ' 보수 환산 ' + won(rc.won) + ' (실제 매출·비용 절감 아님)');
    if (g) L.push('진단 추정 대비 집계: 켠 업무 기준 ' + (g.rateTurnedOn === null ? '-' : g.rateTurnedOn + '%') + ' (추정 ' + g.estTurnedOn + '분/주 대 집계 ' + g.actualTotal + '분/주)');
    L.push('한계: 기준표 분 값은 가정값이며 사장님 본인 값으로 교체 가능');
    return L.join('\n');
  }


  // ---- 실사업장 1곳 실기록 영수증 (실측은 건수·소요 분뿐) ----
  // agg = tools/extract_lanes.py 가 만든 비식별 집계. 사람이 직접 했을 때의 분은 측정하지 않았으므로 절감 시간·원 환산을 만들지 않는다.
  function measuredReceipt(agg) {
    if (!agg || !(agg.sample >= 10)) throw new Error('표본이 10건 미만입니다');
    var rows = Object.keys(agg.types).map(function (k) { var t = agg.types[k]; return { name: k, count: t.count, minutes: t.minutes, median: t.median_min }; });
    var n = 0, mins = 0; rows.forEach(function (r) { n += r.count; mins += r.minutes; });
    if (n !== agg.sample) throw new Error('종류별 건수의 합이 표본과 다릅니다');
    if (Math.abs(mins - agg.total_minutes) > rows.length) throw new Error('종류별 분의 합이 합계와 다릅니다');
    rows.sort(function (a, b) { return b.minutes - a.minutes; });
    return { start: agg.period_start, end: agg.period_end, activeDays: agg.active_days, launched: agg.launched,
      sample: agg.sample, excluded: agg.excluded_privacy + agg.no_end_or_overlong, excludedPrivacy: agg.excluded_privacy, noEnd: agg.no_end_or_overlong,
      totalMinutes: agg.total_minutes, hours: Math.round(agg.total_minutes / 60 * 10) / 10, kinds: rows.length, rows: rows,
      method: agg.method, source: agg.source };
  }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var PARALLEL = '합계는 여러 작업이 동시에 돌아간 병렬 합산이며 달력 시간이 아닙니다.';
  function renderMeasuredText(m) {
    var L = ['=== 실사업장 1곳 실기록 영수증 (실측: 건수·소요 분만) ===', '기간 ' + m.start + ' ~ ' + m.end + ' (작업이 있던 날 ' + m.activeDays + '일) · 표본 ' + num(m.sample) + '건 · 업무 종류 ' + m.kinds + '가지'];
    m.rows.forEach(function (r) { L.push(r.name + ' ' + num(r.count) + '건 -> ' + num(r.minutes) + '분 (건당 중앙값 ' + r.median + '분)'); });
    L.push('합계 ' + num(m.totalMinutes) + '분(' + num(m.hours) + '시간). ' + PARALLEL);
    L.push('시작 기록 ' + num(m.launched) + '건 중 제외 ' + num(m.excluded) + '건(민감 분야 ' + num(m.excludedPrivacy) + ' · 종료 기록 없음·24시간 초과 ' + num(m.noEnd) + ').');
    L.push('실측 범위: AI가 맡은 작업의 건수와 소요 분. 사람이 직접 했을 때의 분은 미측정이라 절감 시간·원 환산은 내지 않습니다.');
    return L.join('\n');
  }
  // 지도사 결과보고서 칸(문제·조치·효과·근거)에 옮겨 적는 출력
  function supervisorReport(m) {
    var top = m.rows.slice(0, 3).map(function (r) { return r.name + ' ' + num(r.count) + '건·' + num(r.minutes) + '분'; }).join(', ');
    var f = {
      '문제': 'AI에게 맡긴 일이 어떤 종류로 몇 건, 얼마나 걸렸는지가 한 장으로 남아 있지 않아 AI를 쓰는 효과를 말로만 설명하게 된다. 대상은 제안자 본인의 1인 사업체(간이과세 개인사업자)이고, 남아 있는 것은 작업 시작·종료 시각 기록 파일 1개뿐이다.',
      '조치': '작업 기록 ' + num(m.launched) + '건을 업무 종류 ' + m.kinds + '가지(' + m.rows.map(function (r) { return r.name; }).join(', ') + ')로 분류해 건수와 소요 분을 집계하고, 이름·내용·금액 없이 종류별 숫자만 영수증 1장으로 만들었다.',
      '효과': m.start + ' ~ ' + m.end + ' 동안 AI가 맡아 끝낸 작업 ' + num(m.sample) + '건, 소요 합계 ' + num(m.hours) + '시간(' + num(m.totalMinutes) + '분, 병렬 합산). 소요가 큰 종류: ' + top + '. 사람이 직접 했을 때의 시간은 미측정이라 절감 시간·절감액은 쓰지 않는다.',
      '근거': '기간 ' + m.start + ' ~ ' + m.end + ' · 표본 ' + num(m.sample) + '건 · 제외 ' + num(m.excluded) + '건(민감 분야 ' + num(m.excludedPrivacy) + ', 종료 기록 없음·24시간 초과 ' + num(m.noEnd) + '). 방법: ' + m.method + ' 한계: 업무 종류는 설명 낱말 규칙이고, 소요 분에는 대기 시간이 들어 있으며, 사람 대조군이 없다. 자료: ' + m.source + '.'
    };
    var text = ['문제', '조치', '효과', '근거'].map(function (k) { return '[' + k + '] ' + f[k]; }).join('\n');
    return { fields: f, text: text };
  }
  // 첫 영수증까지: 사람 표본이 없으면 미측정으로 적고, 단계·클릭만 숫자(화면 코드와 시험으로 확인)
  function firstReceiptPath() {
    return { humanSamples: 0, humanLabel: '미측정(사람 표본 0)',
      keyless: { steps: 1, clicks: 0, how: 'index.html 열기 — 합성 기록이 채워져 있어 첫 화면에서 영수증이 바로 그려진다' },
      ownPaste: { steps: 3, clicks: 1, how: 'index.html 열기 → 본인 기록 붙여넣기 → 「영수증 만들기」 1회 클릭' } };
  }

  var api = { measuredReceipt: measuredReceipt, renderMeasuredText: renderMeasuredText, supervisorReport: supervisorReport, firstReceiptPath: firstReceiptPath, consultantBlock: consultantBlock, TABLE: TABLE, WAGE_2026: WAGE_2026, WAGE_2027: WAGE_2027, NOTE: NOTE, diagnose: diagnose, parseLine: parseLine,
    classify: classify, classifyIn: classifyIn, receipt: receipt, gapTable: gapTable, renderText: renderText, won: won };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Receipt = api;
})(typeof self !== 'undefined' ? self : this);
