#!/usr/bin/env node
// 측정표 생성: GEMINI_API_KEY=... node bench.js  → bench/results-<날짜>.json  (키 값은 어디에도 쓰지 않는다)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const R = require('./core.js'), A = require('./ai.js'), G = require('./gemini.js');
const PRICE_IN = Number(process.env.BENCH_PRICE_IN || 0.30), PRICE_OUT = Number(process.env.BENCH_PRICE_OUT || 2.50); // USD / 100만 토큰, 공시가(https://ai.google.dev/gemini-api/docs/pricing 열람 2026-11-02, 유료 등급 Standard)
const read = (f) => fs.readFileSync(path.join(__dirname, 'bench', f), 'utf8');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const jl = (s) => s.trim().split('\n').map(JSON.parse);
const usd = (u) => (u.in * PRICE_IN + u.out * PRICE_OUT) / 1e6;
const sum = (us) => us.reduce((a, u) => ({ in: a.in + u.in, out: a.out + u.out, ms: a.ms + u.ms }), { in: 0, out: 0, ms: 0 });
const med = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p95 = (a) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)];
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.round((c - w) / d * 1000) / 10, Math.round((c + w) / d * 1000) / 10]; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const cs = read('classify.jsonl'), ds = read('diagnose.jsonl'), items = jl(cs), dItems = jl(ds);
  const call = G.makeCall(), out = { date: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), model: G.MODEL, sampleSha: { classify: sha(cs), diagnose: sha(ds) },
    price: { inPerM: PRICE_IN, outPerM: PRICE_OUT, note: '유료 등급 공시가. 실제 이번 호출은 무료 등급이라 청구 0원' } };
  let serial = 0; const counted = async (prompt) => {
    // 무료 등급 분당 한도: 호출 간격 4.5초, 429면 35초 쉬고 최대 3번 다시. 재시도로 늘어난 호출도 serial에 센다.
    for (let a = 0; ; a++) { await sleep(4500); try { serial++; return await call(prompt); } catch (e) { out.retries = (out.retries || 0) + (/429/.test(e.message) ? 1 : 0); if (!/429/.test(e.message) || a >= 3) throw e; await sleep(35000); } }
  };

  // ---- 분류(나) ----
  const codeOf = (it) => it.truth, byInd = {};
  items.forEach((it, i) => (byInd[it.industry] = byInd[it.industry] || []).push(i));
  const batch = new Array(items.length), batchUsage = [], rule = items.map(it => ({ code: R.classifyIn(R.TABLE[it.industry], it.text) }));
  for (const ind of Object.keys(byInd)) {
    const idx = byInd[ind], lines = idx.map(i => items[i].text);
    const r = await A.classifyAI(counted, R.TABLE[ind], lines, { chunk: 40 });
    r.usage.forEach(u => batchUsage.push(u));
    idx.forEach((i, j) => batch[i] = { code: r.codes[j], status: r.statuses[j], source: r.sources[j] });
  }
  const single = [], singleUsage = [];
  for (let i = 0; i < (process.env.BENCH_SKIP_SINGLE ? 0 : items.length); i++) {
    const r = await A.classifyAI(counted, R.TABLE[items[i].industry], [items[i].text], { chunk: 1 });
    r.usage.forEach(u => singleUsage.push(u)); single.push({ code: r.codes[0], status: r.statuses[0], source: r.sources[0] });
  }
  if (process.env.BENCH_SKIP_SINGLE) items.forEach(() => single.push({ code: undefined, status: undefined, source: '미측정' }));
  const acc = (preds) => { const k = items.filter((it, i) => preds[i].code === codeOf(it)).length; return { k, n: items.length, pct: Math.round(k / items.length * 1000) / 10, ci95: wilson(k, items.length) }; };
  const kinds = ['직접', '바꿔말함', '오답함정'];
  const kindAcc = (preds) => Object.fromEntries(kinds.map(kd => { const ix = items.map((it, i) => i).filter(i => items[i].kind.startsWith(kd)); const k = ix.filter(i => preds[i].code === codeOf(items[i])).length; return [kd, { k, n: ix.length }]; }));
  const statAcc = (preds) => { const k = items.filter((it, i) => preds[i].status === it.truthStatus).length; return { k, n: items.length }; };
  const bu = sum(batchUsage), su = sum(singleUsage);
  out.classify = {
    n: items.length, industries: Object.fromEntries(Object.keys(byInd).map(k => [k, byInd[k].length])),
    ruleAcc: acc(rule), ruleByKind: kindAcc(rule),
    aiBatchAcc: acc(batch), aiBatchByKind: kindAcc(batch), aiBatchStatus: statAcc(batch), aiBatchFallbackLines: batch.filter(b => b.source !== 'AI').length,
    aiSingleAcc: acc(single), aiSingleByKind: kindAcc(single), aiSingleStatus: statAcc(single), aiSingleFallbackLines: single.filter(b => b.source !== 'AI').length,
    batch: { calls: batchUsage.length, msMedian: med(batchUsage.map(u => u.ms)), tokens: bu, usdTotal: usd(bu), usdPerLine: usd(bu) / items.length },
    single: { calls: singleUsage.length, msMedian: med(singleUsage.map(u => u.ms)), msP95: p95(singleUsage.map(u => u.ms)), tokens: su, usdTotal: usd(su), usdPerLine: usd(su) / items.length },
    misses: items.map((it, i) => ({ id: it.id, text: it.text, truth: it.truth, rule: rule[i].code, aiBatch: batch[i].code, aiSingle: single[i].code })).filter(x => x.truth !== x.aiBatch || x.truth !== x.aiSingle || x.truth !== x.rule)
  };

  // ---- 진단(가) ----
  const dres = [];
  const REPS = Number(process.env.BENCH_REPS || 2); // 같은 입력을 2번씩 호출한다(모델 응답이 호출마다 달라질 수 있어서)
  for (const it of dItems.flatMap(x => Array.from({ length: REPS }, () => x))) {
    const r = await A.diagnoseAI(counted, it.industry, it.text);
    const rt = A.ruleDiagnose(it.industry, it.text);
    const score = (tasks) => it.truth.map(t => { const m = tasks.find(x => x.name.indexOf(t.key) >= 0); return { found: !!m, exact: !!m && Math.round(m.perWeek) === t.perWeek }; });
    const aiTasks = r.source === 'AI' ? r.diag.all : [];
    dres.push({ id: it.id, source: r.source, error: r.error, usage: r.usage[0], ai: score(aiTasks), rule: score(rt), aiTasks: aiTasks.map(x => ({ name: x.name, perWeek: x.perWeek, est: x.estMinPerWeek, tools: x.tools })) });
  }
  const tot = dItems.reduce((a, it) => a + it.truth.length, 0) * REPS;
  const cnt = (k, f) => dres.reduce((a, d) => a + d[k].filter(f).length, 0);
  const du = sum(dres.filter(d => d.usage).map(d => d.usage));
  out.diagnose = { n: dItems.length, reps: REPS, calls: dres.length, truthTasks: tot, aiValid: dres.filter(d => d.source === 'AI').length,
    aiRecall: cnt('ai', x => x.found), aiPerWeekExact: cnt('ai', x => x.exact), ruleRecall: cnt('rule', x => x.found), rulePerWeekExact: cnt('rule', x => x.exact),
    msMedian: med(dres.filter(d => d.usage).map(d => d.usage.ms)), tokens: du, usdPerCall: usd(du) / dres.length, results: dres };

  // ---- 합성 로그 149줄 전체(나) ----
  const log = fs.readFileSync(path.join(__dirname, 'data/sample-log-synthetic.txt'), 'utf8').split('\n');
  const t = R.TABLE['식당'], c = await A.classifyAI(counted, t, log.filter(l => l.trim()), { chunk: 40 });
  const ll = log.filter(l => l.trim());
  const rcAi = R.receipt(ll, { industry: '식당', codes: c.codes, statuses: c.statuses, sources: c.sources }), rcRule = R.receipt(ll, { industry: '식당' });
  const lu = sum(c.usage);
  out.fullLog = { lines: ll.length, calls: c.usage.length, fallbackLines: c.sources.filter(s => s !== 'AI').length, ai: { counted: rcAi.counted, failed: rcAi.failed, unclassified: rcAi.unclassified, minutes: rcAi.totalMinutes, won: rcAi.won },
    rule: { counted: rcRule.counted, failed: rcRule.failed, unclassified: rcRule.unclassified, minutes: rcRule.totalMinutes, won: rcRule.won }, ms: lu.ms, tokens: lu, usd: usd(lu) };
  out.apiCalls = serial;
  const f = path.join(__dirname, 'bench', 'results-' + out.date + (process.env.BENCH_SUFFIX || '') + '.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 1)); console.log('저장', f, '호출', serial);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
