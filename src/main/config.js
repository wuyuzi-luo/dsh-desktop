// 应用配置模块：electron-store 持久化，全部可配置项集中在这里，避免硬编码

import Store from 'electron-store'; // 本地 JSON 配置存储（存于 userData/config.json）
import { existsSync } from 'node:fs'; // 文件存在性检查（校验 dsh 安装目录用）

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
    deepLink: 'off', // 深链模式：off=始终打开目录；预留 auto 供日后切换
    guideSeenVersion: '', // 已看过使用说明引导的版本号（与当前版本不同则启动时显示引导页）
    skinImage: '', // 皮肤背景图片路径（空 = 默认背景；设置后注入 dsh 工作台）
    skinOpacity: 100, // 皮肤背景透明度（0~100，默认 100 完全不透明）
    updateRegistry: 'mirror' // dsh 本体更新源偏好：mirror=国内镜像(快) / official=官方源（弹窗内可改，记住上次选择）
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

// 计算指定目录下 dsh CLI 入口文件的绝对路径（node_modules 下官方 bin 入口）
export function resolveDshBin(dir) {
  return `${dir}\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js`; // 官方 package.json 的 bin 路径
}

// 计算当前配置下 dsh CLI 入口文件的绝对路径
export function getDshCliEntry() {
  return resolveDshBin(getConfig('dshDir')); // 用当前配置的安装目录拼路径
}

// 判断某目录是否为有效 dsh 安装目录（CLI 入口文件存在才算）
export function isValidDshDir(dir) {
  return typeof dir === 'string' && dir.length > 0 && existsSync(resolveDshBin(dir)); // 非空且 bin.js 存在
}

// 写入 dsh 安装目录；dshHome 未显式配置且无 DSH_HOME 环境变量时默认跟随新目录
export function setDshDir(dir) {
  setConfig('dshDir', dir); // 持久化新安装目录
  if (!store.has('dshHome') && !process.env.DSH_HOME) { // 数据目录从未被用户显式设置
    setConfig('dshHome', `${dir}\\home`); // 跟随为 <dsh 目录>\home（新装的 dsh 用新 home）
  }
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
