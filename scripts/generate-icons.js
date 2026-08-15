// 图标自举脚本（纯 Node 版）：读取 dsh 安装目录的官方 DeepSeek 鲸鱼 logo SVG，
// 用 sharp 渲染成多档 PNG 后合成 build/icon.ico（不再依赖 Electron 渲染，避免卡死）
// 运行方式：npm run icons（node scripts/generate-icons.js）

import sharp from 'sharp'; // SVG → PNG 渲染（内置 librsvg）
import { writeFile, mkdir, readFile } from 'node:fs/promises'; // 异步文件操作
import { existsSync } from 'node:fs'; // 存在性检查
import { join, dirname } from 'node:path'; // 路径
import { fileURLToPath } from 'node:url'; // ESM 路径解析
import pngToIco from 'png-to-ico'; // PNG 合成 ICO

// 项目根目录（scripts 的上一级）
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 默认 dsh 安装目录（可用环境变量 DSH_DESKTOP_DSH_DIR 覆盖）
const DSH_DIR = process.env.DSH_DESKTOP_DSH_DIR || 'D:\\deepseek-harness';

// 从 dsh 前端产物读取官方鲸鱼路径数据
async function loadOfficialPath() {
  const faviconPath = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'favicon.svg'); // 官方前端 favicon
  if (!existsSync(faviconPath)) return null; // 不存在 → null
  const svg = await readFile(faviconPath, 'utf8'); // 读文件
  const m = svg.match(/<path[^>]*\sd="([^"]+)"/); // 提取 path d 属性
  return m ? m[1] : null; // 路径数据或 null
}

// 构建 512x512 图标 SVG（DeepSeek 蓝底圆角方 + 官方白鲸；无官方素材用自绘鲸鱼兜底）
function buildIconSvg(officialPath) {
  if (officialPath) { // 官方 logo
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" rx="110" fill="#4D6BFE"/>
  <path d="${officialPath}" fill="#ffffff" transform="translate(128 128) scale(5.12)"/>
</svg>`; // 官方鲸鱼居中放大（50x50 → 256x256 居中）
  }
  // 兜底：自绘卡通鲸鱼
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7D9AFF"/><stop offset="1" stop-color="#4D6BFE"/>
  </linearGradient></defs>
  <rect x="0" y="0" width="512" height="512" rx="110" fill="#10182b"/>
  <g transform="translate(28 110) scale(2.28)">
    <path d="M102 26 Q98 8 86 4" stroke="#7D9AFF" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M102 26 Q102 4 104 0" stroke="#7D9AFF" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M104 26 Q110 10 120 8" stroke="#7D9AFF" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M42 66 C42 26 92 16 132 28 C168 38 182 60 172 82 C163 103 112 114 72 107 C52 102 42 85 42 66 Z" fill="url(#w)"/>
    <path d="M44 62 Q22 44 6 54 Q26 68 46 74 Z" fill="#4D6BFE"/>
    <path d="M46 76 Q26 94 8 86 Q30 70 44 64 Z" fill="#4D6BFE"/>
    <path d="M108 96 Q124 116 144 114 Q126 96 108 88 Z" fill="#3a54d6" opacity="0.9"/>
    <path d="M76 96 Q110 112 152 98 Q118 110 84 103 Z" fill="#A8BCFF" opacity="0.55"/>
    <circle cx="138" cy="56" r="5.5" fill="#10182b"/>
    <circle cx="140" cy="54" r="1.8" fill="#ffffff"/>
    <path d="M124 76 Q136 86 150 78" stroke="#10182b" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;
}

// 主流程
const official = await loadOfficialPath(); // 官方路径数据
console.log(official ? '使用官方 DeepSeek 鲸鱼 logo' : '官方 logo 不可用，使用自绘鲸鱼兜底'); // 提示来源

const svg = buildIconSvg(official); // 512 SVG
const sizes = [256, 128, 64, 48, 32, 16]; // ICO 多档尺寸
const pngPaths = []; // 临时 PNG 路径
const pngDir = join(ROOT, 'build', 'tmp'); // 临时目录
await mkdir(pngDir, { recursive: true }); // 确保存在

for (const size of sizes) { // 逐档渲染
  const p = join(pngDir, `icon-${size}.png`); // 目标路径
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer(); // sharp 渲染 SVG → PNG
  await writeFile(p, buf); // 写出
  pngPaths.push(p); // 记录
}
const ico = await pngToIco(pngPaths); // 合成 ICO
await writeFile(join(ROOT, 'build', 'icon.ico'), ico); // 写出最终图标（打包用）
await writeFile(join(ROOT, 'src', 'assets', 'icon.ico'), ico); // 同时放 src/assets（运行时窗口/通知图标用，随 src 打进安装包）
console.log('icon.ico 生成完成'); // 完成提示

// —— 托盘图标：Windows 托盘不支持 SVG 光栅化，预生成三色 PNG（32x32 白鲸+状态色底）——
const whalePathData = official || ''; // 官方路径（兜底时为空，用自绘剪影）
const trayTints = { running: '#4D6BFE', error: '#e5484d', stopped: '#6b7280' }; // 状态色表
for (const [state, tint] of Object.entries(trayTints)) { // 逐状态生成
  const traySvg = whalePathData
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="${tint}"/>
  <path d="${whalePathData}" fill="#ffffff" transform="translate(7 7)"/>
</svg>` // 官方鲸鱼 + 状态色圆角底
    : `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="${tint}"/>
  <path d="M14 34 Q14 24 26 22 Q38 20 46 26 Q52 30 52 36 Q52 42 44 44 Q34 46 24 42 Q14 38 14 34 Z" fill="#ffffff"/>
  <path d="M24 40 Q18 36 12 40 Q18 44 24 42 Z" fill="#ffffff"/>
</svg>`; // 兜底剪影
  const buf = await sharp(Buffer.from(traySvg)).resize(32, 32).png().toBuffer(); // 渲染 32x32 PNG
  await writeFile(join(ROOT, 'src', 'assets', `tray-${state}.png`), buf); // 写出（放 src/assets 以便打进安装包）
}
console.log('托盘三色 PNG 生成完成'); // 完成提示
