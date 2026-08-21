// 更新模块（无依赖手动路线）：
// APP：查 GitHub Releases 最新版 → 启动发现新版弹应用内更新弹窗（更新/暂不更新）→ 确认后下载 → 下载完成弹"请重启桌面端"
// dsh 本体：读本机版本 + npm view 对比 → 启动发现新版同样弹窗 → 确认后 npm install 更新并重启服务
// 弹窗与系统通知双保险；控制面板内两个按钮常显各自状态（含"已是最新"），无需先点检测
// 放弃 electron-updater：其 6.8.9 与 Electron 43 ESM 主进程不兼容（内部 app 引用为空）

import { app, shell, Notification } from 'electron'; // Electron 命名导入（已验证在真主进程可用）
import { join } from 'node:path'; // 路径拼接
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises'; // 文件写出/读取/删除
import { readdirSync, statSync } from 'node:fs'; // npm 日志定位/大小采样（卡死双判据用）
import { spawn } from 'node:child_process'; // npm 更新 dsh 用
import { getMainWindow, createUpdateDialogWindow, pushUpdateDialog, closeUpdateDialog, setUpdateDialogClosedHandler } from './window.js'; // 主窗口引用 + 更新弹窗
import { getConfig } from './config.js'; // 配置读取

// 用户网络环境（MITM 代理/杀软证书劫持）下 undici fetch 报 UNABLE_TO_VERIFY_LEAF_SIGNATURE，
// 与打包工具链同策略关闭证书校验（个人工具，仓库与安装包均有签名，风险可接受）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// GitHub 发布仓库（与 electron-builder.yml 的 publish 配置一致）
const REPO = 'wuyuzi-luo/dsh-desktop';
// dsh 本体更新可选源（弹窗内用户自选；--registry 参数实现，不改任何配置文件）
const MIRROR_REGISTRY = 'https://registry.npmmirror.com'; // 国内镜像（快）
const OFFICIAL_REGISTRY = 'https://registry.npmjs.org'; // 官方源（慢但原汁原味）
// dsh 官方仓库（拿本体更新说明用）
const DSH_REPO = 'deepseek-ai/deepseek-harness';
// APP 更新状态缓存（面板拉取用）
let updaterState = { status: 'idle', info: null }; // idle | checking | available | downloading | downloaded | error | up-to-date
// dsh 本体更新状态缓存
let dshState = { status: 'idle', current: null, latest: null }; // idle | checking | available | updating | error | up-to-date
// 依赖回调（index.js 注入）
let openPanelFn = null; // 打开控制面板（通知点击用）
let restartServiceFn = null; // 重启 dsh 服务（本体更新后用）
let stopServiceFn = null; // 停止 dsh 服务（本体更新前用，防替换运行中文件）
let updatingDsh = false; // dsh 更新防重入标志
let appDialogShown = false; // APP 确认弹窗本次进程只弹一次（手动检查强制弹时不受限）
let dshDialogShown = false; // dsh 确认弹窗本次进程只弹一次（手动检查强制弹时不受限）
let dialogType = null; // 弹窗当前对应的组件类型（app | dsh）
let dialogQueue = []; // 待弹弹窗队列（APP 与 dsh 同时有新版时依次弹，避免覆盖）
let currentDialog = null; // 当前正在显示的弹窗 payload（队列头出队后驻留于此，关闭时置 null 接续下一个）
let downloadDialogDismissed = false; // 用户在下载期间主动关闭了弹窗（进度推送不再重建窗口，完成页仍必弹）

// 推送全部更新状态给面板（面板若开着）
function pushState() {
  const win = getMainWindow(); // 主窗口
  if (win && !win.isDestroyed()) { // 面板是独立窗口，但推送沿用主窗口通道惯例
    win.webContents.send('updater:state', { app: updaterState, dsh: dshState }); // 推送
  }
}
function setApp(status, info) { updaterState = { status, info: info ?? updaterState.info }; pushState(); } // APP 状态变更
function setDsh(status, extra) { dshState = { ...dshState, status, ...(extra ?? {}) }; pushState(); } // dsh 状态变更

