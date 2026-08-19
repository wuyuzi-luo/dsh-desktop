// 真实下载模拟脚本（独立 Electron 进程）：
// 用与生产代码完全一致的逻辑真实下载 GitHub Release 安装包（v0.1.20，约 102MB）
// 真实的流式进度 + 真实的 60 秒无进展卡住检测 + 真实的系统通知 + 真实的失败处理
// 网络状态由用户自己控制（断 Wi-Fi/飞行模式/恢复），用于验证警示是否与真实网络对应
// 运行：npx electron test/real-simulate-download.js
// 下载完成后演示文件自动删除（不占磁盘）

import { app, BrowserWindow, ipcMain, Notification } from 'electron'; // Electron 主进程 API
import { fileURLToPath } from 'node:url'; // ESM 路径转换
import { dirname, join } from 'node:path'; // 路径拼接
import { writeFile, rm } from 'node:fs/promises'; // 写/删临时文件
import { tmpdir } from 'node:os'; // 临时目录

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // 项目根目录
const PRELOAD = join(ROOT, 'src', 'preload', 'index.cjs'); // 复用主应用 preload
const PAGE = join(ROOT, 'src', 'renderer', 'update-dialog.html'); // 弹窗页面
// 真实下载地址：GitHub Release v0.1.20 安装包（约 102MB）
const DOWNLOAD_URL = 'https://github.com/wuyuzi-luo/dsh-desktop/releases/download/v0.1.20/dsh-desktop-setup-0.1.20.exe';

app.setAppUserModelId('dsh-desktop'); // Windows 通知 appId（与主应用一致，保证系统通知能弹）

let win = null; // 弹窗窗口
let percent = 0; // 当前进度（卡住检测循环读取）
let downloading = false; // 下载中标志（防重复启动）

// 推送弹窗内容
function push(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update-dialog:push', payload); // 推送
}

