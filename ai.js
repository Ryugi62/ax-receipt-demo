// 응용 코어 — 모델 호출 함수를 주입받는다(call(prompt) -> Promise<{text, usage:{in,out}, ms, model}>). 네트워크·키를 모른다.
(function (root) {
  'use strict';
  var R = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.Receipt;

  function stripFence(s) { return String(s).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim(); }
  function num(x) { var n = Number(x); return isFinite(n) ? n : NaN; }

  // ---- (가) 5분 진단 ----
  function buildDiagnosePrompt(industry, text) {
    return [
      '당신은 소상공인(' + industry + ') 사장님의 하루 업무 설명을 읽고 업무를 구조화하는 도우미입니다.',
      '아래 [설명]에 나온 반복 업무를 하나도 빠뜨리지 말고 모두(최대 8개) 뽑아 JSON으로만 답하십시오(설명 문장 금지). 설명에 업무가 4개 나오면 tasks도 4개여야 합니다.',
      '형식: {"tasks":[{"name":"업무 이름","perWeek":주당 건수(숫자),"manualMin":수작업 1건당 분,"afterMin":AI 초안을 쓴 뒤 사장님이 확인하는 1건당 분,"tools":["AI 도구 후보 1~2개(일반 종류, 예: 답장 초안 생성)"]}]}',
      '규칙: 설명에 숫자가 있으면 그대로 쓰고 하루 기준이면 7을 곱해 주당으로 바꿉니다. 숫자가 없으면 그 업무는 뽑지 않습니다. manualMin이 설명에 없으면 일반적인 값으로 추정하되 afterMin은 manualMin보다 작아야 합니다. 설명에 없는 업무를 지어내지 않습니다.',
      '[설명]', String(text).slice(0, 2000)
    ].join('\n');
  }
  function parseDiagnose(raw) {
    var o = JSON.parse(stripFence(raw)), arr = Array.isArray(o) ? o : o && o.tasks;
    if (!Array.isArray(arr)) throw new Error('tasks 배열이 없습니다');
    var out = [];
    arr.forEach(function (t) {
      if (!t || typeof t.name !== 'string' || !t.name.trim()) return;
      var pw = num(t.perWeek), m = num(t.manualMin), a = num(t.afterMin);
      if (!(pw >= 0) || !(m > 0) || !(a >= 0) || a > m) return;
      out.push({ name: t.name.trim().slice(0, 40), perWeek: pw, manualMin: m, afterMin: a,
        tools: Array.isArray(t.tools) ? t.tools.filter(function (x) { return typeof x === 'string'; }).slice(0, 2) : [] });
    });
    if (!out.length) throw new Error('유효한 업무가 없습니다');
    return out.slice(0, 8);
  }
  function tasksToTable(tasks) {
    var table = {};
    tasks.forEach(function (t, i) {
      table['a' + (i + 1)] = { name: t.name, manual: t.manualMin, after: t.afterMin, keys: keywordsOf(t.name), tools: t.tools || [] };
    });
    return table;
  }
  function keywordsOf(name) { return name.split(/[\s·,/()]+/).filter(function (w) { return w.length >= 2; }); }
  function diagnoseFromTasks(tasks) {
    var table = tasksToTable(tasks), rows = tasks.map(function (t, i) {
      return { code: 'a' + (i + 1), name: t.name, perWeek: t.perWeek, estMinPerWeek: Math.round(t.perWeek * Math.max(0, t.manualMin - t.afterMin) * 10) / 10, tools: t.tools || [] };
    });
    rows.sort(function (x, y) { return y.estMinPerWeek - x.estMinPerWeek; });
    return { table: table, diag: { top3: rows.slice(0, 3), all: rows } };
  }
  // 규칙 진단: 기준표 낱말이 든 문장에서 「N건」을 찾는다. 하루/매일 기준이면 x7, 월 기준이면 /4.3.
  function ruleDiagnose(industry, text) {
    var t = R.TABLE[industry] || {}, clauses = String(text).split(/[.\n,;]|(?:이고|이며|인데|고)\s/), out = [];
    Object.keys(t).forEach(function (code) {
      var row = t[code];
      for (var i = 0; i < clauses.length; i++) {
        var c = clauses[i];
        if (!row.keys.some(function (k) { return c.indexOf(k) >= 0; })) continue;
        var m = /(\d+)\s*(건|번|개|통|곳)/.exec(c); if (!m) continue;
        var n = Number(m[1]);
        if (/하루|매일|일 평균|일에/.test(c)) n *= 7; else if (/한 ?달|월 |매월|월에/.test(c)) n = Math.round(n / 4.3);
        out.push({ name: row.name, perWeek: n, manualMin: row.manual, afterMin: row.after, tools: [] });
        break;
      }
    });
    return out;
  }
  function addUsage(list, r) { if (r && r.usage) list.push({ in: r.usage.in || 0, out: r.usage.out || 0, ms: r.ms || 0 }); }
  function diagnoseAI(call, industry, text) {
    var usage = [];
    return Promise.resolve().then(function () { return call(buildDiagnosePrompt(industry, text)); }).then(function (r) {
      addUsage(usage, r);
      var built = diagnoseFromTasks(parseDiagnose(r.text));
      return { source: 'AI', model: r.model, table: built.table, diag: built.diag, usage: usage };
    }).catch(function (e) {
      var tasks = ruleDiagnose(industry, text);
      if (!tasks.length) return { source: '규칙', error: e.message, table: {}, diag: { top3: [], all: [] }, usage: usage, empty: true };
      var built = diagnoseFromTasks(tasks);
      return { source: '규칙', error: e.message, table: built.table, diag: built.diag, usage: usage };
    });
  }

  // ---- (나) 실행 기록 분류 ----
  function buildClassifyPrompt(table, lines, offset) {
    var codes = Object.keys(table).map(function (c) { return c + ' = ' + table[c].name; }).join('\n');
    var body = lines.map(function (l, i) { return (offset + i) + ': ' + String(l).slice(0, 300); }).join('\n');
    return ['아래는 소상공인 사장님이 붙여 넣은 메신저·도구 실행 기록입니다(형식이 제각각입니다).',
      '각 줄이 어떤 업무인지 [업무코드] 중 하나로 분류하고, 그 일이 성공했는지 실패했는지 판단해 JSON 배열로만 답하십시오.',
      '형식: [{"i":줄 번호,"code":"업무코드 또는 none","status":"성공 또는 실패"}]  — 어느 업무에도 해당하지 않으면 code는 none. 실패·오류·전송 안 됨·재시도 필요 같은 표현이 있으면 실패. 줄마다 정확히 하나씩.',
      '[업무코드]', codes, '[기록]', body].join('\n');
  }
  function parseClassify(raw, offset, n, table) {
    var arr = JSON.parse(stripFence(raw));
    if (!Array.isArray(arr)) throw new Error('배열이 아닙니다');
    var res = new Array(n);
    arr.forEach(function (x) {
      var k = Number(x && x.i) - offset;
      if (!(k >= 0 && k < n) || res[k]) return;
      var code = x.code === 'none' ? null : x.code;
      if (code !== null && !table[code]) return;           // 없는 코드: 버린다(규칙 재분류 대상)
      res[k] = { code: code, status: x.status === '실패' ? '실패' : '성공' };
    });
    return res;
  }
  function ruleStatus(l) { return /실패|오류|에러|전송 ?안|재시도/.test(l) ? '실패' : '성공'; }
  function classifyAI(call, table, lines, opts) {
    opts = opts || {};
    var size = opts.chunk || 40, codes = new Array(lines.length), statuses = new Array(lines.length), sources = new Array(lines.length);
    var usage = [], errors = [], model = null, chain = Promise.resolve();
    function rule(k) { var l = lines[k]; codes[k] = l.trim() ? R.classifyIn(table, l) : null; statuses[k] = ruleStatus(l); sources[k] = '규칙'; }
    for (var s = 0; s < lines.length; s += size) (function (start) {
      var chunk = lines.slice(start, start + size);
      chain = chain.then(function () {
        if (!chunk.some(function (l) { return l.trim(); })) { chunk.forEach(function (_, j) { rule(start + j); }); return; }
        return Promise.resolve().then(function () { return call(buildClassifyPrompt(table, chunk, start)); }).then(function (r) {
          addUsage(usage, r); model = r.model || model;
          var parsed = parseClassify(r.text, start, chunk.length, table);
          chunk.forEach(function (_, j) {
            var p = parsed[j], k = start + j;
            if (!p) rule(k); else { codes[k] = p.code; statuses[k] = p.status; sources[k] = 'AI'; }
          });
        }).catch(function (e) { errors.push(e.message); chunk.forEach(function (_, j) { rule(start + j); }); });
      });
    })(s);
    return chain.then(function () { return { codes: codes, statuses: statuses, sources: sources, usage: usage, model: model, errors: errors }; });
  }

  var api = { buildDiagnosePrompt: buildDiagnosePrompt, parseDiagnose: parseDiagnose, tasksToTable: tasksToTable, diagnoseFromTasks: diagnoseFromTasks,
    ruleDiagnose: ruleDiagnose, diagnoseAI: diagnoseAI, buildClassifyPrompt: buildClassifyPrompt, parseClassify: parseClassify, classifyAI: classifyAI, ruleStatus: ruleStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ReceiptAI = api;
})(typeof self !== 'undefined' ? self : this);
