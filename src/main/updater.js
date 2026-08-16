// 更新模块（无依赖手动路线）：
// APP：查 GitHub Releases 最新版 → 比较版本 → 提示用户 → 确认后下载 → 点击通知安装
// dsh 本体：读本机版本 + npm view 对比 → 提示用户 → 确认后 npm install 更新并重启服务
// 更新安装由 NSIS 安装器完成（覆盖安装即升级，userData 配置自动保留）
// 放弃 electron-updater：其 6.8.9 与 Electron 43 ESM 主进程不兼容（内部 app 引用为空）

import { app, shell, Notification } from 'electron'; // Electron 命名导入（已验证在真主进程可用）
import { join } from 'node:path'; // 路径拼接
import { writeFile, mkdir, readFile } from 'node:fs/promises'; // 文件写出/读取
import { spawn, exec } from 'node:child_process'; // npm 更新 dsh 用
import { promisify } from 'node:util'; // 回调转 Promise
import { getMainWindow } from './window.js'; // 主窗口引用
import { getConfig } from './config.js'; // 配置读取

// 用户网络环境（MITM 代理/杀软证书劫持）下 undici fetch 报 UNABLE_TO_VERIFY_LEAF_SIGNATURE，
// 与打包工具链同策略关闭证书校验（个人工具，仓库与安装包均有签名，风险可接受）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const execP = promisify(exec); // npm view 用
// GitHub 发布仓库（与 electron-builder.yml 的 publish 配置一致）
const REPO = 'wuyuzi-luo/dsh-desktop';
// APP 更新状态缓存（面板拉取用）
let updaterState = { status: 'idle', info: null }; // idle | checking | available | downloading | downloaded | error | up-to-date
// dsh 本体更新状态缓存
let dshState = { status: 'idle', current: null, latest: null }; // idle | checking | available | updating | error | up-to-date
// 依赖回调（index.js 注入）
let openPanelFn = null; // 打开控制面板（通知点击用）
let restartServiceFn = null; // 重启 dsh 服务（本体更新后用）
let updatingDsh = false; // dsh 更新防重入标志

// 推送全部更新状态给面板（面板若开着）
function pushState() {
  const win = getMainWindow(); // 主窗口
  if (win && !win.isDestroyed()) { // 面板是独立窗口，但推送沿用主窗口通道惯例
    win.webContents.send('updater:state', { app: updaterState, dsh: dshState }); // 推送
  }
}
function setApp(status, info) { updaterState = { status, info: info ?? updaterState.info }; pushState(); } // APP 状态变更
function setDsh(status, extra) { dshState = { ...dshState, status, ...(extra ?? {}) }; pushState(); } // dsh 状态变更

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

// 弹"新版本可用"通知：点击打开控制面板（由用户决定是否更新）
function notifyAvailable(title, body) {
  try {
    const n = new Notification({ title, body, silent: false }); // 系统通知
    n.on('click', () => openPanelFn?.()); // 点击 → 面板
    n.show(); // 弹出
  } catch { /* 通知失败忽略 */ }
}

// —— APP 更新：只检测与提示，下载由用户确认后触发 ——
export async function checkForUpdates({ manual = false } = {}) {
  setApp('checking'); // 检查中
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
      setApp('up-to-date', { version: app.getVersion() }); // 已是最新
      return updaterState; // 返回状态
    }
    const asset = (release.assets ?? []).find((a) => String(a.name).endsWith('.exe')); // 找安装包资源
    if (!asset) throw new Error('no exe asset'); // 无安装包
    setApp('available', { version: remote, url: asset.browser_download_url }); // 有新版本：仅提示
    notifyAvailable('dsh 桌面新版本可用', `发现 v${remote}（当前 v${app.getVersion()}），点击打开控制面板更新`); // 通知提示
  } catch (err) {
    setApp('error', { message: String(err?.message ?? err) }); // 记错误态（静默）
  }
  return updaterState; // 返回状态
}

// 用户确认后下载安装包（面板"更新"按钮触发）
export async function downloadUpdate() {
  const info = updaterState.info; // 可用版本信息
  if (updaterState.status !== 'available' || !info?.url) return updaterState; // 状态不符不下载
  setApp('downloading', { version: info.version, percent: 0 }); // 进入下载（0%）
  try {
    const dl = await fetch(info.url, { signal: AbortSignal.timeout(600000) }); // 下载安装包（最长 10 分钟）
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
      if (total) setApp('downloading', { version: info.version, percent: Math.round((received / total) * 100) }); // 报进度
    }
    const buf = Buffer.concat(chunks); // 合并为完整缓冲
    const dlDir = app.getPath('downloads'); // 用户下载目录
    await mkdir(dlDir, { recursive: true }); // 确保存在
    const filePath = join(dlDir, `dsh-desktop-setup-${info.version}.exe`); // 目标文件
    await writeFile(filePath, buf); // 落盘
    setApp('downloaded', { version: info.version, path: filePath }); // 下载完成
    // 弹通知：点击即打开安装包（覆盖安装升级）
    const n = new Notification({ title: 'dsh 桌面更新已就绪', body: `新版本 v${info.version} 已下载，点击安装（配置将保留）` }); // 通知
    n.on('click', () => shell.openPath(filePath)); // 点击打开安装器
    n.show(); // 弹出
  } catch (err) {
    setApp('error', { message: String(err?.message ?? err) }); // 记错误态
  }
  return updaterState; // 返回状态
}

