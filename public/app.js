'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');
  let rx = 0, tx = 0;
  let repeatTimer = null;

  // ---------- 日志 ----------
  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
  function addLine(cls, html) {
    const div = document.createElement('div');
    div.className = 'line ' + cls;
    div.innerHTML = html;
    logEl.appendChild(div);
    if ($('autoscroll').checked) logEl.scrollTop = logEl.scrollHeight;
    // 限制行数
    while (logEl.childElementCount > 2000) logEl.removeChild(logEl.firstChild);
  }
  function appendData(ev) {
    const who = ev.role === 'client' ? 'CLI' : ('SRV' + (ev.clientId ? ':' + ev.clientId : ''));
    const dir = ev.direction === 'recv' ? '◀ RECV' : 'SEND ▶';
    const dirCls = ev.direction === 'recv' ? 'dir-recv' : 'dir-send';
    const bytes = (ev.hex.length / 2) | 0;
    if (ev.direction === 'recv') rx += bytes; else tx += bytes;
    $('rx').textContent = rx; $('tx').textContent = tx;
    let s = '<span class="ts">[' + fmtTime(ev.ts) + ']</span> ' +
      '<span class="tag ' + dirCls + '">[' + who + ' ' + dir + ']</span> ' +
      escapeHtml(ev.text || '');
    if ($('showhex').checked) s += '  <span class="hex">' + ev.hex + '</span>';
    addLine(dirCls, s);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // ---------- SSE ----------
  const es = new EventSource('/api/events');
  es.onmessage = function (e) {
    let ev; try { ev = JSON.parse(e.data); } catch (_) { return; }
    switch (ev.type) {
      case 'state':
        setClientStatus(ev.clientStatus); setServerStatus(ev.serverStatus);
        renderClients(ev.clientsDetail || ev.clients || []);
        break;
      case 'status':
        if (ev.role === 'client') setClientStatus(ev.state, ev.msg);
        else setServerStatus(ev.state, ev.msg);
        if (ev.msg) addLine(ev.state === 'error' ? 'err' : 'sys',
          '<span class="ts">[' + fmtTime(ev.ts) + ']</span> ' + escapeHtml(ev.msg));
        break;
      case 'data': appendData(ev); break;
      case 'server-client':
        if (ev.action === 'connected') addLine('sys', '<span class="ts">[' + fmtTime(ev.ts) + ']</span> 客户端 ' + ev.clientId + ' 接入 (' + ev.addr + ')');
        else addLine('sys', '<span class="ts">[' + fmtTime(ev.ts) + ']</span> 客户端 ' + ev.clientId + ' 断开');
        refreshClients();
        break;
      case 'log':
        addLine(ev.level === 'error' ? 'err' : 'sys', '<span class="ts">[' + fmtTime(ev.ts) + ']</span> ' + escapeHtml(ev.msg));
        break;
    }
  };
  es.onerror = function () { /* 浏览器会自动重连 */ };

  // ---------- 状态显示 ----------
  function setClientStatus(state, msg) {
    const el = $('st-client');
    el.className = 'pill ' + (state === 'connected' ? 'on' : state === 'error' ? 'err' : 'off');
    el.textContent = '客户端 ' + ({ connected: '已连接', connecting: '连接中', disconnected: '离线', error: '错误' }[state] || state) + (msg ? ' ' + msg : '');
    $('c-connect').disabled = state === 'connected' || state === 'connecting';
    $('c-disconnect').disabled = !(state === 'connected' || state === 'connecting');
  }
  function setServerStatus(state, msg) {
    const el = $('st-server');
    el.className = 'pill ' + (state === 'listening' ? 'on' : state === 'error' ? 'err' : 'off');
    el.textContent = '服务端 ' + ({ listening: '监听中', stopped: '未监听', error: '错误' }[state] || state) + (msg ? ' ' + msg : '');
    $('s-start').disabled = state === 'listening';
    $('s-stop').disabled = state !== 'listening';
  }

  // ---------- 客户端列表 ----------
  function renderClients(list) {
    // 兼容两种格式：[id] 或 [{id, addr}]
    const items = (list || []).map((c) => (typeof c === 'string' ? { id: c, addr: '' } : c));
    const sel = $('s-clients');
    const cur = sel.value;
    sel.innerHTML = '<option value="all">全部(广播)</option>' +
      items.map((it) => '<option value="' + it.id + '">' + it.id + (it.addr ? ' (' + it.addr + ')' : '') + '</option>').join('');
    if (items.some((it) => it.id === cur)) sel.value = cur;
    $('s-kick').disabled = items.length === 0;
  }
  function refreshClients() {
    api('GET', '/api/state').then((j) => renderClients(j.clientsDetail || j.clients || []));
  }

  // ---------- API ----------
  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then((r) => r.json());
  }
  function currentSend() {
    return {
      payload: $('payload').value,
      mode: $('mode-hex').checked ? 'hex' : 'text',
      coding: $('coding').value,
      newline: $('newline').value
    };
  }

  // ---------- 事件绑定 ----------
  $('c-connect').onclick = () => api('POST', '/api/client/connect', { host: $('c-host').value, port: Number($('c-port').value) });
  $('c-disconnect').onclick = () => api('POST', '/api/client/disconnect');
  $('s-start').onclick = () => api('POST', '/api/server/start', { port: Number($('s-port').value) });
  $('s-stop').onclick = () => api('POST', '/api/server/stop');
  $('s-kick').onclick = () => { const id = $('s-clients').value; if (id && id !== 'all') api('POST', '/api/server/disconnect', { clientId: id }); };
  $('send').onclick = doSend;
  $('clear').onclick = () => { logEl.innerHTML = ''; rx = 0; tx = 0; $('rx').textContent = 0; $('tx').textContent = 0; };
  $('showhex').onchange = () => { /* 下次数据生效 */ };
  $('coding').onchange = () => api('POST', '/api/settings', { recvCoding: $('coding').value });

  // 定时重发
  function setupRepeat() {
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
    if ($('repeat').checked) {
      const ms = Math.max(100, Number($('repeat-ms').value) || 1000);
      repeatTimer = setInterval(doSend, ms);
    }
  }
  $('repeat').onchange = setupRepeat;

  function doSend() {
    const cfg = currentSend();
    if (!cfg.payload && cfg.mode !== 'hex') { $('send-hint').textContent = '内容为空'; return; }
    $('send-hint').textContent = '';
    if ($('s-port') && document.querySelector('.tab.active').dataset.tab === 'server') {
      api('POST', '/api/server/send', Object.assign({ clientId: $('s-clients').value }, cfg)).catch((e) => addLine('err', '发送失败: ' + e.message));
    } else {
      api('POST', '/api/client/send', cfg).catch((e) => addLine('err', '发送失败: ' + e.message));
    }
  }

  // Tab 切换
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $('panel-' + t.dataset.tab).classList.add('active');
    };
  });

  addLine('sys', '<span class="ts">[--]</span> 已连接调试服务，选择模式后开始。');
})();
