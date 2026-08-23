// Skill 管理模块（CC Switch 模式）：扫描技能根 + SKILL.md 解析 + 安装/停用
// dsh-skill-filesystem 的扫描根：$DSH_HOME/skills、~/.agents/skills、项目 .dsh/skills
// 停用 = 移入 $DSH_HOME/skills-disabled（移出扫描根，chokidar 热生效）

import { readdir, readFile, mkdir, copyFile, rename, rm } from 'node:fs/promises'; // 文件操作
import { existsSync } from 'node:fs'; // 存在性检查
import { join, basename, extname } from 'node:path'; // 路径拼接
import { homedir, tmpdir } from 'node:os'; // 用户主目录与临时目录
import { execFile } from 'node:child_process'; // 调 PowerShell 解压 zip（Windows 自带，零新依赖）
import { promisify } from 'node:util'; // 回调转 Promise
import { getSkillsDir, getDisabledSkillsDir } from './config.js'; // 目录配置

const execFileP = promisify(execFile); // PowerShell 调用 Promise 化

// 列出所有技能扫描根（dsh-skill-filesystem 的约定目录 + Claude Code 技能目录）
export function getSkillRoots() {
  const roots = []; // 结果
  const skillsDir = getSkillsDir(); // $DSH_HOME/skills（用户级，安装落点）
  const agentsDir = join(homedir(), '.agents', 'skills'); // ~/.agents/skills（共享 agent 目录）
  const claudeDir = join(homedir(), '.claude', 'skills'); // ~/.claude/skills（Claude Code 技能，只读展示）
  roots.push({ path: skillsDir, label: 'dsh 用户技能', priority: 400 }); // 主扫描根
  roots.push({ path: agentsDir, label: '共享 agent 技能', priority: 500 }); // 副扫描根
  roots.push({ path: claudeDir, label: 'Claude Code 技能', priority: 600 }); // Claude Code 技能目录（格式同为 SKILL.md）
  return roots; // 返回
}

// 解析 SKILL.md 的 frontmatter 与描述（容错：任何异常都降级返回文件名）
async function readSkillMeta(dir) {
  const skillMd = join(dir, 'SKILL.md'); // 标准技能文件
  if (!existsSync(skillMd)) { // 无 SKILL.md
    const mdFiles = (await readdir(dir)).filter((f) => f.endsWith('.md')); // 平铺 Markdown 形式
    if (!mdFiles.length) return null; // 什么也没有
    const first = mdFiles[0]; // 取第一个 md
    const text = await readFile(join(dir, first), 'utf8'); // 读正文
    return { name: basename(dir), description: firstLine(text), file: first }; // 降级元信息
  }
  const text = await readFile(skillMd, 'utf8'); // 读 SKILL.md
  const fm = parseFrontmatter(text); // 解析 frontmatter
  return { name: fm.name || basename(dir), description: fm.description || firstLine(text), file: 'SKILL.md' }; // 组装元信息
}

// 极简 frontmatter 解析（--- 包裹的 YAML 键值，只看 name/description）
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/); // 匹配头部 frontmatter
  const out = {}; // 结果
  if (m) { // 有 frontmatter
    for (const line of m[1].split('\n')) { // 逐行
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/); // 键值行
      if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, ''); // 去引号
    }
  }
  return out; // 返回
}

// 取正文第一行作为降级描述
function firstLine(text) {
  const line = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#')); // 找首条非空非标题行
  return line ? line.trim().slice(0, 120) : ''; // 截断返回
}

// 扫描一个目录下的技能清单
async function scanDir(rootPath, label) {
  if (!existsSync(rootPath)) return []; // 目录不存在 → 空
  let entries = []; // 目录条目
  try {
    entries = await readdir(rootPath, { withFileTypes: true }); // 列出条目
  } catch { return []; } // 权限异常等降级为空（旧实现整个 listSkills 抛错，面板技能页全挂）
  const out = []; // 结果
  for (const e of entries) { // 逐条目
    if (!e.isDirectory()) continue; // 只认目录（每个技能一个文件夹）
    if (e.name.startsWith('.')) continue; // 跳过隐藏目录
    const dir = join(rootPath, e.name); // 完整路径
    try {
      const meta = await readSkillMeta(dir); // 解析元信息
      if (!meta) continue; // 空技能跳过
      out.push({ // 组装条目
        id: `${rootPath}::${e.name}`, // 唯一 id
        dir, // 磁盘路径
        source: label, // 来源标签
        enabled: true, // 在扫描根内 = 启用
        ...meta // 名称与描述
      });
    } catch { /* 单个技能异常跳过 */ }
  }
  return out; // 返回清单
}

