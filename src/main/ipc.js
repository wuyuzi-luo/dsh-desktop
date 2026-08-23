// IPC 注册模块：面板/boot 页与主进程的全部通信入口
// 依赖由 index.js 注入（supervisor/notifier/updater），避免模块间循环引用

import { ipcMain, app, dialog, shell } from 'electron'; // Electron 命名导入（shell 打开外部链接）
import { spawn, exec } from 'node:child_process'; // spawn 跑 pnpm 安装；exec 检测 Node 版本
import { promisify } from 'node:util'; // 把回调 API 转 Promise
import { mkdirSync, existsSync } from 'node:fs'; // 建安装目录 / 判断盘符存在
import { IPC } from '../shared/ipc-channels.js'; // 通道名常量
import { getMainWindow, pushBootState, loadGuide, loadWebUi, pushUpdateDialog, closeUpdateDialog } from './window.js'; // 主窗口操作与 boot 页状态推送 + 更新弹窗
import { loadWorkspaces, openWorkspace } from './workspace.js'; // 工作区
import { listSkills, toggleSkill, installSkill, readSkillContent, listImportableSkills, adoptSkill, deleteSkill } from './skill-manager.js'; // 技能
import { listMcps, addMcp, removeMcp, toggleMcp, listImportableMcps, adoptMcp } from './mcp-manager.js'; // MCP
import { getConfig, setConfig, isValidDshDir, setDshDir } from './config.js'; // 配置读取/写入与 dsh 目录校验
import { applySkin, clearSkin, isValidSkinImage } from './skin.js'; // 皮肤背景注入
import { resolvePnpm, buildPnpmInstallArgs, killTree, ensurePnpmConfig } from './pnpm.js'; // pnpm 命令解析/安装参数/进程树强杀/构建脚本配置

const execP = promisify(exec); // Promise 化 exec（Node 版本检测用）
let installing = false; // 自动安装防重入标志（模块级）

// 检测 Node.js 是否安装且版本达标（dsh 官方要求 ^22.19.0 || >=24.0.0）
async function checkNodeVersion() {
  try {
    const { stdout } = await execP('node -v'); // 取版本串（如 v24.16.0）
    const version = stdout.trim().replace(/^v/, ''); // 去 v 前缀
    const [major = 0, minor = 0] = version.split('.').map(Number); // 解析主次版本
    const ok = major >= 24 || (major === 22 && minor >= 19); // 官方支持范围判断
    return { ok, version }; // 返回结果
  } catch {
    return { ok: false, version: null }; // node 不在 PATH 视为未安装
  }
}

// 组装面板状态快照（面板打开/刷新时拉取一次全量）
export async function buildStateSnapshot(deps) {
  const { supervisor } = deps; // 依赖解构
  // 注意：deps 里注入的是 getUpdater() 延迟取用函数而不是 updater 对象本身
  // （旧代码误写 deps.updater 恒为 undefined → 面板更新状态恒空 → 出现"弹窗说新版、面板报检查失败"的矛盾）
  const updater = deps.getUpdater ? deps.getUpdater() : null; // 延迟取更新器
  const svc = supervisor ? supervisor.getStatus() : { state: 'stopped' }; // 服务状态
  const [workspaces, skills, mcps] = await Promise.all([ // 并行拉取三类列表
    loadWorkspaces(), // 工作区
    listSkills(), // 技能
    listMcps() // MCP
  ]);
  return { // 快照
    service: svc.state, // 服务状态
    url: svc.url || `http://127.0.0.1:${getConfig('port')}`, // 服务地址
    version: app.getVersion(), // 应用版本
    updater: updater ? updater.getState() : { status: 'idle' }, // 更新状态
    skinOpacity: getConfig('skinOpacity'), // 皮肤透明度（面板滑块初始化显示实际值）
    workspaces, // 工作区列表
    skills, // 技能列表
    mcps // MCP 列表
  };
}

