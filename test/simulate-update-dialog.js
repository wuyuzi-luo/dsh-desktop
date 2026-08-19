// 更新弹窗模拟演示脚本（独立 Electron 进程，不影响主应用）：
// 播放完整流程：确认页 → 下载进度（含卡住警示段）→ "已更新完成请重启"完成页
// 用于人工验收 UI 效果，运行：npx electron test/simulate-update-dialog.js
// 演示完毕（用户点 稍后/立即重启/知道了）进程退出

import { app, BrowserWindow, ipcMain } from 'electron'; // Electron 主进程 API
import { fileURLToPath } from 'node:url'; // ESM 路径转换
import { dirname, join } from 'node:path'; // 路径拼接

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // 项目根目录
const PRELOAD = join(ROOT, 'src', 'preload', 'index.cjs'); // 复用主应用 preload（含 updateDialogAction/onUpdateDialog）
const PAGE = join(ROOT, 'src', 'renderer', 'update-dialog.html'); // 弹窗页面

let win = null; // 弹窗窗口引用
let playing = false; // 剧本播放防重入

// 推送弹窗内容（等页面加载完成后开始）
function push(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update-dialog:push', payload); // 推送到弹窗页
}

// 下载剧本：40% 前正常涨 → 卡住 4 秒（橙字警示）→ 恢复涨到 98% → 完成页
async function playDownloadDrama() {
  playing = true; // 防重入
  let percent = 0; // 起始进度
  const tick = (step, ms) => new Promise((res) => { // 每次上涨的定时器
    const t = setInterval(() => { // 步进
      percent = Math.min(percent + step, 98); // 封顶 98%（最后 2% 给完成跳变）
      push({ phase: 'downloading', percent }); // 推送进度
      if (percent >= 98) { clearInterval(t); res(); } // 到顶结束
    }, ms); // 间隔
  });
  await tick(5, 150); // 0 → 40%（约 1.2 秒，演示正常下载节奏）
  // —— 卡住段：进度停止 4 秒，推送橙字警示文案（模拟真实卡住检测的效果）——
  push({ phase: 'downloading', percent, hint: '已 60 秒没有下载数据：可能网络较慢或与 GitHub 连接中断，请检查网络连接。若长时间无进展，可关闭本窗口稍后重试' }); // 卡住文案
  console.log('[模拟] 卡住段开始：进度停在 40%，弹窗应显示橙色警示文字'); // 控制台提示
  await new Promise((r) => setTimeout(r, 4000)); // 卡住 4 秒（真实场景是检测到 60s 无进展）
  // —— 恢复段 ——
  push({ phase: 'downloading', percent, hint: '' }); // 恢复正常文案（模拟恢复后自动回默认提示）
  console.log('[模拟] 已恢复：警示文字消失，回到默认等待文案'); // 控制台提示
  await tick(3, 150); // 40% → 98%
  push({ phase: 'app-done', version: '0.1.21' }); // 完成页：已更新完成请重启桌面端
  console.log('[模拟] 下载完成：应显示"已更新完成，请重启桌面端"'); // 控制台提示
  playing = false; // 剧本结束
}

// 弹窗按钮动作（模拟主进程处理；真实应用中这些动作走 ipc.js 的 handler）
ipcMain.handle('update-dialog:action', async (_e, action) => {
  console.log('[模拟] 用户点击按钮：', action); // 记录用户操作
  if (action === 'update') { // 立即更新 → 播放下载剧本
    if (!playing) playDownloadDrama(); // 防重复播放
    return true;
  }
  if (action === 'later') { // 暂不更新 → 告知页
    push({ phase: 'deferred' }); // 切告知页
    return true;
  }
  if (action === 'restart') { // 立即重启 → 演示结束退出
    console.log('[模拟] 真实应用中此处：打开安装包并退出应用'); // 说明
    app.quit(); // 退出演示
    return true;
  }
  // done（稍后/知道了）→ 演示结束退出
  app.quit(); // 退出演示
  return true;
});

// 应用就绪：创建弹窗并推送确认页
app.whenReady().then(() => {
  win = new BrowserWindow({ // 弹窗窗口（与主应用 update-dialog 同参数）
    width: 460, height: 400, // 尺寸
    frame: false, // 无边框
    resizable: false, // 不可调
    alwaysOnTop: true, // 置顶
    skipTaskbar: true, // 不进任务栏
    backgroundColor: '#0f1319', // 深色底
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true } // 安全基线
  });
  win.loadFile(PAGE); // 加载弹窗页
  win.webContents.once('did-finish-load', () => { // 页面就绪后推确认页
    push({ // 确认页：dsh 本体有新版本（示例数据）
      phase: 'confirm',
      type: 'dsh',
      label: 'dsh 本体',
      current: '0.1.0-rc.6',
      latest: '0.1.0-rc.7',
      notes: '### 新增功能\n* 各插件可自行注册设置卡片\n* Codex 与 Claude Code 子代理任务接入 Job Panel\n\n### 问题修复\n* 修复大历史消息分页栈溢出\n* 修复 max-tokens 截断导致会话无法继续'
    });
    console.log('[模拟] 确认页已显示：点「立即更新」看进度条与卡住警示效果'); // 控制台提示
  });
  win.on('closed', () => app.quit()); // 窗口被关也退出
});

app.on('window-all-closed', () => app.quit()); // 兜底退出
