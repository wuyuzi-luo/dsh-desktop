# DeepSeek Harness 桌面

[DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/) 的 Windows 桌面管理壳：托盘常驻、一键托管本地 dsh 服务，提供工作区 / Skills / MCP 管理面板、自定义皮肤、自动更新（APP 与 dsh 本体）。

## ✨ 功能

### 核心体验
- **一键启动**：双击即自动拉起 dsh 服务并进入工作台，关闭窗口最小化到托盘（蓝色鲸鱼 = 运行中，红色 = 服务异常）
- **小白引导**：首次启动显示《使用说明》引导页；检测不到 dsh 时提供三选项——**帮我安装**（自动检测 Node 环境并 npm 安装，缺 Node 附官网下载链接）/ **选择已安装目录** / **取消自己装**
- **自动更新**：每次启动检查 APP 与 dsh 本体新版本，发现后弹通知提示，确认后才下载/安装
- **🎨 换皮肤**：自定义工作台背景图片（4K 游戏截图等大图自动压缩），透明度实时调节，切换立即生效
- **桌面通知**：AI 回合开始/完成、审批请求、服务异常实时推送

### 控制面板（Ctrl+Shift+D）
dsh 设置页同款深空蓝调设计，左侧导航五项：

| 页签 | 功能 |
|---|---|
| 🗂 工作区 | 会话列表，一键在资源管理器中打开目录 |
| 🧩 Skills | 开关管理、手动安装（文件夹/zip）、**自动搜索导入**（扫描插件市场缓存，带筛选） |
| 🔌 MCP | 开关管理、手动添加（stdio / streamable-http）、**一键收编 Claude Code 已配置的 MCP** |
| 🎨 皮肤 | 背景图片选择、透明度滑块（实时）、恢复默认 |
| ❓ 使用说明 | 快速上手与数据安全要点 |

## 📦 安装

1. 从 [Releases](https://github.com/wuyuzi-luo/dsh-desktop/releases/latest) 下载 `dsh-desktop-setup-x.x.x.exe`。
2. 运行安装包，阅读并同意安装协议（安全提示与注意条款），可自选安装位置。
3. 启动应用：首次会显示使用说明引导页 → 按引导完成 dsh 安装（或自动安装）→ 登录自己的 API Key。

**环境要求**：Node.js 22.19+（推荐 24+）。未安装时应用内会提示并附官网下载链接。

详细使用说明见 [使用说明.md](使用说明.md)。

## 🔐 首次登录

进入工作台后，在页面内"模型"设置处填写**您自己的** DeepSeek API Key。Key 仅保存在本机（DSH_HOME 目录下），不会上传。

## ⚠️ 注意事项

- 数据目录（默认 `D:\deepseek-harness\home`）包含 API Key 与聊天记录，**请勿分享**。
- 本软件为非官方工具，与 DeepSeek 官方无隶属关系。
- 截图等临时文件存于系统 TEMP，清理磁盘后旧会话中的图片可能失效。

## 🛠 开发

```bash
npm run dev    # 开发模式启动
npm run icons  # 生成图标资源
npm run dist   # 打包 NSIS 安装包（需 NODE_TLS_REJECT_UNAUTHORIZED=0）
```