// 真实下载主流程（与 updater.js 的 downloadUpdate 完全一致的逻辑）
async function download() {
  if (downloading) return; // 防重入
  downloading = true; // 置标志
  percent = 0; // 复位进度
  push({ phase: 'downloading', percent: 0 }); // 进度页 0%
  console.log('[真实模拟] 开始下载：', DOWNLOAD_URL); // 时间线日志
  // —— 卡住检测（与生产代码一致：60 秒无数据 → 橙字警示 + 系统通知，恢复自动清除）——
  let lastData = Date.now(); // 最后收到数据时间
  let stuckNotified = false; // 卡住通知已发标志
  const stuckTimer = setInterval(() => {
    const idle = Math.round((Date.now() - lastData) / 1000); // 空闲秒数
    if (idle >= 60) { // 判定卡住
      push({ phase: 'downloading', percent, hint: `已 ${idle} 秒没有下载数据：可能网络较慢或与 GitHub 连接中断，请检查网络连接。若长时间无进展，可关闭本窗口稍后重试` }); // 橙字警示
      console.log(`[真实模拟] ${new Date().toLocaleTimeString()} 触发卡住警示：${idle} 秒无数据`); // 日志
      if (!stuckNotified) { // 首次卡住 → 真实系统通知
        stuckNotified = true; // 置标志
        try {
          const n = new Notification({ title: '下载可能卡住了', body: '已超过 1 分钟没有下载进展，请检查网络连接' }); // 通知
          n.show(); // 弹出
          console.log('[真实模拟] 系统通知已弹出'); // 日志
        } catch (e) { console.log('[真实模拟] 系统通知失败：', e?.message); } // 日志
      }
    } else if (stuckNotified && idle < 10) { // 已恢复
      stuckNotified = false; // 复位
      push({ phase: 'downloading', percent, hint: '' }); // 恢复正常文案
      console.log('[真实模拟] 网络恢复：警示已清除'); // 日志
    }
  }, 10000); // 每 10 秒检查
  try {
    const dl = await fetch(DOWNLOAD_URL, { signal: AbortSignal.timeout(600000) }); // 真实请求（最长 10 分钟）
    if (!dl.ok || !dl.body) throw new Error(`HTTP ${dl.status}`); // 请求失败
    const total = Number(dl.headers.get('content-length')) || 0; // 总字节
    console.log(`[真实模拟] 连接成功，总大小 ${(total / 1048576).toFixed(1)} MB，开始接收数据`); // 日志
    const reader = dl.body.getReader(); // 流读取器
    const chunks = []; // 分块缓冲
    let received = 0; // 已收字节
    let lastLogPct = 0; // 上次日志百分比（每 10% 记一次）
    while (true) { // 持续读流
      const { done, value } = await reader.read(); // 读一块（断网时这里会挂起直到 TCP 超时/报错）
      if (done) break; // 完成
      chunks.push(value); // 收集
      received += value.length; // 累加
      lastData = Date.now(); // 刷新卡住检测基准
      if (total) { // 已知总量
        percent = Math.round((received / total) * 100); // 真实百分比
        push({ phase: 'downloading', percent }); // 推进度
        if (percent >= lastLogPct + 10) { lastLogPct = Math.floor(percent / 10) * 10; console.log(`[真实模拟] 进度 ${percent}%`); } // 每 10% 日志
      }
    }
    // 下载完成：落盘后立即删除（演示用途），显示完成页
    const filePath = join(tmpdir(), 'dsh-sim-download.exe'); // 临时文件
    await writeFile(filePath, Buffer.concat(chunks)); // 落盘
    await rm(filePath, { force: true }); // 删除（不占磁盘）
    console.log('[真实模拟] 下载完成（演示文件已删除）'); // 日志
    push({ phase: 'app-done', version: '0.1.20' }); // 完成页
  } catch (err) {
    console.log(`[真实模拟] 下载失败（${new Date().toLocaleTimeString()}）：`, String(err?.message ?? err)); // 日志
    push({ phase: 'app-error' }); // 真实失败页（断网导致的连接中断会走这里）
  } finally {
    clearInterval(stuckTimer); // 停止卡住检测
    downloading = false; // 复位
  }
}

// 弹窗按钮动作
ipcMain.handle('update-dialog:action', async (_e, action) => {
  console.log('[真实模拟] 用户点击：', action); // 日志
  if (action === 'update') { download(); return true; } // 立即更新 → 真实下载
  if (action === 'later') { push({ phase: 'deferred' }); return true; } // 暂不更新
  app.quit(); // restart/done → 退出演示
  return true;
});

// 就绪：建窗口推确认页
app.whenReady().then(() => {
  win = new BrowserWindow({ // 与主应用弹窗同参数
    width: 460, height: 400, frame: false, resizable: false, // 尺寸与边框
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#0f1319', // 置顶/不进任务栏/底色
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true } // 安全基线
  });
  win.loadFile(PAGE); // 加载弹窗页
  win.webContents.once('did-finish-load', () => { // 页面就绪
    push({ // 确认页：说明本次为真实下载
      phase: 'confirm',
      type: 'app',
      label: 'dsh 桌面端',
      current: '0.1.19',
      latest: '0.1.20',
      notes: '本次为真实下载模拟：将真实下载 v0.1.20 安装包（约 102MB）\n\n* 下载过程中你可以断 Wi-Fi / 开飞行模式来测试\n* 连接中断 → 失败页；连接存活但 60 秒无数据 → 卡住警示 + 系统通知\n* 完成后演示文件自动删除，不占磁盘'
    });
    console.log('[真实模拟] 确认页已显示。点「立即更新」开始真实下载'); // 日志
    console.log('[真实模拟] 测试提示：下载中关闭 Wi-Fi 再快速恢复，可触发卡住警示；完全断开会走失败页'); // 日志
  });
  win.on('closed', () => app.quit()); // 关窗退出
});

app.on('window-all-closed', () => app.quit()); // 兜底
