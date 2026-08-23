// MCP 管理模块（CC Switch 模式）：MCP 定义存应用 config，开关态同步进
// web profile 的 cordis.patch.yml 标记段；用户手写内容字节级保留（不整体解析重写）

import yaml from 'js-yaml'; // YAML 解析/序列化（只处理应用自己的标记段）
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'; // 文件读写、备份与建目录
import { existsSync } from 'node:fs'; // 存在性检查
import { join, dirname } from 'node:path'; // 路径拼接
import { homedir } from 'node:os'; // 用户主目录（~/.claude.json 位置）
import { getCordisPatchPath, getConfig, setConfig } from './config.js'; // 路径与配置存取

// 标记段注释（在 patch 文件里圈出应用托管区域，文件其余内容不动）
const MARK_BEGIN = '# >>> dsh-desktop:mcp begin (auto-managed, do not edit) >>>';
const MARK_END = '# <<< dsh-desktop:mcp end <<<';

// dsh loader 注册的 !!js 表达式标签（tag:yaml.org,2002:js）——
// 用于 env 里的动态引用（如 process.env.GITHUB_TOKEN），读写两端都要认识
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', // 标量类型
  resolve: (d) => typeof d === 'string', // 读入端放宽：凡带 !!js 标签的标量都接受（用户手写任意 JS 表达式也要能读，
  // 旧实现只认 process.env. 前缀 → 其他 !!js 表达式读取时报错/丢内容导致导入列表静默为空）
  construct: (d) => d, // 读入时原样保留表达式文本
  instanceOf: String, // 实例类型
  represent: (v) => v, // 写出时原样
  predicate: (o) => typeof o === 'string' && o.startsWith('process.env.') // 写出端只把 process.env.* 输出为 !!js（应用管理的 env 动态引用）
});
// 应用自己的 YAML 模式（默认模式 + !!js 类型）
const YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([JsExpr]);

// 读取应用配置里的全部 MCP 定义（数组）
function getAllMcpDefs() {
  return getConfig('mcpServers') ?? []; // 缺省空数组
}

// 保存 MCP 定义列表（写入应用 config，不直接碰 patch 文件）
function saveMcpDefs(defs) {
  setConfig('mcpServers', defs); // 持久化
}

// 操作串行链：add/remove/toggle/adopt 的"读定义→改→存→同步文件"不是原子操作，
// 并发时（面板快速连点）两个操作读同一份定义分别写回，后者覆盖前者丢配置
let mcpOps = Promise.resolve(); // 串行链尾（初始已完成）
function withMcpLock(fn) { // 把操作挂到链上串行执行
  const run = mcpOps.then(fn, fn); // 前一个 settle 后执行（前一个失败也继续链）
  mcpOps = run.catch(() => {}); // 链上吞错防断链
  return run; // 返回真实结果给调用方
}

// 把定义对象转换成 dsh 认识的 insert patch 条目（env 里 process.env.* 转成 !!js 表达式）
function toPatchEntry(def) {
  const config = { // MCP 插件配置
    serverName: def.serverName, // 工具命名空间
    transport: def.transport // stdio 或 streamable-http
  };
  if (def.transport === 'stdio') { // stdio 传输
    config.command = def.command; // 可执行文件
    if (Array.isArray(def.args) && def.args.length) config.args = def.args; // 参数
    if (def.env && Object.keys(def.env).length) { // 环境变量
      config.env = {}; // 构建 env 对象
      for (const [k, v] of Object.entries(def.env)) { // 逐项
        config.env[k] = v; // 直接赋值：process.env.* 会由 dump 端 predicate 自动输出为 !!js 表达式
        // （旧代码用 new String(v)：typeof 变成 'object'，predicate 的 typeof 检查恒 false → !!js 标签不产出 → 动态引用失效）
      }
    }
  } else { // streamable-http 传输
    config.url = def.url; // 服务器 URL
    if (def.headers && Object.keys(def.headers).length) config.headers = def.headers; // 头信息
  }
  return { // insert patch 条目（dsh 的插件实例插入语法）
    insert: [{
      id: `dsh-desktop-mcp-${def.serverName}`, // 唯一实例 id（前缀避免与用户手写冲突）
      name: '@deepseek-ai/dsh-mcp-client', // 官方 MCP 客户端插件
      config // 插件配置
    }]
  };
}

