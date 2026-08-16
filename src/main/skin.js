// 皮肤模块：把用户自定义图片注入 dsh 工作台背景
// 方案：图片转 base64 data URL 内嵌 CSS，经 webContents.insertCSS 注入
// （dsh 页面无 CSP 限制已验证；insertCSS 返回 key，可精确移除）

import { readFile } from 'node:fs/promises'; // 读图片文件
import { existsSync } from 'node:fs'; // 存在性检查
import { getConfig } from './config.js'; // 配置读取
import { setConfig } from './config.js'; // 配置写入（透明度设置）

// 支持的图片扩展名
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
// 单张图片大小上限（10MB，防超大图卡死界面）
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// 每个窗口当前注入的 CSS key（移除注入用）
const injectedKeys = new Map(); // window id → key

// 校验皮肤图片文件是否可用
export function isValidSkinImage(path) {
  if (typeof path !== 'string' || !path) return false; // 空路径
  if (!IMAGE_EXTS.some((ext) => path.toLowerCase().endsWith(ext))) return false; // 扩展名不符
  return existsSync(path); // 文件存在
}

// 生成背景注入 CSS（base64 data URL 内嵌到 body::before，透明层支持透明度调节）
async function buildSkinCss(imagePath) {
  const buf = await readFile(imagePath); // 读文件
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('图片超过 10MB，请换一张小一点的'); // 大小限制
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' // MIME 推断
    : imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg'
    : imagePath.toLowerCase().endsWith('.webp') ? 'image/webp'
    : imagePath.toLowerCase().endsWith('.gif') ? 'image/gif'
    : 'image/bmp';
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`; // 内嵌数据
  // 皮肤透明度（config 存 0~100，默认 100）
  const raw = Number(getConfig('skinOpacity'));
  const opacity = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) / 100 : 1; // 换算 0~1
  // 用 body::before 固定层承载背景：z-index -1 置于内容之下、body 背景之上，opacity 只影响背景不影响内容
  return `body {
  position: relative !important;
}
body::before {
  content: "";
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  background-image: url("${dataUrl}") !important;
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  opacity: ${opacity} !important;
  pointer-events: none !important;
}`;
}

// 给主窗口注入当前皮肤（页面每次加载后需重新注入）
export async function applySkin(win) {
  if (!win || win.isDestroyed()) return; // 窗口无效
  const imagePath = getConfig('skinImage'); // 当前皮肤路径
  // 先移除旧注入（同一窗口重复调用时防叠加）
  const oldKey = injectedKeys.get(win.id); // 旧 key
  if (oldKey) { try { win.webContents.removeInsertedCSS(oldKey); } catch { /* 已失效忽略 */ } injectedKeys.delete(win.id); }
  if (!isValidSkinImage(imagePath)) return; // 无皮肤或文件失效 → 保持默认
  try {
    const css = await buildSkinCss(imagePath); // 构建 CSS
    const key = await win.webContents.insertCSS(css, { cssOrigin: 'author' }); // 注入（author 层配合 !important）
    injectedKeys.set(win.id, key); // 记录 key
  } catch { /* 注入失败静默（图片损坏等） */ }
}

// 清除当前窗口的皮肤注入
export function clearSkin(win) {
  if (!win || win.isDestroyed()) return; // 窗口无效
  const key = injectedKeys.get(win.id); // 已注入的 key
  if (key) { try { win.webContents.removeInsertedCSS(key); } catch { /* 已失效忽略 */ } injectedKeys.delete(win.id); } // 移除
}