// semver 比较：返回 1（a 新）、-1（b 新）、0（相同）
// 正确解析 主版本 与 预发布段：0.1.1-rc.1 → 主 [0,1,1] + 预 [rc,1]
// （旧实现按 '.' 盲切，"1-rc" 转 NaN 导致 0.1.1-rc.1 被误判为比 0.1.0-rc.7 旧）
function compareVersions(a, b) {
  const parse = (v) => { // 解析版本串
    const s = String(v ?? '').replace(/^v/, ''); // 去 v 前缀
    const dash = s.indexOf('-'); // 预发布分隔符
    const main = dash >= 0 ? s.slice(0, dash) : s; // 主版本部分
    const pre = dash >= 0 ? s.slice(dash + 1) : ''; // 预发布部分
    return { main: main.split('.').map(Number), pre: pre ? pre.split('.') : [] }; // 结构化
  };
  const A = parse(a); // 解析 a
  const B = parse(b); // 解析 b
  for (let i = 0; i < Math.max(A.main.length, B.main.length); i++) { // 主版本逐段比较
    const x = A.main[i] ?? 0; // 缺段补 0
    const y = B.main[i] ?? 0; // 缺段补 0
    if (x > y) return 1; // a 新
    if (x < y) return -1; // b 新
  }
  // 主版本相同：按 semver 规则比预发布（有预发布段者更旧；数字段大于字符串段）
  if (A.pre.length && !B.pre.length) return -1; // a 是预发布 b 是正式 → b 新
  if (!A.pre.length && B.pre.length) return 1; // a 正式 b 预发布 → a 新
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) { // 预发布逐段比较
    const x = A.pre[i] ?? ''; // 缺段补空
    const y = B.pre[i] ?? ''; // 缺段补空
    if (x === y) continue; // 相同继续
    const nx = Number(x); const ny = Number(y); // 数字化
    const xNum = x !== '' && !Number.isNaN(nx); // x 是数字段
    const yNum = y !== '' && !Number.isNaN(ny); // y 是数字段
    if (xNum && yNum) return nx > ny ? 1 : -1; // 双数字：比大小
    if (xNum !== yNum) return xNum ? 1 : -1; // 数字段 > 字符串段（semver 规则）
    return x > y ? 1 : -1; // 双字符串：字典序
  }
  return 0; // 完全相同
}

// 检查串行队列：面板自动补查与手动检查可能并发，若交错执行会旧结果覆盖新结果
// （曾出现"弹窗说检测到新版、消息框却说检查失败"的矛盾）。串行化保证按触发顺序依次执行。
let checkChain = Promise.resolve(); // 串行链（初始已就绪）
function serialize(fn) {
  const run = checkChain.then(fn, fn); // 无论上一个成败都执行本次
  checkChain = run.then(() => {}, () => {}); // 链条吞掉错误继续排下一个
  return run; // 返回本次执行结果（调用方 await 得到的就是本次的最终状态）
}

// 弹"新版本可用"系统通知：点击打开控制面板（后台提醒，防用户手快关掉弹窗）
function notifyAvailable(title, body) {
  try {
    const n = new Notification({ title, body, silent: false }); // 系统通知
    n.on('click', () => openPanelFn?.()); // 点击 → 面板
    n.show(); // 弹出
  } catch { /* 通知失败忽略 */ }
}

// 显示更新弹窗（未创建则先创建；页面加载中则等加载完再推送，防止内容丢失）
function showDialog(payload) {
  createUpdateDialogWindow(); // 确保窗口存在
  pushUpdateDialog(payload); // 推送内容（window.js 内部处理加载时序）
}

// 弹"发现新版本"确认弹窗（组件名 + 版本对比 + 更新内容 + 更新/暂不更新按钮）
// 入队方式弹出：APP 与 dsh 同时有新版时先弹 APP，用户处理完后自动弹 dsh（不互相覆盖）
function showConfirmDialog(type, label, current, latest, notes) {
  enqueueDialog({ phase: 'confirm', type, label, current, latest, notes: notes || '' }); // 入队确认页（源选择每次默认镜像，不记忆）
}

// 弹窗队列：入队；当前无弹窗时立即弹，有则等当前弹窗关闭后接续
// （修复：旧实现入队即出队、队列恒空，"等关闭再弹下一个"从未生效——APP 与 dsh 同时有新版时互相覆盖）
function enqueueDialog(payload) {
  dialogQueue.push(payload); // 入队
  if (!currentDialog) showNextDialog(); // 当前无弹窗 → 立即弹（有则排队等关闭）
}

// 弹出队列中的下一个弹窗（payload 里带 type，"立即更新"按钮据此选择更新链路）
function showNextDialog() {
  currentDialog = dialogQueue.shift() ?? null; // 出队为当前弹窗
  if (!currentDialog) return; // 队列空
  dialogType = currentDialog.type ?? null; // 记录当前弹窗的组件类型
  showDialog(currentDialog); // 弹窗
}

// 弹窗窗口关闭回调：继续弹队列中的下一个（window.js closed 事件注入）
setUpdateDialogClosedHandler(() => {
  if (updaterState.status === 'downloading') downloadDialogDismissed = true; // 下载中用户主动关窗：标记（进度推送不再重建）
  currentDialog = null; // 当前弹窗已关闭
  showNextDialog(); // 队列接续（有排队项才弹）
}); // 注册

