// 应用配置模块：electron-store 持久化，全部可配置项集中在这里，避免硬编码

import Store from 'electron-store'; // 本地 JSON 配置存储（存于 userData/config.json）

// 默认 dsh 安装目录（用户机器上的实际位置，可被配置覆盖）
const DEFAULT_DSH_DIR = 'D:\\deepseek-harness';
// 默认 dsh 数据目录（环境变量 DSH_HOME 优先，其次用此默认值）
const DEFAULT_DSH_HOME = 'D:\\deepseek-harness\\home';

// 创建配置存储实例
const store = new Store({
  projectName: 'dsh-desktop', // 配置文件名（electron-store 11 必填）
  // 默认配置项
  defaults: {
    port: 3080, // dsh Web UI 端口
    dshDir: DEFAULT_DSH_DIR, // dsh 安装目录
    dshHome: process.env.DSH_HOME || DEFAULT_DSH_HOME, // dsh 数据目录
    stopOnQuit: true, // 托盘退出时是否停止"自己托管"的服务
    deepLink: 'off' // 深链模式：off=始终打开目录；预留 auto 供日后切换
  }
});

// 读取单个配置项
export function getConfig(key) {
  return store.get(key); // 返回配置值
}

// 写入单个配置项
export function setConfig(key, value) {
  store.set(key, value); // 持久化到 userData
}

// 获取完整配置对象（面板显示用）
export function getAllConfig() {
  return store.store; // 返回底层配置对象
}

// 计算 dsh CLI 入口文件的绝对路径（node_modules 下官方 bin 入口）
export function getDshCliEntry() {
  const dshDir = getConfig('dshDir'); // 读 dsh 安装目录
  return `${dshDir}\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js`; // 官方 package.json 的 bin 路径
}

// 计算 web profile 的 cordis.patch.yml 路径（MCP 管理写入位置）
export function getCordisPatchPath() {
  const dshHome = getConfig('dshHome'); // 读数据目录
  return `${dshHome}\\profiles\\web\\cordis.patch.yml`; // web profile 的用户补丁层
}

// 计算 workspace.json 路径（工作区列表数据源）
export function getWorkspaceJsonPath() {
  const dshHome = getConfig('dshHome'); // 读数据目录
  return `${dshHome}\\storages\\workspace.json`; // dsh 的工作区存储文件
}

// 计算技能安装根目录（$DSH_HOME/skills，dsh-skill-filesystem 的扫描根之一）
export function getSkillsDir() {
  const dshHome = getConfig('dshHome'); // 读数据目录
  return `${dshHome}\\skills`; // 用户级技能目录
}

// 计算已停用技能目录（移出扫描根即视为停用）
export function getDisabledSkillsDir() {
  const dshHome = getConfig('dshHome'); // 读数据目录
  return `${dshHome}\\skills-disabled`; // 不被 dsh 扫描的暂存目录
}
