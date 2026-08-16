// 预加载脚本（CommonJS 版）：sandbox 开启时 preload 不支持 ESM import，
// 因此通道名在此内联定义，经 contextBridge 安全暴露给 boot 页与面板页

const { contextBridge, ipcRenderer } = require('electron'); // 桥与渲染 IPC

// IPC 通道名（与主进程 src/shared/ipc-channels.js 保持一致，此处内联避免 ESM 依赖）
const IPC = {
  APP_GET_STATE: 'app:get-state', // 拉全量快照
  APP_STATE: 'app:state', // 主进程推送
  WORKSPACE_OPEN: 'workspace:open', // 打开工作区
  SERVICE_RETRY: 'service:retry', // 服务重试
  SETUP_PICK_DSH_DIR: 'setup:pick-dsh-dir', // 选择 dsh 安装目录
  SETUP_AUTO_INSTALL: 'setup:auto-install', // 自动安装 dsh
  SETUP_CHECK_NODE: 'setup:check-node', // 检测 Node.js
  GUIDE_ENTER: 'guide:enter', // 引导页进入工作台
  GUIDE_OPEN: 'guide:open', // 打开使用说明
  OPEN_EXTERNAL: 'app:open-external', // 打开外部链接
  SKIN_SET: 'skin:set', // 设置皮肤
  SKIN_CLEAR: 'skin:clear', // 恢复默认背景
  SKIN_OPACITY: 'skin:opacity', // 调节皮肤透明度
  NOTIFY_TEST: 'notify:test', // 测试通知
  APP_OPEN_WEB_UI: 'app:open-web-ui', // 打开工作台
  SERVICE_RESTART: 'service:restart', // 重启服务
  SKILLS_LIST: 'skills:list', // 技能列表
  SKILL_TOGGLE: 'skills:toggle', // 技能开关
  SKILL_INSTALL: 'skills:install', // 安装技能
  SKILLS_IMPORT: 'skills:import', // 扫描可导入技能
  SKILLS_ADOPT: 'skills:adopt', // 导入技能
  MCP_LIST: 'mcp:list', // MCP 列表
  MCP_TOGGLE: 'mcp:toggle', // MCP 开关
  MCP_ADD: 'mcp:add', // 添加 MCP
  MCP_REMOVE: 'mcp:remove', // 删除 MCP
  MCP_IMPORT: 'mcp:import', // 扫描可导入外部 MCP
  MCP_ADOPT: 'mcp:adopt', // 收编外部 MCP
  UPDATER_CHECK: 'updater:check', // 检查更新
  UPDATER_DOWNLOAD: 'updater:download', // 确认下载 APP 更新
  UPDATER_DSH_UPDATE: 'updater:dsh-update' // 确认更新 dsh
};

// 暴露给页面的 dshDesktop API（面板与 boot 页共用）
contextBridge.exposeInMainWorld('dshDesktop', {
  // 拉取全量状态快照
  getState: () => ipcRenderer.invoke(IPC.APP_GET_STATE),
  // 订阅主进程推送（返回退订函数）
  onState: (cb) => {
    const listener = (_e, payload) => cb(payload); // 包装
    ipcRenderer.on(IPC.APP_STATE, listener); // 注册
    return () => ipcRenderer.off(IPC.APP_STATE, listener); // 退订
  },
  // 打开工作区
  openWorkspace: (summary) => ipcRenderer.invoke(IPC.WORKSPACE_OPEN, summary),
  // 服务重试
  retryService: () => ipcRenderer.invoke(IPC.SERVICE_RETRY),
  // 选择 dsh 安装目录（boot 页 missing 态引导）
  pickDshDir: () => ipcRenderer.invoke(IPC.SETUP_PICK_DSH_DIR),
  // 自动安装 dsh（boot 页 missing 态"帮我安装"）
  autoInstallDsh: () => ipcRenderer.invoke(IPC.SETUP_AUTO_INSTALL),
  // 检测 Node.js 是否安装且版本达标
  checkNode: () => ipcRenderer.invoke(IPC.SETUP_CHECK_NODE),
  // 引导页"进入工作台"
  enterWorkbench: () => ipcRenderer.invoke(IPC.GUIDE_ENTER),
  // 打开使用说明引导页
  openGuide: () => ipcRenderer.invoke(IPC.GUIDE_OPEN),
  // 用默认浏览器打开外部链接
  openExternal: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  // 设置皮肤（弹图片选择器）
  setSkin: () => ipcRenderer.invoke(IPC.SKIN_SET),
  // 恢复默认背景
  clearSkin: () => ipcRenderer.invoke(IPC.SKIN_CLEAR),
  // 调节皮肤透明度（0~100 实时生效）
  setSkinOpacity: (value) => ipcRenderer.invoke(IPC.SKIN_OPACITY, value),
  // 服务重启
  restartService: () => ipcRenderer.invoke(IPC.SERVICE_RESTART),
  // 测试通知
  testNotify: () => ipcRenderer.invoke(IPC.NOTIFY_TEST),
  // 打开工作台
  openWebUi: () => ipcRenderer.invoke(IPC.APP_OPEN_WEB_UI),
  // —— Skills ——
  listSkills: () => ipcRenderer.invoke(IPC.SKILLS_LIST), // 列表
  toggleSkill: (id, enabled) => ipcRenderer.invoke(IPC.SKILL_TOGGLE, { id, enabled }), // 开关
  installSkill: () => ipcRenderer.invoke(IPC.SKILL_INSTALL), // 安装
  importSkillsList: () => ipcRenderer.invoke(IPC.SKILLS_IMPORT), // 可导入列表
  adoptSkill: (external) => ipcRenderer.invoke(IPC.SKILLS_ADOPT, external), // 导入
  skillContent: (id) => ipcRenderer.invoke('skills:content', id), // 正文
  // —— MCP ——
  listMcps: () => ipcRenderer.invoke(IPC.MCP_LIST), // 列表
  toggleMcp: (serverName, enabled) => ipcRenderer.invoke(IPC.MCP_TOGGLE, { serverName, enabled }), // 开关
  addMcp: (def) => ipcRenderer.invoke(IPC.MCP_ADD, def), // 添加
  removeMcp: (serverName) => ipcRenderer.invoke(IPC.MCP_REMOVE, serverName), // 删除
  listImportableMcps: () => ipcRenderer.invoke(IPC.MCP_IMPORT), // 可导入列表
  adoptMcp: (external) => ipcRenderer.invoke(IPC.MCP_ADOPT, external), // 收编
  // —— 更新 ——
  checkUpdate: () => ipcRenderer.invoke(IPC.UPDATER_CHECK), // 检查（APP + dsh）
  downloadUpdate: () => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD), // 确认下载 APP 更新
  updateDsh: () => ipcRenderer.invoke(IPC.UPDATER_DSH_UPDATE) // 确认更新 dsh
});