// —— APP 更新：检测 + 弹窗/通知提示，下载由用户确认后触发 ——
// 参数：popup=检测到新版弹应用内弹窗；notify=弹系统通知（面板静默补查时两者都关）
export function checkForUpdates(opts = {}) {
  return serialize(() => doCheckForUpdates(opts)); // 串行化防并发交错（详见 serialize 注释）
}
async function doCheckForUpdates({ popup = true, notify = true } = {}) {
  if (updaterState.status === 'downloading' || updaterState.status === 'downloaded') return updaterState; // 下载中/已下载：检查不得打断（会覆盖状态、丢失安装包路径）
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
    setApp('available', { version: remote, url: asset.browser_download_url, notes: String(release?.body ?? '') }); // 有新版（带上更新说明）
    if (popup && (popup === 'force' || !appDialogShown)) { // 弹应用内弹窗：force=手动检查必弹；true=启动只弹一次
      appDialogShown = true; // 置标志
      showConfirmDialog('app', 'dsh 桌面端', app.getVersion(), remote, release?.body); // 确认弹窗
    }
    if (notify) notifyAvailable('dsh 桌面新版本可用', `发现 v${remote}（当前 v${app.getVersion()}），可在控制面板更新`); // 系统通知双保险
  } catch (err) {
    // 注意：此时 updaterState.status 已被 setApp('checking') 改成 checking，不能再用 status 判断（与 dsh 检查同策略修复）
    const hasKnown = Boolean(updaterState.info?.version); // 之前有成功结论：info 里有版本号
    if (hasKnown) { // 网络失败：按版本比较恢复正确结论（不覆盖，防静默矛盾）
      // 修复：up-to-date 时 info 也带 version，旧实现一律恢复 available 会把"已是最新"误报成"有新版"
      const newer = compareVersions(updaterState.info.version, app.getVersion()) > 0; // 上次结论是否真有新版
      setApp(newer ? 'available' : 'up-to-date'); // 恢复正确状态
      if (popup === 'force' && newer) { // 手动检查失败但已知有新版：用缓存数据重弹
        showConfirmDialog('app', 'dsh 桌面端', app.getVersion(), updaterState.info.version, updaterState.info.notes); // 重弹确认窗
      }
    } else { // 从未成功过：才记错误态
      setApp('error', { message: String(err?.message ?? err) }); // 记错误态
    }
  }
  return updaterState; // 返回状态
}