// 把启用中的 MCP 定义渲染成标记段文本
function renderManagedBlock(defs) {
  const enabled = defs.filter((d) => d.enabled !== false); // 只写启用项
  if (!enabled.length) return ''; // 无启用项 → 空块（即移除标记段）
  const patchEntries = enabled.map(toPatchEntry); // 逐条转 patch
  const body = yaml.dump(patchEntries, { schema: YAML_SCHEMA, noRefs: true, lineWidth: 120 }); // 序列化
  return `${MARK_BEGIN}\n${body.trimEnd()}\n${MARK_END}\n`; // 包上标记
}

// 读取 patch 文件的当前文本（不存在则视为空文件）
async function readPatchText() {
  const path = getCordisPatchPath(); // patch 文件路径
  if (!existsSync(path)) return ''; // 不存在 → 空
  return readFile(path, 'utf8'); // 读取文本
}

// 核心同步：把启用中的 MCP 写进 cordis.patch.yml 标记段（其余内容逐字节保留）
async function syncToPatchFile() {
  const defs = getAllMcpDefs(); // 读应用配置
  const path = getCordisPatchPath(); // 目标文件
  const original = await readPatchText(); // 读当前文本
  // 摘掉旧标记段（含首尾标记行）
  let cleaned = original; // 处理中的文本
  const beginIdx = cleaned.indexOf(MARK_BEGIN); // 找起始标记
  if (beginIdx >= 0) { // 有旧块
    const endIdx = cleaned.indexOf(MARK_END, beginIdx); // 找结束标记
    const cutEnd = endIdx >= 0 ? endIdx + MARK_END.length + 1 : cleaned.length; // 计算切除终点（含行尾换行）
    cleaned = cleaned.slice(0, beginIdx) + cleaned.slice(cutEnd); // 切除旧块
  }
  const block = renderManagedBlock(defs); // 生成新块（无启用项则为空）
  const next = cleaned.replace(/\n*$/, '\n') + (block ? '\n' + block : ''); // 拼回：原文尾部规整 + 新块
  if (next !== original) { // 有变化才写
    await mkdir(dirname(path), { recursive: true }); // 确保父目录存在（修复：全新机器 dsh 未装时 profiles 目录不存在，writeFile 抛 ENOENT 打断主进程装配链）
    if (existsSync(path)) await copyFile(path, path + '.bak'); // 写前备份
    await writeFile(path, next, 'utf8'); // 覆盖写
  }
  return next !== original; // 报告是否有改动
}

// 从 patch 文件回读应用标记段（启动时校准：文件被外部改过也以应用 config 为准，这里只用于校验日志）
async function readManagedBlockFromFile() {
  const text = await readPatchText(); // 读文本
  const beginIdx = text.indexOf(MARK_BEGIN); // 找标记
  if (beginIdx < 0) return null; // 无标记段
  const endIdx = text.indexOf(MARK_END, beginIdx); // 结束标记
  if (endIdx < 0) return null; // 无结束标记
  const body = text.slice(beginIdx + MARK_BEGIN.length, endIdx); // 取中间体
  try {
    return yaml.load(body, { schema: YAML_SCHEMA }); // 解析（只解析自家块，安全）
  } catch {
    return null; // 解析失败忽略
  }
}

// 添加一个 MCP 定义
async function addMcp(def) {
  return withMcpLock(async () => { // 串行化：防并发读改写互相覆盖
    const defs = getAllMcpDefs(); // 读现有
    if (defs.some((d) => d.serverName === def.serverName)) throw new Error(`MCP 名称 ${def.serverName} 已存在`); // 重名拒绝
    defs.push({ ...def, enabled: true }); // 追加并默认启用
    saveMcpDefs(defs); // 存配置
    await syncToPatchFile(); // 同步到 patch（HMR 立即生效）
  });
}

