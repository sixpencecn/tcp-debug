'use strict';
/**
 * TCP 调试助手 —— 后端
 * 零前端框架，仅依赖 iconv-lite（GBK 编解码）。
 * 浏览器通过 SSE(/api/events) 接收实时事件，通过 REST(/api/*) 下发指令；
 * Node 进程用原生 net 执行真实 TCP 收发。
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const PORT = parseInt(process.env.PORT || '8787', 10);
const PUBLIC = path.join(__dirname, 'public');

// ---------------- SSE 广播 ----------------
const sseClients = new Set();
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const res of sseClients) {
    try { res.write('data: ' + s + '\n\n'); } catch (e) { /* ignore */ }
  }
}
function log(level, msg) {
  broadcast({ type: 'log', level: level, msg: msg, ts: Date.now() });
}

// ---------------- 编解码 ----------------
function decode(buf, coding) {
  if (coding === 'hex') return buf.toString('hex').toUpperCase();
  if (coding === 'ascii') return buf.toString('ascii');
  try {
    return iconv.decode(buf, coding === 'gbk' ? 'gbk' : 'utf-8');
  } catch (e) {
    return buf.toString('utf8');
  }
}
function encodeToBuf(text, mode, coding) {
  if (mode === 'hex') {
    const clean = String(text).replace(/[\s-]/g, '');
    if (clean.length === 0) throw new Error('HEX 内容为空');
    if (clean.length % 2 !== 0) throw new Error('HEX 长度为奇数，无法转换');
    if (!/^[0-9a-fA-F]+$/.test(clean)) throw new Error('HEX 含有非法字符');
    return Buffer.from(clean, 'hex');
  }
  if (coding === 'gbk') return iconv.encode(text, 'gbk');
  return Buffer.from(text, 'utf-8');
}
function buildSendBuf(payload, mode, coding, nl) {
  let buf = encodeToBuf(payload, mode, coding);
  if (mode === 'text' && nl && nl !== 'none') {
    const add = nl === 'crlf' ? '\r\n' : nl === 'lf' ? '\n' : '\r';
    buf = Buffer.concat([buf, Buffer.from(add)]);
  }
  return buf;
}

// ---------------- 设置 ----------------
const settings = { recvCoding: 'utf8' };

// ---------------- 客户端模块 ----------------
let clientSock = null;
let clientStatus = 'disconnected';
function setClientStatus(s, msg) {
  clientStatus = s;
  broadcast({ type: 'status', role: 'client', state: s, msg: msg || '', ts: Date.now() });
}
function clientConnect(host, port) {
  if (clientSock) { try { clientSock.destroy(); } catch (e) {} clientSock = null; }
  let sock;
  try {
    sock = net.createConnection({ host: host, port: Number(port) }, function () {
      clientSock = sock;
      setClientStatus('connected', host + ':' + port);
      log('info', '客户端已连接 ' + host + ':' + port);
    });
  } catch (e) {
    setClientStatus('error', e.message);
    return;
  }
  sock.on('data', function (d) {
    broadcast({ type: 'data', role: 'client', direction: 'recv',
      hex: d.toString('hex').toUpperCase(), text: decode(d, settings.recvCoding), ts: Date.now() });
  });
  sock.on('error', function (e) { setClientStatus('error', e.message); log('error', '客户端错误: ' + e.message); });
  sock.on('close', function () {
    if (clientSock === sock) clientSock = null;
    setClientStatus('disconnected', '');
    log('info', '客户端连接关闭');
  });
  setClientStatus('connecting', host + ':' + port);
}
function clientDisconnect() {
  if (clientSock) { try { clientSock.destroy(); } catch (e) {} clientSock = null; }
  setClientStatus('disconnected', '');
}
function clientSend(payload, mode, coding, nl) {
  if (!clientSock) throw new Error('客户端未连接');
  const buf = buildSendBuf(payload, mode, coding, nl);
  clientSock.write(buf);
  broadcast({ type: 'data', role: 'client', direction: 'send',
    hex: buf.toString('hex').toUpperCase(), text: decode(buf, coding), ts: Date.now() });
}