// 用户确认后下载安装包（弹窗"立即更新"或面板按钮触发）
export async function downloadUpdate() {
  const info = updaterState.info; // 可用版本信息
  if (updaterState.status !== 'available' || !info?.url) return updaterState; // 状态不符不下载
  setApp('downloading', { version: info.version, url: info.url, percent: 0 }); // 进入下载（保留 url：失败重试用）
  downloadDialogDismissed = false; // 重置"用户已关窗"标志（新一轮下载）
  const pushDownload = (payload) => { // 下载进度推送：用户已手动关窗则不再重建（修复"关不掉的进度弹窗"）
    if (downloadDialogDismissed) return; // 已关闭：静默跳过（完成页仍会必弹）
    showDialog(payload); // 推送/重建窗口
  };
  pushDownload({ phase: 'downloading', percent: 0 }); // 弹窗切到下载进度页
  // 卡住检测：60 秒内 0 字节进展 → 弹窗橙字提示原因 + 系统通知（只弹一次）；恢复后自动回默认文案
  let lastData = Date.now(); // 最后收到下载数据的时间戳
  let stuckNotified = false; // 本次卡住是否已发过系统通知（防重复骚扰）
  const stuckTimer = setInterval(() => {
    if (updaterState.status !== 'downloading') return; // 下载已结束（完成/失败）
    const idle = Math.round((Date.now() - lastData) / 1000); // 已空闲秒数
    const percent = updaterState.info?.percent ?? 0; // 当前进度
    if (idle >= 60) { // 判定卡住
      pushDownload({ phase: 'downloading', percent, hint: `已 ${idle} 秒没有下载数据：可能网络较慢或与 GitHub 连接中断，请检查网络连接。若长时间无进展，可关闭本窗口稍后重试` }); // 弹窗橙字
      if (!stuckNotified) { // 首次卡住 → 系统通知（切到别的窗口也能看到）
        stuckNotified = true; // 置标志
        try { new Notification({ title: '下载可能卡住了', body: '已超过 1 分钟没有下载进展，请检查网络连接' }).show(); } catch { /* 忽略 */ }
      }
    } else if (stuckNotified && idle < 10) { // 已恢复进展
      stuckNotified = false; // 复位
      pushDownload({ phase: 'downloading', percent, hint: '' }); // 恢复正常文案
    }
  }, 10000); // 每 10 秒检查一次
  try {
    const dl = await fetch(info.url, { signal: AbortSignal.timeout(600000) }); // 下载安装包（最长 10 分钟）
    if (!dl.ok || !dl.body) throw new Error(`download HTTP ${dl.status}`); // 下载失败
    // 流式读取：边下载边报进度（弹窗进度条 + 面板百分比）
    const total = Number(dl.headers.get('content-length')) || 0; // 总字节（缺省 0 表示未知）
    const reader = dl.body.getReader(); // 流读取器
    const chunks = []; // 分块缓冲
    let received = 0; // 已收字节
    while (true) { // 持续读流
      const { done, value } = await reader.read(); // 读一块
      if (done) break; // 完成
      chunks.push(value); // 收集
      received += value.length; // 累加
      lastData = Date.now(); // 更新最后数据时间（卡住检测基准）
      if (total) { // 已知总量才报进度
        const percent = Math.round((received / total) * 100); // 百分比
        setApp('downloading', { version: info.version, url: info.url, percent }); // 面板状态（保留 url）
        pushDownload({ phase: 'downloading', percent }); // 弹窗进度（已关窗则跳过）
      }
    }
    const buf = Buffer.concat(chunks); // 合并为完整缓冲
    const dlDir = app.getPath('downloads'); // 用户下载目录
    await mkdir(dlDir, { recursive: true }); // 确保存在
    const filePath = join(dlDir, `dsh-desktop-setup-${info.version}.exe`); // 目标文件
    await writeFile(filePath, buf); // 落盘
    setApp('downloaded', { version: info.version, path: filePath }); // 下载完成
    // 必须弹窗提示：已更新完成，请重启桌面端（用户明确要求，任何触发路径都弹）
    showDialog({ phase: 'app-done', version: info.version }); // 完成页（立即重启/稍后）
    const n = new Notification({ title: 'dsh 桌面更新已就绪', body: `新版本 v${info.version} 已下载完成，请重启桌面端（点击打开安装包）` }); // 通知
    n.on('click', () => shell.openPath(filePath)); // 点击打开安装器
    n.show(); // 弹出
  } catch (err) {
    setApp('error', { message: String(err?.message ?? err) }); // 记错误态
    showDialog({ phase: 'app-error' }); // 弹窗提示下载失败（保持弹窗可见并给出反馈）
  } finally {
    clearInterval(stuckTimer); // 停止卡住检测（下载结束）
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

// 获取 dsh 更新说明：官方仓库 release 页找 tag=dsh-v{版本} 的 body（中文更新内容）
async function getDshReleaseNotes(version) {
  try {
    const res = await fetch(`https://api.github.com/repos/${DSH_REPO}/releases?per_page=10`, { // 最近 10 个 release
      headers: { 'User-Agent': 'dsh-desktop' }, // GitHub API 要求 UA
      signal: AbortSignal.timeout(10000) // 10s 超时
    });
    if (!res.ok) return null; // 拿不到就算了
    const releases = await res.json(); // 解析列表
    const hit = (releases ?? []).find((r) => String(r?.tag_name) === `dsh-v${version}`); // 按 tag 匹配
    return hit?.body ? String(hit.body) : null; // 命中则返回更新内容
  } catch {
    return null; // 网络失败 → null（弹窗显示"暂无详细更新说明"）
  }
}

// 检测 dsh 本体更新（失败不打扰，仅记状态）
// 参数：popup=发现新版弹应用内弹窗；notify=弹系统通知（面板静默补查时两者都关）
export function checkDshUpdate(opts = {}) {
  return serialize(() => doCheckDshUpdate(opts)); // 串行化防并发交错（详见 serialize 注释）
}
async function doCheckDshUpdate({ popup = true, notify = true } = {}) {
  if (dshState.status === 'updating') return dshState; // 更新中：检查不得打断安装流程（会覆盖状态、干扰自愈检测）
  const current = await getLocalDshVersion(); // 本机版本
  setDsh('checking', { current }); // 检查中
  if (!current) { setDsh('error', { message: '未检测到 dsh 安装' }); return dshState; } // 无本机版本
  try {
    // 查 npm 最新版：改用 fetch 直连 registry（复用主进程 TLS 豁免，比子进程 npm view 更稳定，
    // 之前"检查失败"频发多因 npm CLI 子进程受系统代理/证书影响）
    const res = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh/latest', { // registry 简写端点
      headers: { 'User-Agent': 'dsh-desktop' }, // 礼貌标识
      signal: AbortSignal.timeout(15000) // 15s 超时
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // 非 200
    const latest = String((await res.json())?.version ?? '').trim(); // 最新版本号
    if (!latest) throw new Error('no version'); // 无结果
    if (compareVersions(latest, current) <= 0) { // 不比当前新
      setDsh('up-to-date', { current, latest }); // 已是最新
      return dshState; // 返回
    }
    const notes = await getDshReleaseNotes(latest); // 官方 release 更新说明（拿不到为 null）
    setDsh('available', { current, latest, notes }); // 有新版本（带上更新说明）
    if (popup && (popup === 'force' || !dshDialogShown)) { // 弹应用内弹窗：force=手动检查必弹；true=启动只弹一次
      dshDialogShown = true; // 置标志
      showConfirmDialog('dsh', 'dsh 本体', current, latest, notes); // 确认弹窗
    }
    if (notify) notifyAvailable('dsh 本体新版本可用', `dsh v${latest} 已发布（当前 v${current}），可在控制面板更新`); // 系统通知双保险
  } catch (err) {
    // 注意：此时 dshState.status 已被上面 setDsh('checking') 改成 checking，不能再用 status 判断"之前是否确认过结果"
    // （旧实现恒为 false → 失败就覆盖 error → 面板又不弹消息框 → 用户点检查更新完全静默）
    const hasKnown = Boolean(dshState.latest && dshState.current); // 之前有成功结论：latest/current 字段仍在
    if (hasKnown) { // 网络失败：恢复到上次结论（不覆盖，防静默矛盾）
      const newer = compareVersions(dshState.latest, dshState.current) > 0; // 上次结论是有新版？
      setDsh(newer ? 'available' : 'up-to-date'); // 恢复状态
      if (popup === 'force' && newer) { // 手动检查失败但已知有新版：用缓存数据重弹（用户仍可更新）
        showConfirmDialog('dsh', 'dsh 本体', dshState.current, dshState.latest, dshState.notes); // 重弹确认弹窗
      }
    } else { // 从未成功过：才记错误态
      setDsh('error', { message: String(err?.message ?? err) }); // 记错误态
    }
  }
  return dshState; // 返回状态
}

// 强杀整个进程树：spawn 用 shell:true 时 child 引用是 cmd 壳，npm 是其子进程，
// child.kill() 只杀壳会留下 npm 孤儿继续锁文件（自愈重试撞锁卡死在同一点的根因）。
// Windows 用 taskkill /T /F 把整棵树端掉。
function killTree(pid) {
  if (!pid) return; // 无进程
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false }); // 杀进程树
  } catch { /* 忽略 */ }
}

