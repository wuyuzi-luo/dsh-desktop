// 首次安装流程模拟脚本（独立 Electron 进程）：
// 演示 boot 页完整流程：未识别 dsh → 确认 Node → 三选项(含安装源选择) → 帮我安装 → 模拟 npm 日志 → 完成
// 用于人工验收 UI 效果，运行：npx electron test/simulate-first-install.js

import { app, BrowserWindow, ipcMain, shell } from 'electron'; // Electron 主进程 API
import { fileURLToPath } from 'node:url'; // ESM 路径转换
import { dirname, join } from 'node:path'; // 路径拼接

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // 项目根目录
const PRELOAD = join(ROOT, 'src', 'preload', 'index.cjs'); // 复用主应用 preload
const PAGE = join(ROOT, 'src', 'renderer', 'boot.html'); // boot 页

let win = null; // 窗口引用

// 推送 boot 页事件（type: service/setup，与主应用一致）
function push(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('app:state', payload); // 推送
}

// 模拟"帮我安装"：按所选源生成 npm 日志，几秒完成
async function fakeInstall(registry) {
  const src = registry === 'official'
    ? 'https://registry.npmjs.org'
    : 'https://registry.npmmirror.com'; // 所选源地址
  push({ type: 'setup', phase: 'start', text: `正在安装 dsh 到 D:\\deepseek-harness（安装源：${src}）…` }); // 开始
  const lines = [ // 模拟 npm 输出
    'npm warn deprecated inflight@1.0.6: no longer supported',
    `npm http fetch GET 200 ${src}/@deepseek-ai%2fdsh 312ms (cache miss)`,
    `npm http fetch GET 200 ${src}/@deepseek-ai%2fdsh-base 287ms (cache miss)`,
    `npm http fetch GET 200 ${src}/@deepseek-ai%2fdsh-web 265ms (cache hit)`,
    'reify:@deepseek-ai/dsh: timing reifyNode completed in 412ms',
    'added 212 packages in 8s'
  ];
  for (const line of lines) { // 逐行推日志（模拟真实安装节奏）
    push({ type: 'setup', phase: 'line', text: line }); // 日志行
    await new Promise((r) => setTimeout(r, 500)); // 每行 0.5 秒
  }
  push({ type: 'setup', phase: 'done', text: 'dsh 安装完成，正在启动服务…' }); // 完成
  await new Promise((r) => setTimeout(r, 1500)); // 稍等
  push({ type: 'service', state: 'running' }); // 服务运行中（boot 页显示"服务已就绪"）
}

// 注册模拟 IPC handler（与主应用同通道名）
ipcMain.handle('app:get-state', () => ({ service: 'missing' })); // 初始状态：未识别 dsh
ipcMain.handle('setup:check-node', () => ({ ok: true, version: 'v24.16.0' })); // Node 检测通过
ipcMain.handle('setup:auto-install', async (_e, opts) => { // 帮我安装
  console.log('[模拟] 用户选择的安装源：', opts?.registry || 'mirror'); // 日志
  await fakeInstall(opts?.registry); // 模拟安装
  return { ok: true, dir: 'D:\\deepseek-harness' }; // 成功
});
ipcMain.handle('setup:pick-dsh-dir', () => ({ canceled: true })); // 目录选择：模拟取消
ipcMain.handle('service:retry', () => 'missing'); // 重试：仍缺 dsh
ipcMain.handle('app:open-external', (_e, url) => shell.openExternal(url)); // 外链：真实打开浏览器（Node.js 下载页可点）

app.whenReady().then(() => {
  win = new BrowserWindow({ // 与主应用主窗口同参数
    width: 1100, height: 760, // 尺寸
    backgroundColor: '#0d1226', // 深蓝底色
    autoHideMenuBar: true, // 隐藏菜单栏
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true } // 安全基线
  });
  win.loadFile(PAGE); // 加载 boot 页
  win.on('closed', () => app.quit()); // 关窗退出
  console.log('[模拟] boot 页已显示：按流程操作——确认 Node → 选安装源 → 帮我安装'); // 控制台提示
});

app.on('window-all-closed', () => app.quit()); // 兜底
