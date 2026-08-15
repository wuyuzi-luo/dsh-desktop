// 窗口模块：主窗口（boot 过渡页 → dsh Web UI）+ 面板窗口（三 Tab 管理界面）

import { BrowserWindow } from 'electron'; // Electron 命名导入（已验证在真主进程可用）
import { fileURLToPath } from 'node:url'; // ESM 下转文件路径
import { dirname, join } from 'node:path'; // 路径拼接
import { IPC } from '../shared/ipc-channels.js'; // IPC 通道名
import { existsSync } from 'node:fs'; // 存在性检查

// 渲染层目录的绝对路径（boot/panel 页面都在这里）
const RENDERER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
// 预加载脚本绝对路径（.cjs：sandbox 预加载只支持 CommonJS）
const PRELOAD_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'preload', 'index.cjs');
// 应用图标（build/icon.ico，dev 与打包共用；由 npm run icons 生成）
const ICON_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.ico'); // src/assets 下（随包分发）

let mainWindow = null; // 主窗口单例
let panelWindow = null; // 面板窗口单例

// 创建主窗口（启动时加载本地 boot.html；服务就绪后切到 dsh Web UI）
export function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow; // 已存在直接返回
  mainWindow = new BrowserWindow({ // 新建
    width: 1440, // 宽
    height: 920, // 高
    minWidth: 800, // 最小宽
    minHeight: 600, // 最小高
    show: false, // 先隐藏，ready-to-show 再显示（防白屏闪烁）
    autoHideMenuBar: true, // 隐藏菜单栏（干净窗口）
    backgroundColor: '#0d1226', // 深蓝底色（加载间隙不闪白）
    icon: existsSync(ICON_PATH) ? ICON_PATH : undefined, // 窗口/任务栏图标（官方 DeepSeek 鲸鱼；未生成时跳过）
    webPreferences: { // 页面安全基线
      preload: PRELOAD_PATH, // 注入预加载脚本
      contextIsolation: true, // 上下文隔离（安全）
      nodeIntegration: false, // 页面禁用 Node（安全）
      sandbox: true // 沙箱（安全）
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show()); // 就绪后显示
  // 加载本地启动页
  mainWindow.loadFile(join(RENDERER_DIR, 'boot.html')); // boot 过渡页
  return mainWindow; // 返回
}

// 获取主窗口（通知/托盘等模块用，可能为空）
export function getMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow; // 有效则返回
  return null; // 否则空
}

// 主窗口加载 dsh Web UI（服务就绪后调用）
export function loadWebUi(window, url) {
  if (window && !window.isDestroyed()) window.loadURL(url); // 切换加载
}

// 向主窗口的 boot 页推送服务状态文案（启动中/就绪/错误）
export function pushBootState(window, payload) {
  if (window && !window.isDestroyed()) { // 窗口有效
    window.webContents.send(IPC.APP_STATE, payload); // 推送状态
  }
}

// 创建面板窗口（Ctrl+Shift+D 呼出；frameless 小窗，三 Tab 结构）
export function createPanelWindow(getStateSnapshot, handle) {
  if (panelWindow && !panelWindow.isDestroyed()) { // 已存在 → 聚焦
    panelWindow.show(); // 显示
    panelWindow.focus(); // 聚焦
    return panelWindow; // 返回
  }
  panelWindow = new BrowserWindow({ // 新建面板
    width: 400, // 宽
    height: 560, // 高
    show: false, // 先隐藏
    frame: false, // 无边框（自绘标题区）
    resizable: true, // 可调大小
    skipTaskbar: false, // 正常出现在任务栏
    alwaysOnTop: false, // 不强制置顶
    icon: existsSync(ICON_PATH) ? ICON_PATH : undefined, // 面板窗口图标（与主窗口一致）
    backgroundColor: '#0d1226', // 深蓝底色
    webPreferences: { // 安全基线同主窗口
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  panelWindow.once('ready-to-show', () => panelWindow.show()); // 就绪显示
  panelWindow.loadFile(join(RENDERER_DIR, 'panel.html')); // 加载面板页
  panelWindow.on('closed', () => { panelWindow = null; }); // 关闭时清引用
  return panelWindow; // 返回
}

// 获取面板窗口
export function getPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) return panelWindow; // 有效返回
  return null; // 空
}

// 向面板窗口广播最新状态（服务状态/工作区/Skills/MCP 任一变化时由 index.js 调）
export function pushPanelUpdate(payload) {
  const win = getPanelWindow(); // 面板引用
  if (win) win.webContents.send(IPC.APP_STATE, payload); // 推送
}