// 注册全部 IPC 处理器
export function registerIpc(deps) {
  const { supervisor, notifier } = deps; // 依赖解构

  // 面板拉取全量状态
  ipcMain.handle(IPC.APP_GET_STATE, () => buildStateSnapshot(deps)); // 快照

  // 打开工作区
  ipcMain.handle(IPC.WORKSPACE_OPEN, async (_e, summary) => {
    await openWorkspace(summary); // 执行打开
    return true; // 回报成功
  });

  // 服务重试（boot 页错误态）
  ipcMain.handle(IPC.SERVICE_RETRY, async () => {
    return supervisor ? supervisor.ensureRunning() : 'no-supervisor'; // 重新拉起
  });

  // 引导选择 dsh 安装目录（boot 页 missing 态）：弹目录选择器 → 校验 → 写配置 → 自动重试
  ipcMain.handle(IPC.SETUP_PICK_DSH_DIR, async () => {
    const win = getMainWindow(); // 父窗口
    const result = await dialog.showOpenDialog(win, { // 目录选择对话框
      title: '选择 DeepSeek Harness（dsh）安装目录', // 标题
      message: '请选择包含 node_modules\\@deepseek-ai\\dsh 的安装目录（如 D:\\deepseek-harness）', // 对话框内说明文字
      buttonLabel: '使用此目录', // 确认按钮文案
      properties: ['openDirectory'] // 只选目录
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true }; // 用户取消
    const dir = result.filePaths[0]; // 所选目录
    if (!isValidDshDir(dir)) { // 校验失败：目录里没有 dsh CLI 入口
      return { error: `所选目录中未找到 dsh（缺少 ${dir}\\node_modules\\@deepseek-ai\\dsh）` }; // 带回错误文案
    }
    setDshDir(dir); // 写配置（dshHome 未显式设置时自动跟随 <dir>\home）
    await supervisor?.restart(); // 重新拉起服务（状态推送会驱动 boot 页跳转）
    return { ok: true }; // 回报成功
  });

  // 检测 Node.js（boot 页"我已确认安装 Node.js"按钮）
  ipcMain.handle(IPC.SETUP_CHECK_NODE, () => checkNodeVersion()); // 返回 { ok, version }

  // 自动安装 dsh（boot 页 missing 态"帮我安装"）：Node 检测 → pnpm install → 校验 → 写配置 → 重启
  ipcMain.handle(IPC.SETUP_AUTO_INSTALL, async (_e, opts) => {
    if (installing) return { error: 'busy' }; // 防重复点击
    installing = true; // 置防重入标志
    try {
      return await autoInstallDsh(deps, opts?.registry); // 主流程（registry=安装源选择）
    } finally {
      installing = false; // 复位
    }
  });

  // 服务重启（面板按钮）
  ipcMain.handle(IPC.SERVICE_RESTART, async () => {
    return supervisor ? supervisor.restart() : 'no-supervisor'; // 重启
  });

  // 测试通知
  ipcMain.handle(IPC.NOTIFY_TEST, () => {
    notifier?.test(); // 弹测试通知
    return true;
  });

  // 打开工作台（显示主窗口）
  ipcMain.handle(IPC.APP_OPEN_WEB_UI, () => {
    const win = getMainWindow(); // 主窗口
    if (win) { win.show(); win.restore(); win.focus(); } // 显示聚焦
    return true;
  });

  // 引导页"进入工作台"：记录已读版本并切到 dsh Web UI
  ipcMain.handle(IPC.GUIDE_ENTER, () => {
    setConfig('guideSeenVersion', app.getVersion()); // 标记当前版本引导已读（下次启动不再弹）
    const win = getMainWindow(); // 主窗口
    const url = supervisor?.getStatus().url || `http://127.0.0.1:${getConfig('port')}`; // 服务地址（优先就绪行解析出的）
    loadWebUi(win, url); // 切到 Web UI
    return true;
  });

  // 面板"使用说明"按钮：主窗口重新打开引导页
  ipcMain.handle(IPC.GUIDE_OPEN, () => {
    const win = getMainWindow(); // 主窗口
    if (win) { win.show(); win.restore(); win.focus(); loadGuide(win); } // 显示并加载引导页
    return true;
  });

  // 用默认浏览器打开外部链接（仅允许 http/https，防协议注入）
  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_e, url) => {
    const target = String(url ?? ''); // 目标地址
    if (!/^https?:\/\//i.test(target)) return false; // 只放行网页链接
    await shell.openExternal(target); // 打开默认浏览器
    return true;
  });

  // 设置皮肤：弹图片选择器 → 校验 → 存配置 → 立即注入主窗口
  ipcMain.handle(IPC.SKIN_SET, async () => {
    const win = getMainWindow(); // 父窗口
    const result = await dialog.showOpenDialog(win, { // 图片选择对话框
      title: '选择皮肤背景图片', // 标题
      buttonLabel: '应用这张图', // 确认按钮
      properties: ['openFile'], // 只选文件
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] // 图片过滤
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true }; // 用户取消
    const imagePath = result.filePaths[0]; // 所选图片
    if (!isValidSkinImage(imagePath)) return { error: '图片格式不支持（支持 png/jpg/jpeg/webp/gif/bmp）' }; // 校验失败
    try {
      setConfig('skinImage', imagePath); // 持久化皮肤路径
      await applySkin(win); // 立即应用（压缩后注入 dsh 工作台）
    } catch (err) { // 读图/压缩/注入失败
      setConfig('skinImage', ''); // 回滚配置
      return { error: String(err?.message ?? err) }; // 把原因带回面板
    }
    return { ok: true, path: imagePath }; // 回报
  });

  // 恢复默认背景
  ipcMain.handle(IPC.SKIN_CLEAR, async () => {
    setConfig('skinImage', ''); // 清空皮肤配置
    await clearSkin(getMainWindow()); // 删除注入标签（立即生效）
    return { ok: true };
  });

  // 调节皮肤透明度（0~100）：存配置并实时重注入
  ipcMain.handle(IPC.SKIN_OPACITY, async (_e, value) => {
    const v = Math.min(100, Math.max(0, Number(value) || 100)); // 夹取 0~100
    setConfig('skinOpacity', v); // 持久化
    await applySkin(getMainWindow()); // 实时重注入（幂等替换 style 标签）
    return { ok: true, opacity: v };
  });

  // —— Skills ——
  ipcMain.handle(IPC.SKILLS_LIST, () => listSkills()); // 列表
  ipcMain.handle(IPC.SKILL_TOGGLE, async (_e, { id, enabled }) => { // 开关
    await toggleSkill(id, enabled); // 移动目录
    return listSkills(); // 返回最新列表
  });
  ipcMain.handle(IPC.SKILL_DELETE, async (_e, id) => { // 删除技能（确认后执行，防误触）
    const win = getMainWindow(); // 父窗口
    const r = await dialog.showMessageBox(win, { // 确认对话框
      type: 'warning', // 警示图标
      title: '删除技能', // 标题
      message: '确定删除这个技能吗？', // 主文案
      detail: '技能目录将被永久删除，不可恢复', // 说明
      buttons: ['删除', '取消'], // 按钮（删除在前便于 Enter 确认，但默认焦点给取消防手滑）
      defaultId: 1, // 默认焦点：取消
      cancelId: 1 // Esc = 取消
    });
    if (r.response !== 0) return { canceled: true }; // 用户取消
    try {
      await deleteSkill(id); // 删除（仅限自家安装目录，外部目录报错）
      return listSkills(); // 返回最新列表
    } catch (err) { // 删除失败（如外部目录技能）
      return { error: String(err?.message ?? err) }; // 错误带回面板提示
    }
  });
  ipcMain.handle(IPC.SKILL_INSTALL, async (_e, opts) => { // 安装（zip 文件或技能文件夹）
    const win = getMainWindow(); // 父窗口
    const isDir = opts?.mode === 'dir'; // 文件夹模式
    const result = await dialog.showOpenDialog(win, { // 选择对话框
      title: isDir ? '选择技能文件夹' : '选择技能 zip 压缩包', // 标题
      // openFile 与 openDirectory 必须二选一：Windows 上两者组合 = 纯文件夹模式，文件被隐藏
      //（用户实测"选择文件时检测不到 zip"的根因；拆成面板上两个按钮分别调用）
      properties: isDir ? ['openDirectory'] : ['openFile'], // 文件夹 / 文件
      ...(isDir ? {} : { filters: [{ name: '技能包', extensions: ['zip'] }] }) // 文件模式才加 zip 过滤
    });
    if (result.canceled || !result.filePaths.length) return null; // 取消
    try { // 安装（zip 内部解压）
      await installSkill(result.filePaths[0]); // 复制/解压安装
      return listSkills(); // 返回最新列表
    } catch (err) { // 安装失败
      return { error: String(err?.message ?? err) }; // 把错误带回面板展示
    }
  });
  ipcMain.handle('skills:content', async (_e, id) => readSkillContent(id)); // 展开正文（临时通道）
  ipcMain.handle(IPC.SKILLS_IMPORT, () => listImportableSkills()); // 扫描可自动导入的技能
  ipcMain.handle(IPC.SKILLS_ADOPT, async (_e, external) => { // 导入搜索到的技能
    await adoptSkill(external); // 复制进扫描根
    return listSkills(); // 返回最新列表
  });

  // —— MCP ——
  ipcMain.handle(IPC.MCP_LIST, () => listMcps()); // 列表
  ipcMain.handle(IPC.MCP_TOGGLE, async (_e, { serverName, enabled }) => { // 开关
    await toggleMcp(serverName, enabled); // 同步 patch（HMR 生效）
    return listMcps(); // 返回最新列表
  });
  ipcMain.handle(IPC.MCP_ADD, async (_e, def) => { // 添加
    await addMcp(def); // 存配置 + 同步
    return listMcps(); // 返回最新列表
  });
  ipcMain.handle(IPC.MCP_REMOVE, async (_e, serverName) => { // 删除（确认后执行，防误触——此前点 ✕ 即删）
    const win = getMainWindow(); // 父窗口
    const r = await dialog.showMessageBox(win, { // 确认对话框
      type: 'warning', // 警示图标
      title: '删除 MCP', // 标题
      message: `确定删除 MCP「${serverName}」吗？`, // 主文案
      detail: '配置将从应用与 dsh 的 cordis.patch.yml 中移除', // 说明
      buttons: ['删除', '取消'], // 按钮
      defaultId: 1, // 默认焦点：取消
      cancelId: 1 // Esc = 取消
    });
    if (r.response !== 0) return { canceled: true }; // 用户取消
    await removeMcp(serverName); // 移除 + 同步
    return listMcps(); // 返回最新列表
  });
  ipcMain.handle(IPC.MCP_IMPORT, () => listImportableMcps()); // 扫描可导入的外部 MCP
  ipcMain.handle(IPC.MCP_ADOPT, async (_e, external) => { // 收编外部 MCP
    await adoptMcp(external); // 收编 + 同步
    return listMcps(); // 返回最新列表
  });

  // —— 更新 ——
  ipcMain.handle(IPC.UPDATER_CHECK, async () => { // 面板"检查更新"（APP 与 dsh 本体一起查，有新版必弹确认弹窗）
    const updater = deps.getUpdater ? deps.getUpdater() : null; // 延迟取引用（注册早于创建）
    if (!updater) return { status: 'idle' }; // 无更新器
    await updater.manualCheckAll(); // 并行检查两者（有新版弹窗排队）
    return updater.getState(); // 返回完整快照
  });
  ipcMain.handle(IPC.UPDATER_DOWNLOAD, async () => { // 用户确认下载 APP 更新
    const updater = deps.getUpdater ? deps.getUpdater() : null; // 延迟取引用
    return updater ? updater.download() : { status: 'idle' }; // 下载并返回
  });
  ipcMain.handle(IPC.UPDATER_DSH_UPDATE, async () => { // 用户确认更新 dsh 本体
    const updater = deps.getUpdater ? deps.getUpdater() : null; // 延迟取引用
    return updater ? updater.updateDsh() : { status: 'idle' }; // 更新并返回
  });
  ipcMain.handle(IPC.UPDATER_QUIET_CHECK_ALL, async () => { // 面板打开时全量静默检查（APP+dsh，不弹窗不通知）
    const updater = deps.getUpdater ? deps.getUpdater() : null; // 延迟取引用
    if (!updater) return { status: 'idle' }; // 无更新器
    await updater.quietCheckAll(); // 并行静默检查
    return updater.getState(); // 返回最新快照
  });

  // 更新弹窗按钮动作：update=立即更新 / later=暂不更新 / restart=立即重启 / done=关闭
  ipcMain.handle(IPC.UPDATE_DIALOG_ACTION, async (_e, action, extra) => {
    const updater = deps.getUpdater ? deps.getUpdater() : null; // 延迟取引用
    if (action === 'update') { // 立即更新：按弹窗组件类型执行下载/pnpm 更新（extra.registry=dsh 更新源选择）
      return updater ? updater.dialogUpdate(extra?.registry) : null; // 更新链路内部自动接续进度/完成弹窗
    }
    if (action === 'later') { // 暂不更新：弹窗切告知页
      pushUpdateDialog({ phase: 'deferred' }); // 告知可在控制面板更新
      return true;
    }
    if (action === 'retry') { // 失败页重试：用缓存信息重弹确认弹窗
      return updater ? updater.dialogRetry() : null; // 主进程处理
    }
    if (action === 'restart') { // 立即重启：打开安装包并退出应用
      return updater ? updater.dialogRestart() : null; // 主进程处理
    }
    closeUpdateDialog(); // done：关闭弹窗
    return true;
  });

  // 通用消息框（面板手动检查后告知"各组件最新情况"）
  // title=主文案（粗体，如"暂无新版本"）；message=详细内容（多行左对齐，如版本情况）
  ipcMain.handle(IPC.MISC_SHOW_MESSAGE, async (_e, { title, message }) => {
    const win = getMainWindow(); // 父窗口（面板在时作为模态父窗）
    await dialog.showMessageBox(win, { // 系统消息框
      type: 'info', // 信息图标
      title: String(title ?? '提示'), // 窗口标题
      message: String(title ?? '提示'), // 主文案（粗体）
      detail: String(message ?? ''), // 详细内容（多行，左对齐）
      buttons: ['知道了'] // 单按钮
    });
    return true;
  });
}