// 清理残留的 npm install 进程：上次更新卡死/中断留下的 npm 进程会锁住 node_modules 文件，
// 导致新一轮安装 placeDep 阶段卡死（用户实测踩坑）。只杀命令行含 npm-cli 的 node 进程，
// dsh 服务（lib/bin.js web）与 Claude Code 等不受影响。
function killStaleNpmInstalls() {
  return new Promise((resolve) => {
    // 修复：匹配条件加 'deepseek-ai/dsh'——只杀本项目的 dsh 安装进程（命令行含 install @deepseek-ai/dsh），
    // 旧条件 '*npm-cli*install*' 会误杀用户在其他项目/终端并行跑的 npm install
    const ps = spawn('powershell', ['-NoProfile', '-Command', // PowerShell 精准过滤
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*npm-cli*install*' -and $_.CommandLine -like '*deepseek-ai/dsh*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], {
      shell: false, // 直接调 powershell
      windowsHide: true // 不弹黑窗
    });
    ps.on('exit', () => resolve()); // 执行完即返回（无残留时静默成功）
    setTimeout(() => { try { ps.kill(); } catch { /* 忽略 */ } resolve(); }, 30000); // 30 秒兜底（PowerShell 冷启动 3~10 秒，10 秒会中断清理）
  });
}

