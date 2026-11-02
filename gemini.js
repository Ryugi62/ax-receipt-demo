// 인프라 어댑터 — Gemini REST 호출. 키는 환경 변수 GEMINI_API_KEY에서만 읽고 어디에도 쓰지 않는다.
const https = require('https');
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
function hasKey() { return !!process.env.GEMINI_API_KEY; }
function makeCall(opts = {}) {
  const model = opts.model || MODEL, timeout = opts.timeout || 30000;
  return function call(prompt) {
    return new Promise((resolve, reject) => {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return reject(new Error('GEMINI_API_KEY 없음'));
      const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
      const t0 = Date.now();
      const req = https.request({ method: 'POST', hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent`, timeout,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-goog-api-key': key } }, (res) => {
        res.setEncoding('utf8'); let buf = ''; res.on('data', (c) => buf += c);
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('모델 응답 오류 ' + res.statusCode));
          try {
            const d = JSON.parse(buf), text = d.candidates[0].content.parts.map(p => p.text || '').join('');
            const u = d.usageMetadata || {};
            resolve({ text, usage: { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) }, ms: Date.now() - t0, model: d.modelVersion || model });
          } catch (e) { reject(new Error('모델 응답 해석 실패')); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('모델 시간 초과')));
      req.on('error', (e) => reject(new Error(e.message.replace(key, '***'))));
      req.end(body);
    });
  };
}
module.exports = { makeCall, hasKey, MODEL };
