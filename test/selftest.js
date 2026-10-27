'use strict';
/**
 * TCP 调试助手 自测：真实 TCP 收发 + SSE 事件校验。
 * 启动 server.js 子进程 → 服务端模式收包、客户端模式回显、HEX / GBK 编解码、多客户端。
 */
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8787;
const BASE = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0;
const events = [];

function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

function post(p, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 } }, (x) => {
      let b = ''; x.on('data', (c) => b += c); x.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res({}); } });
    });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}

function sseOpen() {
  return new Promise((res) => {
    const req = http.get(BASE + '/api/events', (x) => {
      let buf = '';
      x.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          block.split('\n').forEach((line) => {
            if (line.startsWith('data: ')) {
              try { events.push(JSON.parse(line.slice(6))); } catch (e) {}
            }
          });
        }
      });
      res(req);
    });
  });
}

function waitFor(pred, timeout) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const hit = events.find(pred);
      if (hit) { clearInterval(iv); res(hit); }
      else if (Date.now() - t0 > (timeout || 4000)) { clearInterval(iv); rej(new Error('timeout waiting event')); }
    }, 30);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }) });
  srv.stderr.on('data', (d) => process.stderr.write('[server.err] ' + d));
  await sleep(800);
  const sse = await sseOpen();

  // ---------- 服务端模式 ----------
  console.log('\n[服务端模式]');
  await post('/api/server/start', { port: 18080 });
  await waitFor((e) => e.type === 'status' && e.role === 'server' && e.state === 'listening');
  assert('服务端进入监听', true);

  const peer = net.createConnection({ host: '127.0.0.1', port: 18080 }, () => {
    peer.write('hello');
  });
  let peerGot = '';
  peer.on('data', (d) => { peerGot += d.toString(); });
  const recv = await waitFor((e) => e.type === 'data' && e.role === 'server' && e.direction === 'recv' && e.text === 'hello');
  assert('服务端收到客户端数据文本=hello', recv.text === 'hello', recv.text);
  assert('服务端收到数据 hex=68656C6C6F', recv.hex === '68656C6C6F', recv.hex);

  await post('/api/server/send', { clientId: 'all', payload: 'PING', mode: 'text' });
  await waitFor((e) => e.type === 'data' && e.role === 'server' && e.direction === 'send' && e.text === 'PING');
  assert('服务端向客户端发送 PING', peerGot.indexOf('PING') >= 0, peerGot);

  // 多客户端（等待不同于首个客户端 c1 的新连接）
  const c1 = events.filter((e) => e.type === 'server-client' && e.action === 'connected')[0];
  const peer2 = net.createConnection({ host: '127.0.0.1', port: 18080 });
  const cliEvt = await waitFor((e) => e.type === 'server-client' && e.action === 'connected' && e.clientId !== (c1 && c1.clientId));
  assert('第二个客户端接入并分配 id', /^c\d+$/.test(cliEvt.clientId), cliEvt.clientId);
  peer2.end();
  await waitFor((e) => e.type === 'server-client' && e.action === 'disconnected' && e.clientId === cliEvt.clientId);
  assert('客户端断开被感知', true);
  peer.end();
  await sleep(200);

  // ---------- 客户端模式 ----------
  console.log('\n[客户端模式]');
  const echo = net.createServer((s) => s.on('data', (d) => s.write(d)));
  await new Promise((r) => echo.listen(18081, r));

  await post('/api/client/connect', { host: '127.0.0.1', port: 18081 });
  await waitFor((e) => e.type === 'status' && e.role === 'client' && e.state === 'connected');
  assert('客户端连接回显服务', true);

  events.length = 0;
  await post('/api/client/send', { payload: 'ping', mode: 'text' });
  const e1 = await waitFor((e) => e.type === 'data' && e.role === 'client' && e.direction === 'recv' && e.text === 'ping');
  assert('客户端回显文本=ping', e1.text === 'ping', e1.text);

  await post('/api/client/send', { payload: '48 69', mode: 'hex' });
  const e2 = await waitFor((e) => e.type === 'data' && e.role === 'client' && e.direction === 'recv' && e.text === 'Hi');
  assert('HEX 模式发送 48 69 → 回显 Hi', e2.text === 'Hi' && e2.hex === '4869', e2.text + '/' + e2.hex);

  await post('/api/settings', { recvCoding: 'gbk' });
  await post('/api/client/send', { payload: '你好', mode: 'text', coding: 'gbk' });
  const e3 = await waitFor((e) => e.type === 'data' && e.role === 'client' && e.direction === 'recv' && e.text.indexOf('你好') >= 0, 4000);
  assert('GBK 编码发送「你好」回显正确', !!e3 && e3.text.indexOf('你好') >= 0, e3 && e3.text);

  await post('/api/client/disconnect');
  await waitFor((e) => e.type === 'status' && e.role === 'client' && e.state === 'disconnected');
  assert('客户端断开', true);
  echo.close();

  // ---------- 清理 ----------
  await post('/api/server/stop');
  await waitFor((e) => e.type === 'status' && e.role === 'server' && e.state === 'stopped');
  assert('服务端停止监听', true);

  sse.destroy();
  srv.kill();

  console.log('\n========================================');
  console.log('  结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('========================================');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('自测异常:', e); process.exit(2); });