// —— dsh 本体更新：读本机版本 + npm view 对比，确认后 npm install ——
// 读本机 dsh 版本（安装目录下官方包的 package.json）
async function getLocalDshVersion() {
  try {
    const pkgPath = join(getConfig('dshDir'), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'); // 包清单路径
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')); // 读并解析
    return pkg.version ?? null; // 版本号
  } catch {
    return null; // 读不到（未安装）→ null
  }
}

// 检测 dsh 本体更新（静默模式：失败不打扰，仅记状态）
export async function checkDshUpdate({ manual = false } = {}) {
  const current = await getLocalDshVersion(); // 本机版本
  setDsh('checking', { current }); // 检查中
  if (!current) { setDsh('error', { message: '未检测到 dsh 安装' }); return dshState; } // 无本机版本
  try {
    const { stdout } = await execP('npm view @deepseek-ai/dsh version', { timeout: 20000 }); // 查 npm 最新版
    const latest = String(stdout).trim().split(/\s+/)[0]; // 取第一行第一个值
    if (!latest) throw new Error('no version'); // 无结果
    if (compareVersions(latest, current) <= 0) { // 不比当前新
      setDsh('up-to-date', { current, latest }); // 已是最新
      return dshState; // 返回
    }
    setDsh('available', { current, latest }); // 有新版本：仅提示
    notifyAvailable('dsh 本体新版本可用', `dsh v${latest} 已发布（当前 v${current}），点击打开控制面板更新`); // 通知提示
  } catch (err) {
    setDsh('error', { message: String(err?.message ?? err) }); // 记错误态（静默）
  }
  return dshState; // 返回状态
}

// 用户确认后更新 dsh：npm install 到安装目录 → 重启服务生效
export async function updateDsh() {
  const latest = dshState.latest; // 目标版本
  if (dshState.status !== 'available' || !latest) return dshState; // 状态不符
  if (updatingDsh) return dshState; // 防重入
  updatingDsh = true; // 置标志
  setDsh('updating', { current: dshState.current, latest }); // 更新中
  try {
    const dir = getConfig('dshDir'); // 安装目录
    const child = spawn('npm', ['install', `@deepseek-ai/dsh@${latest}`, '--no-fund', '--no-audit'], {
      cwd: dir, // 安装目录为工作目录
      shell: true, // Windows npm.cmd 解析
      windowsHide: true // 不弹黑窗
    });
    // 等安装结束（10 分钟看门狗）
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => { try { child.kill(); } catch { /* 已死忽略 */ } resolve(null); }, 10 * 60_000); // 超时强杀
      child.on('exit', (c) => { clearTimeout(timer); resolve(c); }); // 正常退出
    });
    if (code !== 0) { setDsh('error', { message: 'dsh 更新失败（网络或权限问题）' }); return dshState; } // 失败
    setDsh('up-to-date', { current: latest, latest }); // 更新完成
    restartServiceFn?.(); // 重启服务让新版本生效（状态推送驱动界面）
    try { // 成功通知
      const n = new Notification({ title: 'dsh 本体已更新', body: `dsh 已更新到 v${latest}，服务已重启` }); // 通知
      n.show(); // 弹出
    } catch { /* 通知失败忽略 */ }
  } finally {
    updatingDsh = false; // 复位
  }
  return dshState; // 返回状态
}

// 创建更新管理器（面板 IPC 用；index.js 注入回调）
export function createUpdater(deps = {}) {
  openPanelFn = deps.openPanel ?? null; // 面板打开回调
  restartServiceFn = deps.restartService ?? null; // 服务重启回调
  return {
    silentCheck: () => checkForUpdates({ manual: false }), // 启动静默检查 APP
    manualCheck: () => checkForUpdates({ manual: true }), // 面板手动检查 APP
    download: downloadUpdate, // 用户确认下载 APP 更新
    silentDshCheck: () => checkDshUpdate({ manual: false }), // 启动静默检查 dsh
    manualDshCheck: () => checkDshUpdate({ manual: true }), // 面板手动检查 dsh
    updateDsh, // 用户确认更新 dsh
    getState: () => ({ version: app.getVersion(), app: updaterState, dsh: dshState }) // 状态快照
  };
}
