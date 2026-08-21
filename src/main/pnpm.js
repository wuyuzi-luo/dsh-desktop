// pnpm 命令解析:检测系统全局 pnpm,没有则用 npx 按需拉取
// 背景:npm(arborist)全量解析 dsh 的 185 子包依赖树必死循环(实测 7 种姿势全卡,
// 内存爆炸/GC 风暴),pnpm 的 content-addressable store 算法完全绕开,90 秒装完
import { spawn } from 'node:child_process'; // 检测用 spawn 跑 --version
import { readFile, writeFile } from 'node:fs/promises'; // ensurePnpmConfig 读写 pnpm-workspace.yaml
import { join } from 'node:path'; // 路径拼接

// 解析出可用的 pnpm 启动命令:['pnpm'] 或 ['npx','-y','pnpm@11'](调用方拼在 install 前面)
export async function resolvePnpm() {
  // 先试系统全局 pnpm(exit 0 且输出是版本号格式才视为可用)
  const ok = await new Promise((resolve) => {
    const ps = spawn('pnpm', ['--version'], { shell: true, windowsHide: true }); // Windows 下 pnpm.cmd 需 shell 解析
    let out = ''; // 收集版本输出
    ps.stdout.on('data', (c) => { out += c.toString('utf8'); }); // 版本号输出在 stdout
    ps.on('error', () => resolve(false)); // spawn 本身失败(pnpm 不存在)→ 不可用
    ps.on('exit', (code) => resolve(code === 0 && /^\d+\.\d+/.test(out.trim()))); // 版本号格式校验
    setTimeout(() => { try { ps.kill(); } catch { /* 忽略 */ } resolve(false); }, 10_000); // 10 秒兜底防挂
  });
  if (ok) return ['pnpm']; // 系统 pnpm 可用
  return ['npx', '-y', 'pnpm@11']; // 无 pnpm:npx 按需拉取(npx 缓存后二次调用秒开)
}

// 统一的 pnpm install 参数(更新与首次安装共用)
// registryUrl 同时作为 npm_config_registry 注入环境:npx 下载 pnpm 本体时也走该源(国内镜像)
export function buildPnpmInstallArgs(pkgSpec, registryUrl) {
  return ['install', pkgSpec, '--registry', registryUrl]; // pnpm 不需要 npm 的 --no-fund/--no-audit(pnpm 本就不跑 fund/audit)
}

// 强杀整个进程树(spawn 用 shell:true 时 child 是 cmd 壳,只杀壳会留孤儿继续锁文件)
export function killTree(pid) {
  if (!pid) return; // 无进程
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false }); // taskkill /T /F 端掉整棵树
  } catch { /* 忽略 */ }
}

// 确保安装目录的 pnpm-workspace.yaml 含 onlyBuiltDependencies
// pnpm 11 默认忽略依赖的构建脚本(安全特性),原生模块 node-pty/koffi 不批准构建会缺编译产物
// (node-pty 虽有平台 prebuild 兜底,显式批准更稳;首次安装目录没有此文件时必须写)
export async function ensurePnpmConfig(dir) {
  try {
    const p = join(dir, 'pnpm-workspace.yaml'); // 配置文件路径
    let content = ''; // 现有内容
    try { content = await readFile(p, 'utf8'); } catch { /* 文件不存在 → 稍后新建 */ }
    if (!content.includes('onlyBuiltDependencies')) { // 没配过才写(不覆盖用户已有配置)
      content += `\nonlyBuiltDependencies:\n  - node-pty\n  - koffi\n  - protobufjs\n  - "@deepseek-ai/dsh-subprocess-local"\n  - "@google/genai"\n`; // 允许这些依赖跑构建脚本
      await writeFile(p, content); // 写出
    }
  } catch { /* 写失败不阻塞安装(构建脚本被忽略时 node-pty 有 prebuild 兜底) */ }
}
