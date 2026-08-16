// 托盘模块：常驻图标 + 右键菜单（显示主窗口 / 工作区▸ / 控制面板 / 退出）
// 关窗不退出，托盘"退出"才走完整退出流程（停服务 + 卸载监听）
// 图标用预生成的 PNG 文件（Windows 托盘不支持 SVG 光栅化，tray-*.png 由 npm run icons 生成）

import { Tray, Menu, nativeImage } from 'electron'; // 托盘类与菜单
import { fileURLToPath } from 'node:url'; // ESM 路径
import { dirname, join } from 'node:path'; // 路径拼接
import { existsSync } from 'node:fs'; // 存在性检查

// 托盘 PNG 所在目录（build/）
const BUILD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets'); // 图标资源目录（src/assets，随包分发）

let tray = null; // 托盘单例

// 创建/更新托盘（服务状态变化时换状态色图标与菜单）
export function createTray({ state, onShow, onQuit, onOpenPanel, workspaces, onOpenWorkspace }) {
  // 按状态选 PNG 文件（running/error/stopped 三色；缺文件回退到 icon.ico）
  const trayState = state === 'missing' ? 'error' : state; // missing 复用 error 色图标（警示未安装）
  const trayPng = join(BUILD_DIR, `tray-${trayState}.png`); // 目标文件
  const iconPath = existsSync(trayPng) ? trayPng : join(BUILD_DIR, 'icon.ico'); // 回退链
  const image = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty(); // 从文件读图标（Windows 可靠方式）

  if (!tray) { // 首次创建
    tray = new Tray(image); // 实例化
    tray.setToolTip('dsh 桌面 · DeepSeek Harness'); // 悬停提示
    tray.on('click', onShow); // 单击 = 显示主窗口
  } else {
    tray.setImage(image); // 更新图标（状态变色）
  }

  // 组装菜单
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: onShow }, // 显示主窗口
    { // 工作区子菜单
      label: '工作区',
      submenu: (workspaces && workspaces.length ? workspaces : [{ id: null, title: '（无工作区）', path: '' }]).map((ws) => ({ // 逐工作区
        label: ws.title, // 显示名
        toolTip: ws.path || undefined, // 路径提示
        enabled: Boolean(ws.id), // 占位项不可点
        click: () => onOpenWorkspace(ws) // 点击打开目录
      }))
    },
    { type: 'separator' }, // 分隔线
    { label: '控制面板 (Ctrl+Shift+D)', click: onOpenPanel }, // 打开面板
    { type: 'separator' }, // 分隔线
    { label: '退出', click: onQuit } // 完整退出
  ]);
  tray.setContextMenu(menu); // 绑定右键菜单
  return tray; // 返回
}

// 销毁托盘（应用退出时清理）
export function destroyTray() {
  if (tray) { tray.destroy(); tray = null; } // 销毁并清引用
}