// 自动安装 dsh 主流程（独立函数：逻辑长，与注册代码分开）
// registry：'mirror'=国内镜像（默认） / 'official'=官方源（boot 页用户自选，--registry 参数生效）
async function autoInstallDsh(deps, registry) {
  const { supervisor } = deps; // 依赖解构（重启服务用）
  const win = getMainWindow(); // boot 页窗口
  const push = (phase, text) => pushBootState(win, { type: 'setup', phase, text }); // 进度推送便捷函数

  // 1. 检测 Node.js（dsh 官方要求 ^22.19.0 || >=24.0.0）
  const node = await checkNodeVersion(); // 复用统一检测函数
  if (!node.ok) { // Node 缺失或版本不足
    push('error', '未检测到可用的 Node.js（需要 22.19+ 或 24+）。请先安装 Node.js 后点击重试'); // 引导文案
    return { error: 'need-node' }; // 返回错误码（boot 页展示）
  }

  // 2. 确定安装目录：D 盘存在用 D:\deepseek-harness；否则用用户目录（C 盘根目录建目录需要管理员权限）
  const target = existsSync('D:\\') ? 'D:\\deepseek-harness' : `${process.env.USERPROFILE}\\deepseek-harness`;
  try {
    mkdirSync(target, { recursive: true }); // 先建目录
  } catch {
    push('error', `无法创建安装目录 ${target}，请改用"选择已安装目录"`); // 建目录失败提示
    return { error: 'mkdir-failed' }; // 返回错误
  }

  push('start', `正在安装 dsh 到 ${target}，需要几分钟，请保持网络畅通…`); // 开始提示
  await ensurePnpmConfig(target); // 确保 pnpm 构建脚本白名单存在（原生模块 node-pty/koffi 需要）

  // 3. 安装前清理残留安装进程：上次安装失败/中断残留的 npm/pnpm 会锁文件，导致重装卡死
  //（与更新逻辑同一策略：只杀本项目的 dsh 安装进程，不误伤其他项目的安装任务）
  await new Promise((resolve) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command', // PowerShell 精准过滤
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*deepseek-ai/dsh*' -and ($_.CommandLine -like '*npm-cli*install*' -or $_.CommandLine -like '*pnpm*install*' -or $_.CommandLine -like '*npx*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], {
      shell: false, // 直接调 powershell
      windowsHide: true // 不弹黑窗
    });
    ps.on('exit', () => resolve()); // 执行完即返回
    setTimeout(() => { try { ps.kill(); } catch { /* 忽略 */ } resolve(); }, 30000); // 30 秒兜底（PowerShell 冷启动慢）
  });

  // 4. pnpm install（shell:true 保证 Windows 下 pnpm.cmd 可解析；windowsHide 不弹黑窗）
  // 为什么不用 npm：npm(arborist) 全量解析 dsh 依赖树必死循环/内存爆炸（实测），pnpm 90 秒装完
  // --registry 按用户所选源（boot 页自选；默认镜像：首次安装 200+ 包，镜像实测比官方源快 6 倍且稳定）
  const registryUrl = registry === 'official' ? 'https://registry.npmjs.org' : 'https://registry.npmmirror.com'; // 官方或镜像
  const npmEnv = { ...process.env }; // 复制环境
  delete npmEnv.NODE_TLS_REJECT_UNAUTHORIZED; // 剔除证书豁免变量（防安装器打印误导性警告）
  npmEnv.npm_config_registry = registryUrl; // npx 拉取 pnpm 本体时也走所选源（国内网络下 npx 走官方源会卡）
  const pnpmPrefix = await resolvePnpm(); // pnpm 启动命令：['pnpm'] 或 ['npx','-y','pnpm@11']
  const child = spawn(pnpmPrefix[0], [...pnpmPrefix.slice(1), ...buildPnpmInstallArgs('@deepseek-ai/dsh', registryUrl)], {
    cwd: target, // 安装到目标目录
    env: npmEnv, // 环境（无 TLS 豁免变量）
    shell: true, // Windows 批处理包装
    windowsHide: true // 隐藏控制台窗口
  });
  let tail = ''; // 输出尾部缓冲（失败时诊断展示）
  const feed = (chunk) => { // 统一处理 stdout/stderr 数据块
    const text = chunk.toString('utf8'); // 转字符串
    tail = (tail + text).slice(-8192); // 只留尾部 8KB
    for (const line of text.split(/\r?\n/)) { // 逐行推送进度
      if (line.trim()) push('line', line.trim()); // 非空行才推
    }
  };
  child.stdout.on('data', feed); // 转发标准输出
  child.stderr.on('data', feed); // 转发错误输出

  // 等安装结束（30 分钟看门狗防网络挂起；pnpm 实测约 2 分钟）
  // 超时杀整棵进程树：shell:true 下 child 是 cmd 壳，只杀壳会留下安装进程孤儿继续锁文件
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { // 超时
      killTree(child.pid); // 杀进程树
      resolve(null); // 视为失败
    }, 30 * 60_000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); }); // 正常退出
  });
  if (code !== 0) { // 安装失败（含看门狗超时）
    push('error', '安装失败，请检查网络后重试'); // 失败提示
    return { error: 'install-failed', log: tail.slice(-2000) }; // 带回尾部日志供 boot 页展示
  }

  // 4. 校验安装结果（pnpm 成功但入口缺失的极端情况兜底）
  if (!isValidDshDir(target)) { // 目录里没有 dsh CLI 入口
    push('error', '安装完成但未找到 dsh 入口，请改用"选择已安装目录"'); // 提示改用手动选择
    return { error: 'invalid' }; // 返回错误
  }
  setDshDir(target); // 写配置（dshHome 未显式设置时自动跟随 <dir>\home）

  // 5. 自动重启服务（状态推送驱动 boot 页跳转 Web UI）
  push('done', 'dsh 安装完成，正在启动服务…'); // 完成提示
  await supervisor?.restart(); // 重新拉起
  return { ok: true, dir: target }; // 回报成功与安装位置
}
