// dsh-desktop-launcher: launch the dsh-desktop Windows shell from the DSH
// conversation. The shell is the standalone Electron app (system tray,
// Skills/MCP manager panel, custom skins, auto-update, first-run guide);
// this plugin only needs to find and start its installed exe, or point the
// user at the latest GitHub Release when it is missing.
//
// Zero runtime dependencies: raw JSON-Schema tool registered through
// ctx.tools, node builtins only — mirroring the @liustack/modlens pattern.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'dsh-desktop-launcher';
export const inject = ['tools'];

// Install layouts the NSIS installer supports (default D:\DeepSeek Harness
// Desktop + per-user/per-machine variants; electron-builder appends an
// app-name subdirectory). Checked in order; first hit wins.
function candidateInstallDirs() {
  const dirs = [];
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const roots = [
    'D:\\DeepSeek Harness Desktop', // 默认安装根
    ...(localAppData ? [join(localAppData, 'Programs', 'DeepSeek Harness Desktop'), join(localAppData, 'Programs', 'dsh-desktop')] : []),
    ...(programFiles ? [join(programFiles, 'DeepSeek Harness Desktop'), join(programFiles, 'dsh-desktop')] : []),
    ...(programFilesX86 ? [join(programFilesX86, 'DeepSeek Harness Desktop'), join(programFilesX86, 'dsh-desktop')] : [])
  ];
  for (const root of roots) {
    dirs.push(root); // exe 直接在根（某些旧版布局）
    dirs.push(join(root, 'dsh-desktop')); // electron-builder 26 追加应用名子目录的布局
  }
  return dirs;
}

const EXE_NAME = 'dsh-desktop.exe'; // 打包的可执行文件名

/** 已安装 exe 的绝对路径，找不到返回 null */
export function findInstalledExe() {
  if (process.platform !== 'win32') return null;
  for (const dir of candidateInstallDirs()) {
    const p = join(dir, EXE_NAME);
    if (existsSync(p)) return p;
  }
  return null;
}

/** 分离启动 exe（start.exe 是 Windows 可靠方式，不随 dsh 进程退出） */
function launch(exePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', 'start', '', `"${exePath}"`], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

const DOWNLOAD_URL = 'https://github.com/wuyuzi-luo/dsh-desktop/releases/latest';

/** 构建 desktop_launch 工具定义（拆出来便于测试） */
export function buildDesktopTool() {
  return {
    name: 'desktop_launch',
    description:
      'Launch the dsh-desktop Windows shell (Electron desktop app around the DSH web UI: system tray, Skills/MCP manager panel, custom skins, auto-update). ' +
      'When the app is already installed it is started immediately; when it is missing, returns the download link to the latest GitHub Release. ' +
      'Use when the user wants to open or install the desktop app.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  };
}

export function apply(ctx) {
  ctx.tools.register(buildDesktopTool(), async () => {
    const exe = findInstalledExe();
    if (exe) {
      try {
        await launch(exe);
        return { content: [{ type: 'text', text: `dsh-desktop 已启动（${exe}）` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `启动失败：${err?.message ?? err}。可手动打开或从 ${DOWNLOAD_URL} 重新安装。` }] };
      }
    }
    return {
      content: [{
        type: 'text',
        text: `未检测到 dsh-desktop 安装。请从最新 Release 下载安装：${DOWNLOAD_URL}（安装后再次调用本工具即可打开）`
      }]
    };
  });
}
