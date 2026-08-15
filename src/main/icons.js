// 图标模块：优先使用 DeepSeek 官方鲸鱼 logo（从本机 dsh 安装目录的 favicon.svg 提取路径），
// 蓝底白鲸组合成 dataURL（托盘/通知图标运行时光栅化，无需打包二进制资源）

import { readFileSync, existsSync } from 'node:fs'; // 同步读文件
import { getConfig } from './config.js'; // 读 dsh 安装目录配置

// DeepSeek 品牌蓝（官网主色）
const DEEPSEEK_BLUE = '#4D6BFE';

// 从 dsh 安装目录读取官方 favicon.svg 的鲸鱼路径数据（提取第一个 path 的 d 属性）
function loadOfficialWhalePath() {
  try {
    const faviconPath = `${getConfig('dshDir')}\\node_modules\\@deepseek-ai\\dsh-web-frontend\\dist\\favicon.svg`; // 官方前端产物
    if (!existsSync(faviconPath)) return null; // 不存在 → 回退
    const svg = readFileSync(faviconPath, 'utf8'); // 读文件
    const m = svg.match(/<path[^>]*\sd="([^"]+)"/); // 提取 path d 属性
    return m ? m[1] : null; // 返回路径数据或 null
  } catch {
    return null; // 任何异常 → 回退
  }
}

// 缓存官方路径（进程内只读一次）
const OFFICIAL_PATH = loadOfficialWhalePath();

// 鲸鱼 SVG（官方 logo：蓝底圆角方 + 白色鲸鱼；无官方素材时用自绘卡通鲸鱼兜底）
function buildWhaleSvg() {
  if (OFFICIAL_PATH) { // 官方路径可用
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect x="0" y="0" width="200" height="200" rx="44" fill="${DEEPSEEK_BLUE}"/>
  <path d="${OFFICIAL_PATH}" fill="#ffffff" transform="translate(75 75) scale(2)"/>
</svg>`; // 官方白鲸居中放大 2 倍（50x50 → 100x100）
  }
  // 兜底：自绘卡通鲸鱼（与 boot 页同款，蓝底圆角方）
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150">
  <defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7D9AFF"/><stop offset="1" stop-color="#4D6BFE"/>
  </linearGradient></defs>
  <rect x="0" y="0" width="200" height="150" rx="30" fill="#10182b"/>
  <path d="M102 26 Q98 8 86 4 M102 26 Q102 4 104 0 M104 26 Q110 10 120 8" stroke="#7D9AFF" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M42 66 C42 26 92 16 132 28 C168 38 182 60 172 82 C163 103 112 114 72 107 C52 102 42 85 42 66 Z" fill="url(#w)"/>
  <path d="M44 62 Q22 44 6 54 Q26 68 46 74 Z" fill="#4D6BFE"/>
  <path d="M46 76 Q26 94 8 86 Q30 70 44 64 Z" fill="#4D6BFE"/>
  <path d="M108 96 Q124 116 144 114 Q126 96 108 88 Z" fill="#3a54d6" opacity="0.9"/>
  <path d="M76 96 Q110 112 152 98 Q118 110 84 103 Z" fill="#A8BCFF" opacity="0.55"/>
  <circle cx="138" cy="56" r="5.5" fill="#10182b"/>
  <circle cx="140" cy="54" r="1.8" fill="#ffffff"/>
  <path d="M124 76 Q136 86 150 78" stroke="#10182b" stroke-width="2.5" fill="none" stroke-linecap="round"/>
</svg>`;
}

// 把 SVG 编码为 dataURL（nativeImage.createFromDataURL 可直接光栅化）
export function getWhaleDataUrl() {
  const b64 = Buffer.from(buildWhaleSvg(), 'utf8').toString('base64'); // base64 编码
  return `data:image/svg+xml;base64,${b64}`; // 拼 dataURL
}

// 按服务状态给托盘图标上色的变体（运行=蓝、错误=红、停止=灰）
export function getStatusTint(state) {
  if (state === 'error') return '#e5484d'; // 错误红
  if (state === 'running') return '#4D6BFE'; // 科技蓝
  return '#6b7280'; // 停止灰
}

// 托盘图标：官方鲸鱼剪影（白）套状态色圆角底（16x16 可辨识）
export function getTraySvg(state) {
  const color = getStatusTint(state); // 状态色
  if (OFFICIAL_PATH) { // 官方剪影
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="${color}"/>
  <path d="${OFFICIAL_PATH}" fill="#ffffff" transform="translate(7 7)"/>
</svg>`; // 官方鲸鱼居中（50x50 → 占用 7..57）
  }
  // 兜底：单色自绘鲸鱼剪影
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M14 34 Q14 24 26 22 Q38 20 46 26 Q52 30 52 36 Q52 42 44 44 Q34 46 24 42 Q14 38 14 34 Z" fill="${color}"/>
  <path d="M24 40 Q18 36 12 40 Q18 44 24 42 Z" fill="${color}"/>
  <circle cx="38" cy="30" r="3" fill="#ffffff"/>
</svg>`;
}