// ---------------- 服务端模块 ----------------
let serverInst = null;
const serverClients = new Map(); // id -> socket
let serverStatus = 'stopped';
let clientSeq = 0;
function setServerStatus(s, msg) {
  serverStatus = s;
  broadcast({ type: 'status', role: 'server', state: s, msg: msg || '', ts: Date.now() });
}
function serverStart(port) {
  if (serverInst) throw new Error('服务端已在运行');
  serverInst = net.createServer(function (sock) {
    const id = 'c' + (++clientSeq);
    serverClients.set(id, sock);
    const addr = sock.remoteAddress + ':' + sock.remotePort;
    broadcast({ type: 'server-client', action: 'connected', clientId: id, addr: addr, ts: Date.now() });
    log('info', '服务端收到连接 ' + id + ' (' + addr + ')');
    sock.on('data', function (d) {
      broadcast({ type: 'data', role: 'server', clientId: id, direction: 'recv',
        hex: d.toString('hex').toUpperCase(), text: decode(d, settings.recvCoding), ts: Date.now() });
    });
    sock.on('error', function (e) { log('error', '服务端客户端 ' + id + ' 错误: ' + e.message); });
    sock.on('close', function () {
      serverClients.delete(id);
      broadcast({ type: 'server-client', action: 'disconnected', clientId: id, ts: Date.now() });
      log('info', '服务端连接 ' + id + ' 断开');
    });
  });
  serverInst.on('error', function (e) { setServerStatus('error', e.message); log('error', '服务端错误: ' + e.message); });
  serverInst.listen(Number(port), function () { setServerStatus('listening', '端口 ' + port); log('info', '服务端监听 :' + port); });
}
function serverStop() {
  if (!serverInst) return;
  try { serverInst.close(); } catch (e) {}
  for (const s of serverClients.values()) { try { s.destroy(); } catch (e) {} }
  serverClients.clear();
  serverInst = null;
  setServerStatus('stopped', '');
}
function serverSend(clientId, payload, mode, coding, nl) {
  const targets = clientId === 'all'
    ? Array.from(serverClients.values())
    : (serverClients.has(clientId) ? [serverClients.get(clientId)] : []);
  if (targets.length === 0) throw new Error('目标客户端不存在或未连接');
  const buf = buildSendBuf(payload, mode, coding, nl);
  for (const s of targets) s.write(buf);
  broadcast({ type: 'data', role: 'server', clientId: clientId, direction: 'send',
    hex: buf.toString('hex').toUpperCase(), text: decode(buf, coding), ts: Date.now() });
}
function serverDisconnectClient(clientId) {
  const s = serverClients.get(clientId);
  if (!s) throw new Error('客户端不存在');
  try { s.destroy(); } catch (e) {}
  serverClients.delete(clientId);
  broadcast({ type: 'server-client', action: 'disconnected', clientId: clientId, ts: Date.now() });
}

// ---------------- HTTP 路由 ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serveStatic(u, res) {
  let rel = u === '/' ? '/index.html' : u;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req, cb) {
  let body = '';
  req.on('data', function (c) { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', function () {
    try { cb(null, body ? JSON.parse(body) : {}); }
    catch (e) { cb(new Error('JSON 解析失败')); }
  });
}

function apiResp(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function handleApi(u, req, res) {
  readBody(req, function (err, body) {
    if (err) return apiResp(res, 400, { ok: false, error: err.message });
    try {
      let r;
      switch (u) {
        case '/api/settings':
          if (body.recvCoding) settings.recvCoding = body.recvCoding;
          r = { ok: true, settings: settings }; break;
        case '/api/client/connect':
          clientConnect(body.host, body.port); r = { ok: true, status: clientStatus }; break;
        case '/api/client/disconnect':
          clientDisconnect(); r = { ok: true, status: clientStatus }; break;
        case '/api/client/send':
          clientSend(body.payload, body.mode || 'text', body.coding || 'utf8', body.newline || 'none');
          r = { ok: true }; break;
        case '/api/server/start':
          serverStart(body.port); r = { ok: true, status: serverStatus }; break;
        case '/api/server/stop':
          serverStop(); r = { ok: true, status: serverStatus }; break;
        case '/api/server/send':
          serverSend(body.clientId || 'all', body.payload, body.mode || 'text', body.coding || 'utf8', body.newline || 'none');
          r = { ok: true }; break;
        case '/api/server/disconnect':
          serverDisconnectClient(body.clientId); r = { ok: true }; break;
        default:
          return apiResp(res, 404, { ok: false, error: '未知接口' });
      }
      apiResp(res, 200, r);
    } catch (e) {
      log('error', e.message);
      apiResp(res, 400, { ok: false, error: e.message });
    }
  });
}

const server = http.createServer(function (req, res) {
  const u = req.url.split('?')[0];
  if (u === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    sseSend(res, { type: 'state', clientStatus: clientStatus, serverStatus: serverStatus,
      clients: Array.from(serverClients.keys()), settings: settings });
    req.on('close', function () { sseClients.delete(res); });
    const ka = setInterval(function () { try { res.write(': ka\n\n'); } catch (e) {} }, 25000);
    req.on('close', function () { clearInterval(ka); });
    return;
  }
  if (u === '/api/state') {
    return apiResp(res, 200, { clientStatus: clientStatus, serverStatus: serverStatus,
      clients: Array.from(serverClients.keys()), settings: settings });
  }
  if (u.startsWith('/api/')) return handleApi(u, req, res);
  return serveStatic(u, res);
});

function sseSend(res, obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }

server.listen(PORT, function () {
  console.log('TCP 调试助手已启动: http://localhost:' + PORT);
});