// 删除一个 MCP 定义
async function removeMcp(serverName) {
  return withMcpLock(async () => { // 串行化：防并发读改写互相覆盖
    const defs = getAllMcpDefs().filter((d) => d.serverName !== serverName); // 过滤掉目标
    saveMcpDefs(defs); // 存配置
    await syncToPatchFile(); // 同步
  });
}

// 切换启用/停用
async function toggleMcp(serverName, enabled) {
  return withMcpLock(async () => { // 串行化：防并发读改写互相覆盖
    const defs = getAllMcpDefs(); // 读现有
    const def = defs.find((d) => d.serverName === serverName); // 找目标
    if (!def) throw new Error(`MCP ${serverName} 不存在`); // 不存在报错
    def.enabled = Boolean(enabled); // 改开关
    saveMcpDefs(defs); // 存配置
    await syncToPatchFile(); // 同步（停用=从 patch 摘除，HMR 生效）
  });
}

// 连接状态探测：http 传输试连 /initialize；stdio 只报配置存在（不实际拉起进程）
async function probeMcp(def) {
  if (def.transport === 'streamable-http') { // HTTP 传输可探测
    try {
      const res = await fetch(def.url, { // 探测请求
        method: 'POST', // MCP JSON-RPC 用 POST
        headers: { 'Content-Type': 'application/json', ...(def.headers ?? {}) }, // 带用户头
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-desktop', version: '0.1.0' } } }), // initialize 握手
        signal: AbortSignal.timeout(3000) // 3s 超时
      });
      return res.ok ? 'ok' : `http-${res.status}`; // 200 视为可用
    } catch {
      return 'unreachable'; // 连不上
    }
  }
  return 'configured'; // stdio 不探测，仅报已配置
}

// 导出完整列表（含探测状态，面板展示用）
async function listMcps() {
  const defs = getAllMcpDefs(); // 读定义
  const out = []; // 输出
  for (const def of defs) { // 逐项
    const entry = { ...def, env: maskEnv(def.env) }; // 脱敏 env 值
    entry.status = await probeMcp(def); // 附加探测状态
    out.push(entry); // 收集
  }
  return out; // 返回
}

// env 脱敏：值以 sk-/token 等开头的截断显示
function maskEnv(env) {
  if (!env) return undefined; // 无 env
  const masked = {}; // 脱敏副本
  for (const [k, v] of Object.entries(env)) { // 逐项
    const s = String(v); // 转文本
    masked[k] = s.length > 12 ? s.slice(0, 8) + '***' : s; // 长值截断
  }
  return masked; // 返回
}

// 启动时初始化：把应用 config 里的启用项同步进 patch 文件
export async function initMcpManager() {
  await syncToPatchFile(); // 一次同步
}

// —— "导入已有"支持：发现 cordis.patch.yml 里用户手写的 MCP 实例（标记段之外）——
// 解析整个 patch 文件（用宽松 schema 容错未知标签），找出 name 为官方 MCP 客户端的实例
async function findExternalMcps() {
  const text = await readPatchText(); // 读当前文件
  if (!text.trim()) return []; // 空文件
  const withMarkers = text; // 含标记段的原始文本
  const managed = []; // 应用标记段内的实例 id 集合（用于排除）
  const beginIdx = withMarkers.indexOf(MARK_BEGIN); // 标记段起点
  if (beginIdx >= 0) { // 有标记段
    const endIdx = withMarkers.indexOf(MARK_END, beginIdx); // 终点
    if (endIdx >= 0) { // 完整段
      try { // 解析自家段拿 id 列表
        const managedEntries = yaml.load(withMarkers.slice(beginIdx + MARK_BEGIN.length, endIdx), { schema: YAML_SCHEMA }) ?? [];
        for (const entry of managedEntries) { // 收集自家 id
          if (entry && Array.isArray(entry.insert)) for (const it of entry.insert) managed.push(it?.id); // 推入
        }
      } catch { /* 解析失败则只按名称去重 */ }
    }
  }
  let parsed = null; // 全文件解析结果
  try { // 宽容解析（FULL schema 容错未知标签）
    const tolerantSchema = yaml.DEFAULT_FULL_SCHEMA.extend([JsExpr]); // 宽松模式
    parsed = yaml.load(text, { schema: tolerantSchema }); // 解析全文
  } catch { return []; } // 文件有无法解析的内容 → 放弃导入发现（不冒险）
  if (!Array.isArray(parsed)) return []; // 非数组结构
  const found = []; // 发现的外部实例
  for (const entry of parsed) { // 逐条目
    if (!entry || !Array.isArray(entry.insert)) continue; // 只处理 insert 条目
    for (const it of entry.insert) { // 逐插入项
      if (!it || it.name !== '@deepseek-ai/dsh-mcp-client') continue; // 只认官方 MCP 客户端插件
      if (managed.includes(it.id)) continue; // 跳过应用已管理的
      const cfg = it.config ?? {}; // 配置
      if (!cfg.serverName) continue; // 无 serverName 跳过
      found.push({ // 组装可导入摘要
        id: it.id, // 原实例 id
        serverName: cfg.serverName, // 命名空间
        transport: cfg.transport, // 传输方式
        command: cfg.command, // stdio 命令
        args: cfg.args, // 参数
        url: cfg.url, // http URL
        env: cfg.env, // 环境变量
        headers: cfg.headers // 头信息
      });
    }
  }
  return found; // 返回发现列表
}