// 用户确认后更新 dsh：npm install 到安装目录 → 重启服务生效
// registry：'mirror'=国内镜像 / 'official'=官方源（弹窗内用户自选，--registry 参数直接生效）
// 自愈机制：安装前清残留 npm 进程；卡死 5 分钟自动杀进程重试一次（普通用户点一下就完事，不需人工介入）
export async function updateDsh({ registry } = {}) {
  const latest = dshState.latest; // 目标版本
  if (dshState.status !== 'available' || !latest) return dshState; // 状态不符
  if (updatingDsh) return dshState; // 防重入
  updatingDsh = true; // 置标志
  setDsh('updating', { current: dshState.current, latest }); // 更新中
  await stopServiceFn?.(); // 更新前先停服务：避免 npm 替换运行中文件导致服务崩溃（装完会自动重启）
  // 注：残留进程清理与旧包删除已移进重试循环（每次尝试前都重清——第一次卡死的根因若是文件锁，
  // 第二次必须重清，否则撞同一把锁自愈必然无效）
  // 进度驱动：只由真实 npm 输出推进（心跳假进度已移除——曾让用户误以为 88% 快完成实际卡死）
  // 无输出时进度条保持不动 + 卡住警示持续显示，真实反映安装状态
  let percent = 5; // 起始进度（正在连接 npm 源）
  const bump = (n) => { // 有真实输出才上涨进度并推送弹窗
    percent = Math.min(92, percent + n); // 封顶 92%（最后 8% 留给安装收尾）
    showDialog({ phase: 'updating', percent, hint: '' }); // 推送进度（带空 hint：新输出=进展，清除卡住警示）
  };
  showDialog({ phase: 'updating', percent }); // 弹窗切到"正在更新"页（5%）
  // 卡住检测：60 秒无输出 → 橙字警示 + 系统通知（一次）；2 分半真卡死 → 自动杀进程重试（自愈）
  // 双判据修复：npm 卡死时会往 stderr 刷 spinner 假输出，"无输出"判据被持续刷新永不触发；
  // 增加"npm 调试日志文件 150 秒无增长"第二判据——日志只在真实安装进展时写入，spinner 骗不了它。
  let lastOutput = Date.now(); // 最后一次收到 npm 输出的时间戳
  let stuckNotified = false; // 本次卡住是否已发过系统通知（防重复骚扰）
  let autoRetried = false; // 是否已自动重试过（只重试一次）
  let currentChild = null; // 当前 npm 子进程（卡住自动处置用）
  let installFinished = false; // 安装是否已结束（成功或最终失败）
  const logsDir = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_logs'); // npm 调试日志目录（npmEnv 继承同环境变量）
  let logFile = null; // 本次安装的 npm 日志文件路径
  let logLastSize = -1; // 日志上次采样大小
  let logLastChange = Date.now(); // 日志最后变化时间
  const stuckTimer = setInterval(() => {
    if (installFinished) return; // 已结束
    const idle = Math.round((Date.now() - lastOutput) / 1000); // 输出已空闲秒数
    if (logFile) { // 采样日志大小（stat 失败则放弃该判据）
      try {
        const size = statSync(logFile).size; // 当前大小
        if (size !== logLastSize) { logLastSize = size; logLastChange = Date.now(); } // 有增长 → 刷新基准
      } catch { logFile = null; } // 日志被删/移动 → 退回单判据
    }
    const logFrozen = logFile ? Date.now() - logLastChange >= 150000 : false; // 日志 150 秒无增长
    if (idle >= 60) { // 轻度卡住（输出停）→ 警示
      showDialog({ phase: 'updating', percent, hint: `已 ${idle} 秒没有安装进展：可能网络较慢或连接中断，请检查网络连接。若长时间无进展，可关闭本窗口稍后重试` }); // 弹窗橙字（无心跳覆盖，稳定显示）
      if (!stuckNotified) { // 首次卡住 → 系统通知
        stuckNotified = true; // 置标志
        try { new Notification({ title: 'dsh 更新可能卡住了', body: '已超过 1 分钟没有安装进展，请检查网络连接' }).show(); } catch { /* 忽略 */ }
      }
    }
    const realStuck = logFile ? (idle >= 150 && logFrozen) : idle >= 150; // 真卡死：有日志时双判据，无日志退回输出判据
    if (realStuck && !autoRetried && currentChild) { // 真卡死 2 分半且未重试过：自动杀进程并重试（自愈）
      autoRetried = true; // 置标志
      lastOutput = Date.now(); // 重置卡住基准
      showDialog({ phase: 'updating', percent, hint: '安装疑似卡住，正在自动重启安装（第 2 次尝试）…' }); // 告知自愈动作
      killTree(currentChild.pid); // 杀整个进程树（只杀壳会留下 npm 孤儿锁文件，见 killTree 注释）
    }
  }, 10000); // 每 10 秒检查一次
  try {
    const dir = getConfig('dshDir'); // 安装目录
    // 安装前同步 overrides 到目标版本：overrides 是降级时锁旧版用的，若不同步 npm install 会与锁冲突直接失败
    // （曾出现"点立即更新必失败"的问题：overrides 锁 rc.6 而安装目标 rc.7）
    try {
      const pkgPath = join(dir, 'package.json'); // 包清单路径
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')); // 读并解析
      if (pkg.overrides && typeof pkg.overrides === 'object') { // 存在 overrides
        let changed = false; // 是否有变更
        for (const k of Object.keys(pkg.overrides)) { // 逐个子包
          if (pkg.overrides[k] !== latest) { pkg.overrides[k] = latest; changed = true; } // 同步到目标版本
        }
        if (changed) await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n'); // 写回
      }
    } catch { /* overrides 同步失败不阻塞更新（没有 overrides 时走普通安装） */ }
    // 更新源：弹窗选择 → --registry 参数（优先级最高，不依赖 .npmrc 文件，选哪个走哪个）
    const registryUrl = registry === 'official' ? OFFICIAL_REGISTRY : MIRROR_REGISTRY; // 官方或镜像
    const npmEnv = { ...process.env }; // 复制环境
    delete npmEnv.NODE_TLS_REJECT_UNAUTHORIZED; // 剔除证书豁免变量（防 npm 打印误导性警告）
    let tail = ''; // npm 输出尾部缓冲（失败时显示真实原因）
    let code = null; // 安装退出码（0=成功）
    // 最多两次尝试：第一次卡死自动重试（自愈），第二次仍失败才报错
    for (let attempt = 1; attempt <= 2; attempt++) {
      // 每次尝试前重清：残留 npm 进程 + 旧包目录与锁文件
      // （干净重装策略：增量 REPLACE 在 Windows 会卡死 placeDep，全量 ADD 稳定；
      //  第二次尝试前必须重清——第一次卡死的根因若是文件锁，不重清必然撞同一把锁）
      await killStaleNpmInstalls(); // 清残留进程
      try {
        await rm(join(dir, 'node_modules', '@deepseek-ai'), { recursive: true, force: true }); // 删旧 dsh 全家桶
        await rm(join(dir, 'node_modules', '.package-lock.json'), { force: true }); // 删 npm 内部锁
        await rm(join(dir, 'package-lock.json'), { force: true }); // 删根锁（全量重解析依赖树）
      } catch { /* 删除失败不阻塞（无此文件时忽略） */ }
      currentChild = spawn('npm', ['install', `@deepseek-ai/dsh@${latest}`, '--no-fund', '--no-audit', '--registry', registryUrl], {
        cwd: dir, // 安装目录为工作目录
        env: npmEnv, // 环境（无 TLS 豁免变量）
        shell: true, // Windows npm.cmd 解析
        windowsHide: true // 不弹黑窗
      });
      // 定位本次安装的 npm 调试日志（延迟 3 秒：npm 启动后才创建日志文件；文件名带启动时间戳，排序取最新）
      setTimeout(() => {
        try {
          const files = readdirSync(logsDir).filter((f) => f.endsWith('.log')); // 全部日志文件
          if (files.length) { // 有日志
            logFile = join(logsDir, files.sort().pop()); // 最新一个
            logLastSize = statSync(logFile).size; // 初始大小
            logLastChange = Date.now(); // 初始基准
          }
        } catch { logFile = null; } // 目录异常 → 退回单判据
      }, 3000);
      const feed = (chunk) => { // 处理 npm 输出行：推动进度 + 识别接近完成的行
        const text = chunk.toString('utf8'); // 转字符串
        if (text.trim()) lastOutput = Date.now(); // 有输出即刷新卡住检测基准
        tail = (tail + text).slice(-2000); // 只留尾部 2KB
        for (const line of text.split(/\r?\n/)) { // 逐行
          if (!line.trim()) continue; // 空行跳过
          bump(2); // 每个输出行 +2%（下载/安装过程有输出即前进）
          if (/added\s+\d+|changed\s+\d+|audited\s+\d+|removed\s+\d+/.test(line)) { // 接近完成的行
            percent = Math.max(percent, 92); // 跳到 92%
            showDialog({ phase: 'updating', percent }); // 推送
          }
        }
      };
      currentChild.stdout.on('data', feed); // 监听标准输出
      currentChild.stderr.on('data', feed); // 监听错误输出（npm 进度信息多在 stderr）
      // 等安装结束（10 分钟看门狗；被卡住检测 kill 时 exit code 为 null）
      code = await new Promise((resolve) => {
        const timer = setTimeout(() => { killTree(currentChild.pid); resolve(null); }, 10 * 60_000); // 超时杀进程树
        currentChild.on('exit', (c) => { clearTimeout(timer); resolve(c); }); // 正常/被 kill 退出
      });
      if (code === 0) break; // 成功：跳出尝试循环
      if (attempt === 1) continue; // 第一次失败/卡死（exit 为 null）：自动重试（卡住检测会提前 kill 并提示）
    }
    currentChild = null; // 清引用
    installFinished = true; // 标记结束
    if (code !== 0) { // 两次尝试后仍失败
      setDsh('error', { message: tail.trim() || 'dsh 更新失败' }); // 记错误态（带真实原因）
      showDialog({ phase: 'dsh-error', message: tail.trim() }); // 弹窗提示失败并展示 npm 输出原因（下方附镜像建议）
      // 修复：更新前停了服务、删了包，失败必须尝试拉回服务（入口缺失会进 missing 态引导重新安装，
      // 不能停在 stopped——用户工作台会彻底停摆且无法自助恢复）
      restartServiceFn?.(); // 尝试重启（成功=旧版服务复活；失败=missing 引导，都好过停摆）
      return dshState; // 返回
    }
    setDsh('up-to-date', { current: latest, latest }); // 更新完成
    showDialog({ phase: 'dsh-done', version: latest }); // 弹窗"已更新完成，服务已重启"
    restartServiceFn?.(); // 重启服务让新版本生效（状态推送驱动界面）
    try { // 成功通知
      const n = new Notification({ title: 'dsh 本体已更新', body: `dsh 已更新到 v${latest}，服务已重启` }); // 通知
      n.show(); // 弹出
    } catch { /* 通知失败忽略 */ }
  } finally {
    installFinished = true; // 兜底标记结束
    clearInterval(stuckTimer); // 停止卡住检测（更新结束）
    updatingDsh = false; // 复位
  }
  return dshState; // 返回状态
}