// 列出全部技能（启用 + 停用两类）
export async function listSkills() {
  const roots = getSkillRoots(); // 扫描根
  const enabled = []; // 启用列表
  for (const r of roots) { // 逐根扫描
    enabled.push(...(await scanDir(r.path, r.label))); // 收集
  }
  // 停用目录（skills-disabled 不在 dsh 扫描根内）
  const disabledRoot = getDisabledSkillsDir(); // 停用暂存目录
  const disabled = await scanDir(disabledRoot, '已停用'); // 扫描暂存目录
  for (const d of disabled) d.enabled = false; // 标记停用
  return [...enabled, ...disabled]; // 合并返回
}

// 读取技能正文（面板展开查看 SKILL.md）
export async function readSkillContent(id) {
  const all = await listSkills(); // 找目标
  const skill = all.find((s) => s.id === id); // 按 id 匹配
  if (!skill) return null; // 不存在
  const file = join(skill.dir, skill.file || 'SKILL.md'); // 正文文件
  if (!existsSync(file)) return null; // 文件缺失
  return readFile(file, 'utf8'); // 返回全文
}

// 安装技能：支持文件夹或 .zip 压缩包，复制到 $DSH_HOME/skills
export async function installSkill(sourcePath) {
  if (!existsSync(sourcePath)) throw new Error('源路径不存在'); // 校验
  let srcDir = sourcePath; // 实际要复制的目录（zip 先解压）
  let tmpDir = null; // zip 解压临时目录（事后清理）
  if (extname(sourcePath).toLowerCase() === '.zip') { // zip 压缩包
    tmpDir = join(tmpdir(), `dsh-skill-extract-${Date.now()}`); // 临时解压目录
    await mkdir(tmpDir, { recursive: true }); // 建目录
    try { // 用 Windows 自带 PowerShell 解压（零新依赖）
      // 修复：路径含单引号（如用户名 wuyuzi'scomputer）会破坏 PowerShell 单引号字符串导致 ParserError，
      // 按 PowerShell 规则把 ' 转义为 '' 后再嵌入命令
      const psSafe = (p) => String(p).replace(/'/g, "''"); // 单引号转义
      await execFileP('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${psSafe(sourcePath)}' -DestinationPath '${psSafe(tmpDir)}' -Force`], { timeout: 120000 }); // 解压
    } catch (err) { // 解压失败
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {}); // 清理
      throw new Error('zip 解压失败: ' + String(err?.message ?? err)); // 报错
    }
    srcDir = await findSkillRootIn(tmpDir); // 在解压产物中找含 SKILL.md 的目录（跳过外层包裹目录）
    if (!srcDir) { // 没找到技能结构
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {}); // 清理
      throw new Error('压缩包内未找到 SKILL.md，不是有效的技能包'); // 报错
    }
  }
  const name = basename(srcDir); // 目标名取末级目录名
  const target = join(getSkillsDir(), name); // 安装落点
  if (existsSync(target)) { // 防覆盖
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {}); // 早退前清理解压临时目录（旧实现此路径遗留 TEMP 垃圾）
    throw new Error(`技能 ${name} 已存在`); // 报错
  }
  await mkdir(getSkillsDir(), { recursive: true }); // 确保根目录
  await copyDir(srcDir, target); // 递归复制
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {}); // 清理临时目录
}

// 在解压产物中定位技能根目录：自身含 SKILL.md 直接返回；否则递归找子目录
async function findSkillRootIn(dir) {
  if (existsSync(join(dir, 'SKILL.md'))) return dir; // 自身就是技能根
  const entries = await readdir(dir, { withFileTypes: true }); // 列子项
  for (const e of entries) { // 逐子目录
    if (!e.isDirectory()) continue; // 只找目录
    const sub = await findSkillRootIn(join(dir, e.name)); // 递归
    if (sub) return sub; // 找到即返回
  }
  return null; // 没有
}

// 递归复制目录（Node 无内置，自写小工具）
async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true }); // 建目标目录
  const entries = await readdir(src, { withFileTypes: true }); // 列出源
  for (const e of entries) { // 逐条目
    const s = join(src, e.name); // 源路径
    const d = join(dest, e.name); // 目标路径
    if (e.isDirectory()) await copyDir(s, d); // 目录递归
    else if (e.isFile()) await copyFile(s, d); // 文件复制
  }
}

// 递归搜索目录树下所有含 SKILL.md 的目录（自动搜索导入用；命中技能根后不再深入）
async function walkSkillDirs(root, depth, out) {
  if (depth < 0 || !existsSync(root)) return; // 深度耗尽或目录不存在
  if (existsSync(join(root, 'SKILL.md'))) { out.push(root); return; } // 命中技能根，收集后不再往下
  let entries = []; // 子项
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; } // 读失败跳过
  for (const e of entries) { // 逐子目录
    if (!e.isDirectory() || e.name.startsWith('.')) continue; // 只进普通目录
    await walkSkillDirs(join(root, e.name), depth - 1, out); // 递归
  }
}

// 列出可自动搜索导入的技能：Claude 插件市场缓存里、且未出现在任何扫描根中的技能
export async function listImportableSkills() {
  const pluginsDir = join(homedir(), '.claude', 'plugins', 'cache'); // 插件缓存根
  const dirs = []; // 命中的技能目录
  await walkSkillDirs(pluginsDir, 8, dirs); // 递归收集（8 层足够覆盖市场/插件/版本/目录结构）
  const rootNames = new Set(); // 已存在于扫描根的技能目录名（去重依据）
  for (const r of getSkillRoots()) { // 逐根收集
    if (!existsSync(r.path)) continue; // 不存在跳过
    for (const e of await readdir(r.path)) { // 列条目
      if (!e.startsWith('.')) rootNames.add(e); // 记名
    }
  }
  const out = []; // 结果
  const seenNames = new Set(); // 名称去重（不同市场同名技能只留第一个）
  for (const dir of dirs) { // 逐命中目录
    const name = basename(dir); // 目录名
    if (rootNames.has(name) || seenNames.has(name)) continue; // 已存在/已收录 → 跳过
    const meta = await readSkillMeta(dir).catch(() => null); // 解析元信息
    if (!meta) continue; // 无元信息跳过
    seenNames.add(name); // 记名去重
    out.push({ name: meta.name, dir, source: 'Claude 插件市场' }); // 组装摘要
  }
  return out; // 返回
}

// 导入已有技能：把外部目录复制进 $DSH_HOME/skills（dsh 扫描根）
export async function adoptSkill(external) {
  if (!external?.dir || !existsSync(external.dir)) throw new Error('技能目录不存在'); // 校验
  const name = basename(external.dir); // 目标名
  const target = join(getSkillsDir(), name); // 安装落点
  if (existsSync(target)) throw new Error(`技能 ${name} 已存在`); // 防覆盖
  await mkdir(getSkillsDir(), { recursive: true }); // 确保根目录
  await copyDir(external.dir, target); // 复制
}

// 切换启用/停用（移动文件夹进/出扫描根，chokidar 热生效）
export async function toggleSkill(id, enabled) {
  const all = await listSkills(); // 找目标
  const skill = all.find((s) => s.id === id); // 按 id 匹配
  if (!skill) throw new Error('技能不存在'); // 不存在报错
  if (skill.enabled === Boolean(enabled)) return; // 状态未变
  const target = join(enabled ? getSkillsDir() : getDisabledSkillsDir(), basename(skill.dir)); // 目标路径
  if (existsSync(target)) { // 重名冲突：旧实现直接 rename 抛系统错误，用户看不懂
    throw new Error(`目标位置已存在同名目录（${target}），请先处理重名后再操作`); // 明确提示
  }
  await mkdir(enabled ? getSkillsDir() : getDisabledSkillsDir(), { recursive: true }); // 确保目标根
  await rename(skill.dir, target); // 移动（同盘 rename 原子）
}

// 删除技能：仅限应用自己管理目录内的技能（$DSH_HOME/skills 与停用暂存目录）
// Claude Code 技能目录是只读展示、共享 agent 目录是外部资产，都不可删（防误删外部数据）
export async function deleteSkill(id) {
  const all = await listSkills(); // 找目标
  const skill = all.find((s) => s.id === id); // 按 id 匹配
  if (!skill) throw new Error('技能不存在'); // 不存在报错
  if (skill.source !== 'dsh 用户技能' && skill.source !== '已停用') { // 来源校验
    throw new Error('该技能来自外部目录，请到原目录处理'); // 只允许删自家安装的
  }
  await rm(skill.dir, { recursive: true, force: true }); // 删除整个技能目录（不可恢复）
}
