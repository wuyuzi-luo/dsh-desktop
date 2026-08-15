// 主进程入口：生命周期编排（AUMID → 单实例锁 → 窗口 → 服务托管 → SSE → 托盘 → IPC）
// 参考 anywhere-labs main.ts 的职责划分：托管、生命周期、窗口三者分离

import { app, globalShortcut, Notification } from 'electron'; // Electron 命名导入（已验证在真主进程可用）
import { createHostSupervisor } from './host-supervisor.js'; // 服务托管
import { createEventBridge } from './event-bridge.js'; // SSE 事件桥
import { createNotifier } from './notifications.js'; // 桌面通知
import { createMainWindow, getMainWindow, loadWebUi, pushBootState, createPanelWindow, pushPanelUpdate } from './window.js'; // 窗口
import { createTray, destroyTray } from './tray.js'; // 托盘
import { registerIpc, buildStateSnapshot } from './ipc.js'; // IPC 与状态快照
import { initMcpManager } from './mcp-manager.js'; // MCP 同步
import { createUpdater } from './updater.js'; // 更新器
import { getConfig } from './config.js'; // 配置

// Windows 通知必须的应用标识（最早执行）
app.setAppUserModelId('com.dshdesktop.app');

// 单实例锁：二次启动不新开进程，聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit(); // 拿不到锁直接退出
} else {
  // 二次启动事件 → 显示已有主窗口
  app.on('second-instance', () => {
    const win = getMainWindow(); // 已有窗口
    if (win) { win.show(); win.restore(); win.focus(); } // 显示并聚焦
  });

  // 各模块实例（app.whenReady 后初始化）
  let supervisor = null; // 服务托管器
  let bridge = null; // SSE 桥
  let notifier = null; // 通知器
  let updater = null; // 更新器
  let quitting = false; // 显式退出标志（区分关窗与退出）

  // 刷新托盘（服务状态变化时）
  function refreshTray() {
    if (!supervisor) return; // 未初始化
    const { state } = supervisor.getStatus(); // 当前状态
    createTray({ // 重建托盘图标与菜单
      state, // 状态色
      onShow: showMain, // 显示主窗口
      onQuit: quitApp, // 完整退出
      onOpenPanel: openPanel, // 打开面板
      workspaces: lastWorkspaces, // 最近一次工作区列表
      onOpenWorkspace: async (ws) => { // 打开工作区
        const { openWorkspace } = await import('./workspace.js'); // 懒加载避免循环
        if (ws && ws.path) openWorkspace(ws); // 执行打开
      }
    });
  }

  // 显示主窗口
  function showMain() {
    const win = getMainWindow() || createMainWindow(); // 获取或创建
    win.show(); // 显示
    win.restore(); // 还原
    win.focus(); // 聚焦
  }

  // 打开面板
  function openPanel() {
    createPanelWindow(); // 面板内容由 IPC 拉取
  }

  // 完整退出：停服务 → 销毁托盘 → 退出
  async function quitApp() {
    if (quitting) return; // 防重入
    quitting = true; // 置标志
    if (bridge) bridge.stop(); // 停 SSE
    if (supervisor && getConfig('stopOnQuit')) await supervisor.stop(); // 停自己托管的服务
    destroyTray(); // 清托盘
    app.quit(); // 退出应用
  }

  let lastWorkspaces = []; // 缓存的工作区列表（托盘菜单用）

  // 应用就绪后的初始化编排
  app.whenReady().then(async () => {
    // 1. 主窗口（先显示 boot 过渡页）
    const win = createMainWindow(); // 创建（内部已加载 boot.html）
    // 关窗 = 隐藏到托盘（显式退出才真关）；首次隐藏弹提示消除"以为退了"的困惑
    let hideHintShown = false; // 首次提示标记（会话内）
    win.on('close', (e) => { // 拦截关闭
      if (quitting) return; // 显式退出中 → 放行
      e.preventDefault(); // 阻止默认关闭
      win.hide(); // 隐藏到托盘
      if (!hideHintShown) { // 第一次隐藏
        hideHintShown = true; // 标记
        try { // 弹提示：消除"关窗以为退了"的困惑
          const n = new Notification({ title: 'dsh 桌面仍在后台运行', body: '窗口已最小化到系统托盘，右键鲸鱼图标可退出', silent: false }); // 提示内容
          n.show(); // 弹出
        } catch { /* 通知失败忽略 */ }
      }
    });

    // 2. 服务托管
    supervisor = createHostSupervisor(); // 建托管器
    notifier = createNotifier({ getMainWindow }); // 提前建通知器（IPC 注册需要引用）
    registerIpc({ supervisor, notifier, getUpdater: () => updater }); // 提前注册 IPC：boot/面板页加载快于服务启动，先注册防 "No handler registered"（updater 用 getter 延迟取）
    supervisor.onStatus(async (state) => { // 状态变化
      pushBootState(win, { type: 'service', state, url: supervisor.getStatus().url }); // 推给 boot 页（带服务地址，boot 页可自行跳转）
      pushPanelUpdate({ type: 'service', state }); // 推给面板
      refreshTray(); // 刷新托盘
      if (state === 'running' && !win.webContents.getURL().startsWith('http')) { // 就绪且还没进 Web UI（getURL 为空也算：boot 页导航未完成时不误判）
        loadWebUi(win, `http://127.0.0.1:${getConfig('port')}`); // 切到 dsh Web UI
      }
      if (state === 'error') { // 启动失败
        notifier?.onServiceError(supervisor.getStderrTail().slice(-200)); // 通知（含诊断尾部）
      }
    });
    const result = await supervisor.ensureRunning(); // 确保服务（复用或新起）
    supervisor.startHeartbeat(() => { // 心跳：服务意外死亡时通知
      notifier?.onServiceError('dsh 服务意外停止，可在控制面板点击重启'); // 弹通知
    });

    // 3. SSE 事件桥 + 通知
    bridge = createEventBridge(); // 建桥
    bridge.on('turn-started', notifier.onTurnStart); // 回合开始
    bridge.on('turn-completed', notifier.onTurnCompleted); // 回合完成 → 通知
    bridge.on('approval-requested', notifier.onApprovalRequested); // 审批 → 通知
    bridge.on('question-requested', notifier.onQuestionRequested); // 提问 → 通知
    bridge.on('agent-error', notifier.onAgentError); // 任务出错 → 通知
    bridge.start().catch(() => { /* SSE 失败已由内部重连处理 */ }); // 启动桥（异步不阻塞）

    // 4. 工作区快照
    const { loadWorkspaces } = await import('./workspace.js'); // 懒加载
    lastWorkspaces = await loadWorkspaces(); // 初始列表

    // 5. 托盘 + 面板
    refreshTray(); // 建托盘
    globalShortcut.register('Control+Shift+D', openPanel); // Ctrl+Shift+D 呼出面板

    // 6. MCP 同步（把应用配置里的启用项写进 cordis.patch.yml）
    await initMcpManager(); // 同步一次

    // 7. 更新器（启动静默检查）
    updater = createUpdater(); // 建更新器
    if (app.isPackaged) updater.silentCheck(); // 打包版才静默检查（dev 模式跳过避免噪音）
  });

  // 全部窗口关闭：不退出（关窗 = 隐藏到托盘；托盘"退出"才真退出）
  app.on('window-all-closed', () => { /* 什么都不做：保持托盘常驻 */ });

  // 退出前的清理
  app.on('before-quit', () => {
    if (bridge) bridge.stop(); // 停 SSE
  });
}
