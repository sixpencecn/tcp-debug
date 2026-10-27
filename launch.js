'use strict';
/**
 * TCP 调试助手 · 启动器（桌面 App 入口）
 * 自动拉起 server.js，等服务就绪后打开默认浏览器，按 Ctrl+C 退出即关闭服务。
 */
const { spawn } = require('child_process');
const { platform } = require('os');
const http = require('http');

const PORT = process.env.PORT || 8787;

const srv = spawn(process.execPath, [require('path').join(__dirname, 'server.js')], {
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  stdio: 'inherit'
});

function openBrowser() {
  const url = 'http://localhost:' + PORT;
  const tries = [];
  if (platform === 'win32') tries.push(['cmd', ['/c', 'start', '', url]]);
  else if (platform === 'darwin') tries.push(['open', [url]]);
  else tries.push(['xdg-open', [url]]);
  // 兜底：跨环境兼容（某些环境 platform 误判时也试一次）
  tries.push(['cmd', ['/c', 'start', '', url]]);
  tries.push(['xdg-open', [url]]);
  tries.push(['open', [url]]);
  let i = 0;
  function next() {
    if (i >= tries.length) { console.log('(未能自动打开浏览器，请手动访问 ' + url + ')'); return; }
    const pair = tries[i++];
    let p;
    try { p = spawn(pair[0], pair[1], { stdio: 'ignore', detached: true }); }
    catch (e) { return next(); }
    p.on('error', () => next()); // 该命令不存在则试下一个，绝不抛错
    p.unref();
  }
  next();
}

function waitUp(attempt) {
  if (attempt > 50) { console.log('等待服务就绪超时，请检查上方日志。'); return; }
  http.get('http://127.0.0.1:' + PORT + '/api/state', (r) => {
    r.resume();
    console.log('\n✅ TCP 调试助手已启动 → ' + 'http://localhost:' + PORT + '\n   按 Ctrl+C 退出（会同时关闭服务）。\n');
    openBrowser();
  }).on('error', () => setTimeout(() => waitUp(attempt + 1), 300));
}

setTimeout(() => waitUp(0), 600);

srv.on('exit', (code) => process.exit(code === null ? 0 : code));
process.on('SIGINT', () => { try { srv.kill(); } catch (e) {} process.exit(0); });
