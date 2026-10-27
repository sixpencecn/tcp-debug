'use strict';
/** 模拟「用户的软件」连 127.0.0.1:8080：验证我的 TCP 调试助手服务端模式双向收发。 */
const http = require('http');
const net = require('net');
const PORT = 8787, BASE = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0; const events = [];
const ok = (n, c, x) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (x ? ' → ' + x : ''))); };

function post(p, b) {
  return new Promise((res) => {
    const d = b ? JSON.stringify(b) : null;
    const r = http.request(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': d ? Buffer.byteLength(d) : 0 } }, (x) => { let s = ''; x.on('data', c => s += c); x.on('end', () => { try { res(JSON.parse(s)); } catch (e) { res({}); } }); });
    r.on('error', () => res({})); if (d) r.write(d); r.end();
  });
}
function sseOpen() { return new Promise((res) => { const q = http.get(BASE + '/api/events', (x) => { let buf = ''; x.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); blk.split('\n').forEach(l => { if (l.startsWith('data: ')) { try { events.push(JSON.parse(l.slice(6))); } catch (e) {} } }); } }); res(q); }); }); }
function waitFor(pred, t) { return new Promise((res, rej) => { const t0 = Date.now(); const iv = setInterval(() => { const h = events.find(pred); if (h) { clearInterval(iv); res(h); } else if (Date.now() - t0 > (t || 4000)) { clearInterval(iv); rej(new Error('timeout')); } }, 30); }); }

(async () => {
  const sse = await sseOpen();
  // 记录已存在客户端，避免命中旧连接
  const pre = await new Promise((res) => { http.get(BASE + '/api/state', (x) => { let s = ''; x.on('data', c => s += c); x.on('end', () => { try { res(new Set(JSON.parse(s).clients)); } catch (e) { res(new Set()); } }); }); });
  const peer = net.createConnection({ host: '127.0.0.1', port: 8080 }, () => peer.write('hello from test client'));
  let got = '';
  peer.on('data', d => { got += d.toString(); });

  const conn = await waitFor(e => e.type === 'server-client' && e.action === 'connected' && !pre.has(e.clientId));
  ok('调试助手收到客户端接入并分配 id', /^c\d+$/.test(conn.clientId), conn.clientId);

  const recv = await waitFor(e => e.type === 'data' && e.role === 'server' && e.direction === 'recv' && e.text === 'hello from test client');
  ok('调试助手服务端收到数据', recv.text === 'hello from test client' && recv.hex === Buffer.from('hello from test client').toString('hex').toUpperCase(), recv.text);

  await post('/api/server/send', { clientId: conn.clientId, payload: 'echo: OK', mode: 'text' });
  await waitFor(e => e.type === 'data' && e.role === 'server' && e.direction === 'send' && e.text === 'echo: OK');
  ok('调试助手向客户端回发成功', got.indexOf('echo: OK') >= 0, got);

  peer.end();
  await waitFor(e => e.type === 'server-client' && e.action === 'disconnected' && e.clientId === conn.clientId);
  ok('客户端断开被感知', true);

  sse.destroy();
  console.log('\n  结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(2); });
