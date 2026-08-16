// 皮肤模块：把用户自定义图片注入 dsh 工作台背景
// 注入方式：executeJavaScript 插入 <style id="dsh-skin-style"> 标签（清除时删除该元素，100% 可控）
// 大图自动压缩：nativeImage 读入 → 最长边缩到 2560 → 转 JPEG(85) → base64 data URL

import { readFile } from 'node:fs/promises'; // 读图片文件
import { existsSync } from 'node:fs'; // 存在性检查
import { nativeImage } from 'electron'; // 图片解码/缩放/编码（Electron 内置）
import { getConfig } from './config.js'; // 配置读取

// 支持的图片扩展名
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
// 原图文件大小上限（压缩前；游戏 4K 截图可达 30MB+，压缩后仅几百 KB）
const MAX_RAW_BYTES = 100 * 1024 * 1024;
// 压缩目标：最长边像素（4K 截图压到 2560 足够作背景）
const MAX_SIDE_PX = 2560;
// 压缩质量（JPEG 85 视觉无损，体积小）
const JPEG_QUALITY = 85;
// 注入的 style 元素 id（清除时按 id 删除）
const STYLE_ID = 'dsh-skin-style';

// 校验皮肤图片文件是否可用
export function isValidSkinImage(path) {
  if (typeof path !== 'string' || !path) return false; // 空路径
  if (!IMAGE_EXTS.some((ext) => path.toLowerCase().endsWith(ext))) return false; // 扩展名不符
  return existsSync(path); // 文件存在
}

// 读图并压缩转 base64 data URL（大图自动缩放转 JPEG，防超大 CSS 卡死界面）
async function imageToDataUrl(imagePath) {
  const buf = await readFile(imagePath); // 读文件
  if (buf.length > MAX_RAW_BYTES) throw new Error('图片文件过大（超过 100MB）'); // 原图上限
  let image = nativeImage.createFromPath(imagePath); // Electron 解码
  if (image.isEmpty()) throw new Error('无法解析该图片文件'); // 解码失败（损坏/格式异常）
  const { width, height } = image.getSize(); // 原始尺寸
  const maxSide = Math.max(width, height); // 最长边
  if (maxSide > MAX_SIDE_PX) { // 超大图等比缩小
    const ratio = MAX_SIDE_PX / maxSide; // 缩放比
    image = image.resize({ width: Math.round(width * ratio), height: Math.round(height * ratio), quality: 'good' }); // 缩放
  }
  // GIF 保持动图（toPNG 会丢动画；大小本来就可控）
  const isGif = imagePath.toLowerCase().endsWith('.gif');
  const data = isGif ? buf : image.toJPEG(JPEG_QUALITY); // GIF 用原文件，其余统一转 JPEG
  const mime = isGif ? 'image/gif' : 'image/jpeg'; // MIME
  return `data:${mime};base64,${data.toString('base64')}`; // data URL
}

// 生成背景注入脚本（style 标签 + body::before 固定层 + 透明度）
function buildSkinScript(dataUrl) {
  // 皮肤透明度（config 存 0~100，默认 100）
  const raw = Number(getConfig('skinOpacity'));
  const opacity = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) / 100 : 1; // 换算 0~1
  const css = `body {
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
}`; // 背景独立层，透明度只影响背景
  // 先删旧 style 再插入新的（幂等切换）
  return `(() => {
  const old = document.getElementById('${STYLE_ID}');
  if (old) old.remove();
  const style = document.createElement('style');
  style.id = '${STYLE_ID}';
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
})()`;
}

// 给主窗口注入当前皮肤（页面每次加载后需重新注入；重复调用幂等）
export async function applySkin(win) {
  if (!win || win.isDestroyed()) return; // 窗口无效
  const imagePath = getConfig('skinImage'); // 当前皮肤路径
  if (!isValidSkinImage(imagePath)) { // 无皮肤或文件失效 → 清掉残留注入
    await clearSkin(win); // 确保干净
    return;
  }
  try {
    const dataUrl = await imageToDataUrl(imagePath); // 读图压缩转 base64
    await win.webContents.executeJavaScript(buildSkinScript(dataUrl), true); // 注入 style 标签
  } catch (err) {
    throw new Error(`应用皮肤失败：${err?.message ?? err}`); // 把错误抛给 IPC（面板提示）
  }
}

// 清除当前窗口的皮肤注入（删除 style 标签，立即生效）
export async function clearSkin(win) {
  if (!win || win.isDestroyed()) return; // 窗口无效
  try {
    await win.webContents.executeJavaScript(`document.getElementById('${STYLE_ID}')?.remove();`, true); // 删除注入标签
  } catch { /* 页面未加载等异常忽略 */ }
}
