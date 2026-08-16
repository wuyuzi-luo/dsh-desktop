# DeepSeek Harness 桌面

[DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/) 的 Windows 桌面管理壳：托盘常驻、一键托管本地 dsh 服务，提供工作区 / 技能(Skills) / MCP 管理面板，支持自动更新。

## 安装

1. 从 [Releases](https://github.com/wuyuzi-luo/dsh-desktop/releases) 下载最新 `dsh-desktop-setup-x.x.x.exe`。
2. 运行安装包，阅读并同意安装协议（安全提示与注意条款）。
3. 安装完成后启动应用，首次使用会显示应用内的《使用说明》引导页。

**环境要求**：Node.js 22.19+（推荐 24+）。首次启动检测不到 dsh 时，应用会提供三选项：**帮我安装**（自动通过 npm 安装 dsh）/ **选择已安装目录** / **取消**（自行安装后重试）。

详细使用说明见 [使用说明.md](使用说明.md)。

## 首次登录

进入工作台后，在页面内"模型"设置处填写您自己的 DeepSeek API Key。Key 仅保存在本机（DSH_HOME 目录下），不会上传。

## 功能

- 托盘常驻：关窗最小化到托盘，右键鲸鱼图标退出
- Ctrl+Shift+D 控制面板：工作区 / 技能 / MCP 管理（CC Switch 式开关）
- 服务托管：自动拉起 dsh，崩溃心跳检测与一键重启
- 自动更新：新版本发布后应用内提示更新
- 应用内使用说明引导页（首次启动 / 升级后自动显示，面板可随时查看）

## 注意事项

- 数据目录（默认 `D:\deepseek-harness\home`）包含 API Key 与聊天记录，请勿分享。
- 本软件为非官方工具，与 DeepSeek 官方无隶属关系。