// 扫描 Claude Code 用户级配置（~/.claude.json）顶层 mcpServers，转成可导入摘要
async function findClaudeMcps() {
  const claudeJson = join(homedir(), '.claude.json'); // Claude Code 配置文件路径
  if (!existsSync(claudeJson)) return []; // 没有配置文件
  let parsed = null; // 解析结果
  try {
    parsed = JSON.parse(await readFile(claudeJson, 'utf8')); // 读并解析
  } catch { return []; } // 解析失败（语法错误/被占用）→ 空
  const servers = parsed?.mcpServers ?? {}; // 顶层 mcpServers 表
  const found = []; // 结果
  for (const [name, def] of Object.entries(servers)) { // 逐服务器
    if (!def || typeof def !== 'object') continue; // 非法条目跳过
    const entry = { // 组装可导入摘要
      id: `claude:${name}`, // 唯一 id（前缀区分来源）
      serverName: name, // 命名空间
      source: 'Claude Code', // 来源标签（面板展示）
      command: def.command, // stdio 命令
      args: Array.isArray(def.args) ? def.args : undefined, // 参数
      url: def.url, // http URL
      env: def.env && Object.keys(def.env).length ? def.env : undefined, // 环境变量
      headers: def.headers && Object.keys(def.headers).length ? def.headers : undefined // 头信息
    };
    // 传输方式推断：有 URL 且无命令 → http；否则 stdio
    entry.transport = (entry.url && !entry.command) ? 'streamable-http' : 'stdio';
    if (entry.transport === 'stdio' && !entry.command) continue; // 既无命令又无 URL 的跳过
    found.push(entry); // 收集
  }
  return found; // 返回
}

// 列出可导入的外部 MCP（面板"导入已有"视图）：dsh patch 手写条目 + Claude Code 配置
export async function listImportableMcps() {
  const [fromPatch, fromClaude] = await Promise.all([ // 并行扫两个来源
    findExternalMcps(), // dsh cordis.patch.yml 手写条目
    findClaudeMcps() // Claude Code ~/.claude.json
  ]);
  const merged = [...fromPatch, ...fromClaude]; // 合并
  const managedNames = new Set(getAllMcpDefs().map((d) => d.serverName)); // 已管理名称
  return merged.filter((e) => !managedNames.has(e.serverName)); // 排除已收编的
}

