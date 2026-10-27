# TCP 调试助手

本地 Web 版 TCP 调试工具：浏览器操作，Node 后端执行真实 TCP 收发。零前端框架，仅依赖 `iconv-lite`（GBK 编解码）。

## 运行

### 方式一：双击启动器（推荐，桌面 App 体验）

- Windows：双击 `启动.bat` → 自动拉起服务并打开浏览器，按 `Ctrl+C` 退出即关闭服务。
- macOS / Linux：在终端执行 `./启动.sh`（需先 `chmod +x 启动.sh`）。

启动器等价于 `node launch.js`：等服务就绪后自动打开 `http://localhost:8787`。

> **便携分发**：本目录已内置 `node.exe`（Node 运行时，约 87MB）。把整个 `tcp-debug` 文件夹拷贝到任意 Windows 电脑，**双击 `启动.bat` 即可使用，无需在系统安装 Node**。该 `node.exe` 已在 `.gitignore` 中忽略，仅用于本地/离线分发，不进入 git 仓库。

### 方式二：手动启动

```bash
cd tcp-debug
node server.js            # 默认 http://localhost:8787
PORT=9000 node server.js # 自定义端口
```

打开浏览器访问 `http://localhost:8787` 即可。

### 打包为独立桌面 exe（Windows）

本工具核心是一个 Node 服务 + 浏览器前端。若要打成单文件 `.exe` 双击运行，可用 `pkg` 或 `Electron`：

```bash
npm i -D pkg
npx pkg launch.js --targets node22-win-x64 --output tcp-debug.exe
# 或 Electron：将 public/ 作为渲染进程、server.js 作为主进程
```

> 注意：`pkg` / `Electron` 在打包时需要从 GitHub 下载 Node/Chromium 运行时。若所在网络对 `github.com` 发布物下载受限（如本环境代理 502），该步会失败——此时用上面的「启动器」方式即可，或换到可正常访问 GitHub 的机器打包。


## 功能

- **客户端模式**：连接远程 TCP 服务，发送/接收数据，断开重连。
- **服务端模式**：监听端口，支持多客户端，可指定客户端或广播发送，可踢除客户端。
- **编码**：UTF-8 / GBK / ASCII / HEX（收发均支持；切换编码即同步接收解码方式）。
- **发送选项**：文本 / HEX 模式、自动换行（无 / CRLF / LF / CR）、定时重发（间隔可配）。
- **日志**：方向着色（绿=收 / 黄=发）、毫秒时间戳、可显示 HEX、自动滚动、字节计数、一键清空。
- **实时性**：后端通过 SSE 推送，UI 无需刷新即时显示。

## 架构

```
browser (public/)  ──SSE+REST──>  Node server.js  ──net──>  真实 TCP 对端
```

- `server.js`：HTTP 静态服务 + REST 指令 + SSE 事件流；用原生 `net` 做 TCP，原生 `http` 做 SSE，无 WebSocket 依赖。
- `public/`：纯静态前端（index.html / style.css / app.js）。
- `test/selftest.js`：自测脚本，用真实 TCP 对端校验服务端收包、客户端回显、HEX / GBK 编解码、多客户端（12 项断言）。

## 测试

```bash
node test/selftest.js
```

## 说明

- 编码选择中的 GBK 影响**接收解码**；发送时 HEX 模式按字节发送，文本模式按所选编码（UTF-8/GBK）编码。
- 日志上限 2000 行，超出自动裁剪。
- 前端与后端同源，已加 `Access-Control-Allow-Origin` 便于跨域调试。
