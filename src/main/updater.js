// 更新模块（无依赖手动路线）：查 GitHub Releases 最新版 → 比较版本 → 下载安装包
// 更新安装由 NSIS 安装器完成（覆盖安装即升级，userData 配置自动保留）
// 放弃 electron-updater：其 6.8.9 与 Electron 43 ESM 主进程不兼容（内部 app 引用为空）

import { app, shell, Notification } from 'electron'; // Electron 命名导入（已验证在真主进程可用）
import { join } from 'node:path'; // 路径拼接
import { writeFile, mkdir } from 'node:fs/promises'; // 文件写出
import { getMainWindow } from './window.js'; // 主窗口引用

// GitHub 发布仓库（与 electron-builder.yml 的 publish 配置一致）
const REPO = 'wuyuzi-luo/dsh-desktop';
// 更新状态缓存（面板拉取用）
let updaterState = { status: 'idle', info: null }; // idle | checking | available | downloading | downloaded | error | up-to-date

// 变更更新状态并推送
function setState(status, info) {
  updaterState = { status, info: info ?? updaterState.info }; // 合并
  const win = getMainWindow(); // 主窗口
  if (win && !win.isDestroyed()) { // 推送状态给面板（面板若开着）
    win.webContents.send('updater:state', updaterState); // 推送
  }
}

// 简单 semver 比较：返回 1（a 新）、-1（b 新）、0（相同）
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number); // 解析 a
  const pb = String(b).replace(/^v/, '').split('.').map(Number); // 解析 b
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { // 逐段比较
    const x = pa[i] ?? 0; // 缺段补 0
    const y = pb[i] ?? 0; // 缺段补 0
    if (x > y) return 1; // a 新
    if (x < y) return -1; // b 新
  }
  return 0; // 相同
}

// 执行一次更新检查（静默模式：失败不打扰，仅记状态）
export async function checkForUpdates({ manual = false } = {}) {
  setState('checking'); // 检查中
  try {
    // 查 GitHub Releases 最新版元信息
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { // Releases API
      headers: { 'User-Agent': 'dsh-desktop' }, // GitHub API 要求 UA
      signal: AbortSignal.timeout(15000) // 15s 超时
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // 非 200
    const release = await res.json(); // 解析
    const remote = String(release?.tag_name ?? '').replace(/^v/, ''); // 远端版本
    if (!remote) throw new Error('no tag'); // 无版本号
    if (compareVersions(remote, app.getVersion()) <= 0) { // 不比当前新
      setState('up-to-date', { version: app.getVersion() }); // 已是最新
      return updaterState; // 返回状态
    }
    const asset = (release.assets ?? []).find((a) => String(a.name).endsWith('.exe')); // 找安装包资源
    if (!asset) throw new Error('no exe asset'); // 无安装包
    setState('downloading', { version: remote, url: asset.browser_download_url, percent: 0 }); // 进入下载（0%）
    const dl = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(600000) }); // 下载安装包（最长 10 分钟）
    if (!dl.ok || !dl.body) throw new Error(`download HTTP ${dl.status}`); // 下载失败
    // 流式读取：边下载边报进度（面板显示百分比）
    const total = Number(dl.headers.get('content-length')) || 0; // 总字节（缺省 0 表示未知）
    const reader = dl.body.getReader(); // 流读取器
    const chunks = []; // 分块缓冲
    let received = 0; // 已收字节
    while (true) { // 持续读流
      const { done, value } = await reader.read(); // 读一块
      if (done) break; // 完成
      chunks.push(value); // 收集
      received += value.length; // 累加
      if (total) setState('downloading', { version: remote, percent: Math.round((received / total) * 100) }); // 报进度
    }
    const buf = Buffer.concat(chunks); // 合并为完整缓冲
    const dlDir = app.getPath('downloads'); // 用户下载目录
    await mkdir(dlDir, { recursive: true }); // 确保存在
    const filePath = join(dlDir, `dsh-desktop-setup-${remote}.exe`); // 目标文件
    await writeFile(filePath, buf); // 落盘
    setState('downloaded', { version: remote, path: filePath }); // 下载完成
    // 弹通知：点击即打开安装包（覆盖安装升级）
    const n = new Notification({ title: 'dsh 桌面更新已就绪', body: `新版本 v${remote} 已下载，点击安装（配置将保留）` }); // 通知
    n.on('click', () => shell.openPath(filePath)); // 点击打开安装器
    n.show(); // 弹出
    if (manual) shell.openPath(filePath); // 手动检查时直接打开安装包
  } catch (err) {
    setState('error', { message: String(err?.message ?? err) }); // 记错误态（静默）
  }
  return updaterState; // 返回状态
}

// 创建更新管理器（面板 IPC 用）
export function createUpdater() {
  return {
    silentCheck: () => checkForUpdates({ manual: false }), // 启动静默检查
    manualCheck: () => checkForUpdates({ manual: true }), // 面板手动检查
    getState: () => ({ version: app.getVersion(), ...updaterState }) // 状态快照
  };
}
