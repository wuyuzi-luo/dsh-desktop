// 工作区模块：workspace.json 容错解析 + 打开目录 + host.openPath 通知 dsh

import { readFile } from 'node:fs/promises'; // 异步读文件
import { existsSync } from 'node:fs'; // 存在性检查
import { shell } from 'electron'; // Electron 命名导入（已验证在真主进程可用）
import { getWorkspaceJsonPath, getConfig } from './config.js'; // 路径与端口配置

// 读取并解析工作区列表（任何异常都返回空数组，绝不抛出）
export async function loadWorkspaces() {
  const path = getWorkspaceJsonPath(); // workspace.json 路径
  if (!existsSync(path)) return []; // 文件不存在 → 空
  try {
    const raw = await readFile(path, 'utf8'); // 读文件
    const data = JSON.parse(raw); // 解析 JSON
    const tables = data?.tables?.workspaces; // 取工作区表
    if (!tables || typeof tables !== 'object') return []; // 结构不符 → 空
    const ids = Array.isArray(data?.global?.workspaceIds) ? data.global.workspaceIds : Object.keys(tables); // 按全局顺序（缺省退化为表键序）
    const result = []; // 结果集
    for (const id of ids) { // 逐工作区
      const ws = tables[id]; // 取条目
      if (!ws || typeof ws.path !== 'string' || !ws.path) continue; // 缺 path 跳过
      result.push({ // 组装摘要
        id, // 工作区 id
        path: ws.path, // 目录路径
        title: typeof ws.title === 'string' && ws.title ? ws.title : ws.path.split(/[\\/]/).pop(), // 显示名（缺省取末级目录名）
        sessionCount: Array.isArray(ws.sessionIds) ? ws.sessionIds.length : 0, // 会话数
        updatedAt: typeof ws.updatedAt === 'number' ? ws.updatedAt : 0 // 更新时间
      });
    }
    return result; // 返回摘要列表
  } catch {
    return []; // 损坏/权限问题 → 空
  }
}

// 打开工作区：资源管理器打开目录 + dsh 侧 host.openPath 感知
export async function openWorkspace(summary) {
  if (!summary || !summary.path) return; // 非法条目忽略
  const err = await shell.openPath(summary.path); // 资源管理器打开（返回 '' 表示成功）
  if (err) return; // 打开失败静默（不弹错）
  try {
    const port = getConfig('port'); // 目标端口
    // 通知 dsh 打开该路径（失败仅忽略，不影响主行为）
    await fetch(`http://127.0.0.1:${port}/api/host.openPath`, { // dsh 的 HTTP RPC
      method: 'POST', // RPC 用 POST
      headers: { 'Content-Type': 'application/json' }, // JSON 载荷
      body: JSON.stringify({ path: summary.path }) // 目标路径
    });
  } catch { /* dsh 不可达时静默 */ }
}

// 预留深链构造（当前 deepLink:off 不使用；日后装 deeplink 插件可切换）
export function buildDeepLink(workspaceId) {
  const port = getConfig('port'); // 目标端口
  return `http://127.0.0.1:${port}/?workspace=${encodeURIComponent(workspaceId)}`; // 深链地址
}
