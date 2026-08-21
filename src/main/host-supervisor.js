// 服务托管模块：spawn dsh 子进程 + stdout 就绪行解析 + 复用探测 + 停止
// 参考 anywhere-labs host-supervisor.ts 的成熟模式（READINESS_PREFIX 就绪行）

import { spawn, exec } from 'node:child_process'; // spawn 启动子进程；exec 跑 netstat 探测
import { promisify } from 'node:util'; // 把回调 API 转 Promise
import { EventEmitter } from 'node:events'; // 状态变化事件
import { existsSync } from 'node:fs'; // 检查 CLI 入口是否存在（未装 dsh 时进 missing 态）
import { getConfig, getDshCliEntry } from './config.js'; // 读配置与 CLI 入口路径

const execP = promisify(exec); // netstat 探测用 Promise 形式
// dsh 启动完成时 stdout 打印的规范就绪行前缀（anywhere-labs 同款约定）
const READINESS_PREFIX = 'dsh web: ';
// 就绪等待超时（毫秒），超过判定启动失败
const READINESS_TIMEOUT_MS = 90_000;
// 停止宽限期：先温和 kill，超时后强杀
const SHUTDOWN_GRACE_MS = 5_000;

// 创建服务托管器
export function createHostSupervisor() {
  const emitter = new EventEmitter(); // 状态事件总线
  let state = 'stopped'; // 当前状态：stopped | starting | running | error
  let child = null; // 自己 spawn 的子进程句柄
  let owned = false; // 当前实例是否由本应用 spawn（true 才负责杀）
  let readyUrl = null; // 就绪行解析出的 Web UI 地址（如 http://127.0.0.1:3080）
  let stderrTail = ''; // 最近 4KB stderr，启动失败时用于诊断展示

  // 统一的状态迁移函数，变化时广播事件
  function setState(next) {
    if (state === next) return; // 状态没变不重复广播
    state = next; // 更新状态
    emitter.emit('status-changed', next); // 通知监听方（窗口/托盘/面板）
  }

  // 订阅状态变化
  function onStatus(fn) {
    emitter.on('status-changed', fn); // 注册监听
  }

  // 当前状态与就绪地址
  function getStatus() {
    return { state, url: readyUrl, owned }; // 快照返回
  }

  // 用 netstat 查找指定端口的 LISTENING PID（复用探测用）
  async function findListenerPid(port) {
    try {
      const { stdout } = await execP(`netstat -ano`); // 全量端口表
      const line = stdout
        .split('\n') // 逐行
        .find((l) => l.includes(`:${port}`) && l.includes('LISTENING')); // 命中该端口监听行
      if (!line) return null; // 无监听者
      const pid = parseInt(line.trim().split(/\s+/).at(-1), 10); // 最后一列是 PID
      return Number.isInteger(pid) && pid > 0 ? pid : null; // 合法 PID 才返回
    } catch {
      return null; // netstat 失败视为无监听
    }
  }

  // 探测 3080 是否已有可用服务（HTTP 200 且带 dsh 特征）
  async function probeExisting(port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }); // 快速 GET
      if (!res.ok) return false; // 非 200 视为不可用
      const text = await res.text(); // 读取页面文本
      return text.includes('DeepSeek Harness') || text.includes('dsh'); // 简单特征判断防误判端口
    } catch {
      return false; // 连不上
    }
  }

  // 解析 stdout 增量流，等到就绪行出现
  function createReadinessParser() {
    let pending = ''; // 跨 chunk 的残留缓冲
    return {
      // 每收到一块输出就尝试解析
      push(chunk) {
        pending += chunk.toString('utf8'); // 拼进缓冲
        const lines = pending.split(/\r?\n/); // 按行切分
        pending = lines.pop() ?? ''; // 最后一行可能不完整，留到下次
        for (const line of lines) {
          if (line.startsWith(READINESS_PREFIX)) { // 命中就绪行
            const token = line.slice(READINESS_PREFIX.length).trim().split(/\s/, 1)[0]; // 取 URL 字段
            try {
              const url = new URL(token); // 校验 URL 合法性
              if (url.protocol === 'http:' && url.port) { readyUrl = url.origin; return readyUrl; } // 记录并返回
            } catch { /* 非法 URL 忽略，继续等下一行 */ }
          }
        }
        return undefined; // 还没就绪
      }
    };
  }

  // 核心：确保服务运行（应用启动时调用；已运行则复用）
  async function ensureRunning() {
    const port = getConfig('port'); // 目标端口
    if (state === 'starting' || state === 'running') return 'already-managed'; // 自己已托管
    if (await probeExisting(port)) { // 已有现成服务
      setState('running'); // 复用：直接进 running
      readyUrl = `http://127.0.0.1:${port}`; // 记录地址
      owned = false; // 不是自己 spawn 的，退出时不杀
      return 'reused'; // 报告复用
    }
    if (!existsSync(getDshCliEntry())) { // dsh CLI 入口不存在（未安装或路径不对）
      setState('missing'); // 进 missing 态：boot 页引导用户选择安装目录
      return 'missing'; // 报告缺失（不 spawn，避免无意义的启动失败）
    }
    setState('starting'); // 进入启动中
    const parser = createReadinessParser(); // 建就绪解析器
    const cliEntry = getDshCliEntry(); // CLI 入口绝对路径
    const cwd = getConfig('dshDir'); // 工作目录 = dsh 安装目录
    const env = { ...process.env, DSH_HOME: getConfig('dshHome') }; // 注入数据目录环境变量
    // 剔除主进程为自身网络设置的证书豁免变量：它会被子进程继承，
    // dsh 启动时打印 "NODE_TLS_REJECT_UNAUTHORIZED...insecure" 警告，被错误页显示后误导用户以为是错误原因
    delete env.NODE_TLS_REJECT_UNAUTHORIZED; // 不传递给 dsh 服务
    child = spawn('node', [cliEntry, 'web', '--port', String(port)], {
      cwd, // 工作目录
      env, // 环境变量
      stdio: ['ignore', 'pipe', 'pipe'], // 关 stdin，接管 stdout/stderr
      windowsHide: true // 不弹黑窗
    }); // 直接 node 起 bin.js（PID 即服务本体；--port 必须传：否则 dsh 起默认 3080，与探测/心跳端口不一致会被心跳误杀）
    owned = true; // 标记为自己托管

    // 就绪等待：stdout 解析为主
    const ready = await new Promise((resolve) => {
      let settled = false; // 防止重复决议
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, READINESS_TIMEOUT_MS); // 超时兜底
      child.stdout.on('data', (chunk) => { // 监听输出
        const url = parser.push(chunk); // 喂给解析器
        if (url && !settled) { settled = true; clearTimeout(timer); resolve(url); } // 就绪
      });
      child.stderr.on('data', (chunk) => { // 收集错误输出
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4096); // 只留尾部 4KB
      });
      child.on('exit', (code) => { // 进程提前退出
        if (!settled) { settled = true; clearTimeout(timer); resolve(null); } // 视为失败
        if (code !== null && code !== 0) stderrTail += `\n[exit code ${code}]`; // 记退出码
      });
    });
    if (ready) { // 就绪成功
      readyUrl = ready; // 保存地址
      setState('running'); // 进 running
      return 'started'; // 报告新启动
    }
    // 启动失败：清理并进 error
    if (child && !child.killed) child.kill(); // 杀残留进程
    child = null; owned = false; readyUrl = null; // 清理句柄
    setState('error'); // 进错误态
    return 'failed'; // 报告失败
  }

  // 停止服务（只杀自己托管的实例；复用的不杀）
  async function stop() {
    if (!owned || !child) { setState('stopped'); return; } // 非自己托管：仅复位状态
    const proc = child; // 快照句柄
    child = null; // 先清引用
    proc.kill(); // 温和停止（Windows 上发 kill 信号）
    const exited = await new Promise((resolve) => { // 等退出
      const timer = setTimeout(() => resolve(false), SHUTDOWN_GRACE_MS); // 5s 宽限
      proc.once('exit', () => { clearTimeout(timer); resolve(true); }); // 正常退出
    });
    if (!exited) { // 超时未退 → 强杀
      try { proc.kill('SIGKILL'); } catch { /* 已死则忽略 */ }
    }
    owned = false; readyUrl = null; // 复位
    setState('stopped'); // 进停止态
  }

  // 重启：先停再起
  async function restart() {
    await stop(); // 停当前
    return ensureRunning(); // 再拉起
  }

  // 启动失败诊断文案（boot 页错误展示用）
  function getStderrTail() {
    return stderrTail; // 返回收集的错误尾部
  }

  // 心跳探测：每 10 秒探测一次服务，连续 3 次失败判定服务意外死亡
  // （dsh 崩溃/被外部杀掉时应用状态机转 error，面板红灯 + 通知，避免"假运行"）
  let heartbeatTimer = null; // 心跳定时器
  let heartbeatFailures = 0; // 连续失败计数
  function startHeartbeat(onDead) {
    if (heartbeatTimer) return; // 已启动
    heartbeatTimer = setInterval(async () => { // 定时探测
      if (state !== 'running') { heartbeatFailures = 0; return; } // 非运行态不探测
      const port = getConfig('port'); // 目标端口
      const ok = await probeExisting(port); // 探测（HTTP 200 + dsh 特征）
      if (ok) { heartbeatFailures = 0; return; } // 正常 → 复位计数
      heartbeatFailures += 1; // 累加失败
      if (heartbeatFailures >= 3) { // 连续 3 次失败（约 30 秒）
        heartbeatFailures = 0; // 复位
        if (owned && child) { try { child.kill(); } catch { /* 已死忽略 */ } child = null; owned = false; } // 清理托管句柄
        setState('error'); // 状态转 error（面板红灯 + boot 错误页）
        onDead?.(); // 通知回调（index.js 弹"服务异常"通知）
      }
    }, 10_000); // 10 秒间隔
    heartbeatTimer.unref?.(); // 不阻止应用退出
  }

  return { ensureRunning, stop, restart, onStatus, getStatus, findListenerPid, probeExisting, getStderrTail, startHeartbeat };
}