// 收编一个外部实例：加入应用 config、从文件摘除原条目（防 serverName 冲突）、再同步
export async function adoptMcp(external) {
  return withMcpLock(async () => { // 串行化：防并发读改写互相覆盖
    if (!external || !external.serverName) throw new Error('无效实例'); // 校验
    const defs = getAllMcpDefs(); // 现有定义
    if (defs.some((d) => d.serverName === external.serverName)) throw new Error(`MCP ${external.serverName} 已存在`); // 重名拒绝
    // 关键：先从文件摘除原条目——dsh 规定存活实例中重复 serverName 会使后加载的插件实例失败，
    // 若原条目保留，标记段里收编的副本会与原实例冲突导致整个 MCP 加载失败
    await removeExternalEntryFromFile(external.serverName); // 摘除原文条目
    const def = { // 转应用定义格式
      serverName: external.serverName, // 命名空间
      transport: external.transport, // 传输
      command: external.command, // 命令
      args: external.args, // 参数
      url: external.url, // URL
      env: external.env, // 环境
      headers: external.headers, // 头
      enabled: true, // 收编即启用
      adopted: true // 标记来自导入
    };
    defs.push(def); // 加入
    saveMcpDefs(defs); // 存配置
    await syncToPatchFile(); // 同步（标记段接管开关管理）
  });
}

// 从 cordis.patch.yml 文本级摘除含目标 serverName 的外部 MCP 顶层条目
// （不整体 YAML 往返，注释与格式保留；写前已有 .bak 备份）
async function removeExternalEntryFromFile(serverName) {
  const path = getCordisPatchPath(); // 目标文件
  if (!existsSync(path)) return; // 无文件
  const text = await readFile(path, 'utf8'); // 读文本
  // 摘掉标记段后再切分（避免误判自家条目）
  let cleaned = text; // 处理文本
  const beginIdx = cleaned.indexOf(MARK_BEGIN); // 标记段起点
  if (beginIdx >= 0) { // 有标记段
    const endIdx = cleaned.indexOf(MARK_END, beginIdx); // 终点
    if (endIdx >= 0) cleaned = cleaned.slice(0, beginIdx) + cleaned.slice(endIdx + MARK_END.length + 1); // 切除标记段
  }
  const lines = cleaned.split('\n'); // 按行
  const kept = []; // 保留行
  let entry = null; // 当前顶层条目（以 "- " 起始的块）
  const entries = []; // 全部顶层条目块
  for (const line of lines) { // 逐行切分
    if (/^- /.test(line)) { // 新顶层条目起点
      if (entry) entries.push(entry); // 收尾前一条
      entry = { start: null, lines: [line] }; // 开新块
    } else if (entry) {
      entry.lines.push(line); // 追加到当前块
    } else {
      kept.push(line); // 条目外内容（文件头注释等）
    }
  }
  if (entry) entries.push(entry); // 收尾最后一条
  let removed = false; // 是否摘除过
  for (const e of entries) { // 逐块判断
    const body = e.lines.join('\n'); // 块文本
    let parsed = null; // 解析结果
    try { parsed = yaml.load(body, { schema: yaml.DEFAULT_FULL_SCHEMA.extend([JsExpr]) }); } catch { /* 解析失败整块保留 */ }
    let hit = false; // 该块是否含目标 mcp
    let mixed = false; // 该块是否混有其他内容
    if (Array.isArray(parsed)) { // 顶层数组块
      for (const entryObj of parsed) { // 块内条目
        if (entryObj && Array.isArray(entryObj.insert)) { // insert 型
          for (const it of entryObj.insert) { // 逐实例
            const isMcp = it?.name === '@deepseek-ai/dsh-mcp-client'; // 是否 MCP 客户端
            const isTarget = isMcp && it?.config?.serverName === serverName; // 是否目标
            if (isTarget) hit = true; // 命中
            else if (isMcp) mixed = true; // 同块还有别的 MCP
            else if (it) mixed = true; // 同块混有其他插件
          }
        } else if (entryObj) { mixed = true; } // 其他类型条目
      }
    } else if (parsed) { mixed = true; } // 非数组结构
    if (hit && !mixed) { removed = true; continue; } // 纯目标块 → 摘除
    kept.push(...e.lines); // 否则保留
  }
  if (removed) { // 有变化才写（sync 前的备份在 syncToPatchFile 里做，这里先备份一次）
    if (existsSync(path)) await copyFile(path, path + '.bak'); // 写前备份
    await writeFile(path, kept.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8'); // 写回（压缩多余空行）
  }
}

export { listMcps, addMcp, removeMcp, toggleMcp, getAllMcpDefs };
