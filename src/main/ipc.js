// IPC 注册模块：面板/boot 页与主进程的全部通信入口
// 依赖由 index.js 注入（supervisor/notifier/updater），避免模块间循环引用

import { ipcMain, app, dialog } from 'electron'; // Electron 命名导入（已验证在真主进程可用）
import { IPC } from '../shared/ipc-channels.js'; // 通道名常量
import { getMainWindow } from './window.js'; // 主窗口
import { loadWorkspaces, openWorkspace } from './workspace.js'; // 工作区
import { listSkills, toggleSkill, installSkill, readSkillContent } from './skill-manager.js'; // 技能
import { listMcps, addMcp, removeMcp, toggleMcp, listImportableMcps, adoptMcp } from './mcp-manager.js'; // MCP
import { getConfig } from './config.js'; // 配置

// 组装面板状态快照（面板打开/刷新时拉取一次全量）
export async function buildStateSnapshot(deps) {
  const { supervisor, updater } = deps; // 依赖解构
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

  // —— Skills ——
  ipcMain.handle(IPC.SKILLS_LIST, () => listSkills()); // 列表
  ipcMain.handle(IPC.SKILL_TOGGLE, async (_e, { id, enabled }) => { // 开关
    await toggleSkill(id, enabled); // 移动目录
    return listSkills(); // 返回最新列表
  });
  ipcMain.handle(IPC.SKILL_INSTALL, async () => { // 安装（选目录对话框）
    const win = getMainWindow(); // 父窗口
    const result = await dialog.showOpenDialog(win, { // 目录选择
      title: '选择技能文件夹', // 标题
      properties: ['openDirectory'] // 只选目录
    });
    if (result.canceled || !result.filePaths.length) return null; // 取消
    await installSkill(result.filePaths[0]); // 复制安装
    return listSkills(); // 返回最新列表
  });
  ipcMain.handle('skills:content', async (_e, id) => readSkillContent(id)); // 展开正文（临时通道）

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
  ipcMain.handle(IPC.MCP_REMOVE, async (_e, serverName) => { // 删除
    await removeMcp(serverName); // 移除 + 同步
    return listMcps(); // 返回最新列表
  });
  ipcMain.handle(IPC.MCP_IMPORT, () => listImportableMcps()); // 扫描可导入的外部 MCP
  ipcMain.handle(IPC.MCP_ADOPT, async (_e, external) => { // 收编外部 MCP
    await adoptMcp(external); // 收编 + 同步
    return listMcps(); // 返回最新列表
  });

  // —— 更新 ——
  ipcMain.handle(IPC.UPDATER_CHECK, async () => { // 手动检查
    const updater = deps.getUpdater ? deps.getUpdater() : null; // 延迟取引用（注册早于创建）
    return updater ? updater.manualCheck() : { status: 'idle' }; // 检查并返回
  });
}