// 弹窗"立即更新"按钮：按弹窗当前组件类型执行对应更新链路
// registry：dsh 更新时用户在弹窗里选的更新源（mirror/official）；不记忆，每次由客户决定
export async function dialogUpdate(registry) {
  if (dialogType === 'app') return downloadUpdate(); // APP → 下载安装包（进度/完成弹窗自动接续）
  if (dialogType === 'dsh') return updateDsh({ registry }); // dsh → npm 更新（按所选源）
  return updaterState; // 无类型（异常）→ 原样返回
}

// 失败页"重试"按钮：用缓存的新版信息重弹确认弹窗（用户重新选源、重新更新）
// 失败后状态是 error，需先恢复 available（updateDsh/downloadUpdate 校验 status 才肯执行）
export async function dialogRetry() {
  if (dialogType === 'app') { // APP 下载失败重试：下载中保留的 url 还在，恢复 available 重弹确认窗
    if (updaterState.info?.url) { // 有下载地址（#14 修复后 downloading 状态保留 url）
      setApp('available'); // 恢复"有新版"状态
      showConfirmDialog('app', 'dsh 桌面端', app.getVersion(), updaterState.info.version, updaterState.info.notes); // 重弹确认弹窗
    }
    return updaterState; // 返回
  }
  if (dialogType !== 'dsh') return updaterState; // 其他类型不支持重试
  if (dshState.latest && dshState.current) { // 有缓存的版本信息
    setDsh('available'); // 恢复"有新版"状态（保留 latest/current/notes 字段）
    showConfirmDialog('dsh', 'dsh 本体', dshState.current, dshState.latest, dshState.notes); // 重弹确认弹窗
  }
  return dshState; // 返回状态
}

