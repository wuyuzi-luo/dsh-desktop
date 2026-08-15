// 把官方 DeepSeek 鲸鱼 logo 注入 boot.html（一次性脚本，dsh 前端产物路径变更时可重跑）
const fs = require('fs'); // 文件读写
const path = require('path'); // 路径

// 官方 favicon 路径
const faviconPath = path.join('D:', path.sep, 'deepseek-harness', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'favicon.svg'); // 拼接官方前端产物路径
const favicon = fs.readFileSync(faviconPath, 'utf8'); // 读文件
const m = favicon.match(/<path[^>]*\sd="([^"]+)"/); // 提取 path d 属性
const whalePath = m ? m[1] : null; // 路径数据
if (!whalePath) { console.error('官方鲸鱼路径提取失败'); process.exit(1); } // 提取失败退出
console.log('官方鲸鱼路径已提取, 长度:', whalePath.length); // 提示

// 官方鲸鱼 SVG 块（boot 页主视觉：白鲸 + 呼吸动画保留在 CSS）
const whaleBlock = `<svg class="whale" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <!-- DeepSeek 官方鲸鱼 logo（提取自 dsh 前端产物 favicon.svg） -->
        <path d="${whalePath}" fill="#ffffff"/>
      </svg>`;

// 读取并替换 boot.html 里的旧鲸鱼 SVG（从 <svg class="whale" 到第一个 </svg>）
const bootFile = path.join(__dirname, '..', 'src', 'renderer', 'boot.html'); // boot 页路径
const boot = fs.readFileSync(bootFile, 'utf8'); // 读文件
const out = boot.replace(/<svg class="whale"[\s\S]*?<\/svg>/, whaleBlock); // 替换旧块
fs.writeFileSync(bootFile, out); // 写回
console.log('boot.html 已更新为官方鲸鱼'); // 完成提示
