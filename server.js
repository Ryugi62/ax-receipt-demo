#!/usr/bin/env node
// 로컬 시연 서버(의존 0). 사용: GEMINI_API_KEY=... node server.js [포트]  — 키 없으면 AI 단계는 규칙 표기로 동작.
const http = require('http'), fs = require('fs'), path = require('path');
const G = require('./gemini.js'), A = require('./ai.js');
const PORT = Number(process.argv[2] || 8787), call = G.makeCall();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
function body(req) { return new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { no(e); } }); }); }
const live = () => G.hasKey() ? call : () => Promise.reject(new Error('GEMINI_API_KEY 없음'));
http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') return send(res, 200, { ai: G.hasKey(), model: G.MODEL });
    if (req.method === 'POST' && req.url === '/api/diagnose') {
      const b = await body(req); return send(res, 200, await A.diagnoseAI(live(), b.industry, b.text || ''));
    }
    if (req.method === 'POST' && req.url === '/api/classify') {
      const b = await body(req); return send(res, 200, await A.classifyAI(live(), b.table, b.lines || []));
    }
    if (req.method === 'GET') {
      const p = path.join(__dirname, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(__dirname) || /server|gemini|\.env/.test(path.basename(p)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('없음'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); return fs.createReadStream(p).pipe(res);
    }
    res.writeHead(404); res.end('없음');
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => console.log('시연 서버 http://127.0.0.1:' + PORT + ' · AI ' + (G.hasKey() ? '켜짐(' + G.MODEL + ')' : '꺼짐(규칙 표기)')));