// 弹窗"立即重启"按钮：打开已下载的安装包并退出应用（覆盖安装即升级，配置保留）
export async function dialogRestart() {
  const path = updaterState.info?.path; // 已下载安装包路径
  if (path) { // 有路径才操作
    shell.openPath(path); // 打开 NSIS 安装器
    app.quit(); // 退出应用让安装器覆盖文件（stopOnQuit 会按配置处理 dsh 服务）
  } else { // 无路径（异常）
    closeUpdateDialog(); // 直接关弹窗
  }
  return true; // 回报
}

// 创建更新管理器（面板 IPC 用；index.js 注入回调）
export function createUpdater(deps = {}) {
  openPanelFn = deps.openPanel ?? null; // 面板打开回调
  restartServiceFn = deps.restartService ?? null; // 服务重启回调
  stopServiceFn = deps.stopService ?? null; // 服务停止回调（更新前用）
  return {
    silentCheck: () => checkForUpdates({ popup: true, notify: true }), // 启动自动检查 APP（弹窗+通知）
    quietAppCheck: () => checkForUpdates({ popup: false, notify: false }), // 面板打开后台补查 APP（全静默）
    download: downloadUpdate, // 用户确认下载 APP 更新
    silentDshCheck: () => checkDshUpdate({ popup: true, notify: true }), // 启动自动检查 dsh（弹窗+通知）
    quietDshCheck: () => checkDshUpdate({ popup: false, notify: false }), // 面板打开后台补查 dsh（全静默）
    quietCheckAll: () => Promise.all([ // 面板打开全量静默检查（APP+dsh 并行，不弹窗不通知）
      checkForUpdates({ popup: false, notify: false }),
      checkDshUpdate({ popup: false, notify: false })
    ]),
    manualCheckAll: () => Promise.all([ // 面板"检查更新"：APP+dsh 一起查，有新版必弹确认弹窗（与启动弹窗一致）
      checkForUpdates({ popup: 'force', notify: false }),
      checkDshUpdate({ popup: 'force', notify: false })
    ]),
    updateDsh, // 用户确认更新 dsh
    dialogUpdate, // 弹窗"立即更新"
    dialogRetry, // 失败页"重试"
    dialogRestart, // 弹窗"立即重启"
    getState: () => ({ version: app.getVersion(), app: updaterState, dsh: dshState }) // 状态快照
  };
}
