// IPC 通道名常量，主进程与渲染进程共用，避免两端手写字符串不一致

export const IPC = {
  // 面板窗口拉取整体状态快照（服务状态/版本/工作区列表）
  APP_GET_STATE: 'app:get-state',
  // 主进程推送状态变化（服务状态改变时）
  APP_STATE: 'app:state',
  // 面板点击工作区条目 → 打开目录
  WORKSPACE_OPEN: 'workspace:open',
  // boot 页"重试"按钮 → 重新拉起服务
  SERVICE_RETRY: 'service:retry',
  // boot 页 missing 态"选择 dsh 安装目录"按钮 → 弹目录选择器并写配置
  SETUP_PICK_DSH_DIR: 'setup:pick-dsh-dir',
  // boot 页 missing 态"帮我安装"按钮 → 自动检测 Node 并 npm 安装 dsh
  SETUP_AUTO_INSTALL: 'setup:auto-install',
  // boot 页"我已确认安装 Node.js"按钮 → 检测 Node 版本是否达标
  SETUP_CHECK_NODE: 'setup:check-node',
  // 引导页"进入工作台"按钮 → 写已读版本并切 Web UI
  GUIDE_ENTER: 'guide:enter',
  // 面板"使用说明"按钮 → 主窗口重新打开引导页
  GUIDE_OPEN: 'guide:open',
  // 用默认浏览器打开外部链接（如 Node.js 下载页）
  OPEN_EXTERNAL: 'app:open-external',
  // 选择皮肤图片并应用
  SKIN_SET: 'skin:set',
  // 恢复默认背景
  SKIN_CLEAR: 'skin:clear',
  // 调节皮肤透明度（0~100，实时生效）
  SKIN_OPACITY: 'skin:opacity',
  // 面板"测试通知"按钮
  NOTIFY_TEST: 'notify:test',
  // 面板"打开工作台"按钮 → 显示主窗口
  APP_OPEN_WEB_UI: 'app:open-web-ui',
  // 面板"重启服务"按钮
  SERVICE_RESTART: 'service:restart',
  // Skills 列表拉取
  SKILLS_LIST: 'skills:list',
  // Skill 开关切换（启用/停用）
  SKILL_TOGGLE: 'skills:toggle',
  // 安装 Skill（选目录或压缩包）
  SKILL_INSTALL: 'skills:install',
  // 扫描可自动导入的 Skill（Claude 插件市场缓存）
  SKILLS_IMPORT: 'skills:import',
  // 导入搜索到的 Skill（复制进 dsh 扫描根）
  SKILLS_ADOPT: 'skills:adopt',
  // MCP 列表拉取
  MCP_LIST: 'mcp:list',
  // MCP 开关切换
  MCP_TOGGLE: 'mcp:toggle',
  // 添加 MCP（stdio 或 streamable-http）
  MCP_ADD: 'mcp:add',
  // 删除 MCP
  MCP_REMOVE: 'mcp:remove',
  // 扫描可导入的外部 MCP
  MCP_IMPORT: 'mcp:import',
  // 收编外部 MCP
  MCP_ADOPT: 'mcp:adopt',
  // 手动检查更新（APP 与 dsh 本体一起查）
  UPDATER_CHECK: 'updater:check',
  // 用户确认下载 APP 更新
  UPDATER_DOWNLOAD: 'updater:download',
  // 用户确认更新 dsh 本体
  UPDATER_DSH_UPDATE: 'updater:dsh-update',
  // 更新状态推送（发现新版/下载中/已是最新）
  UPDATER_STATE: 'updater:state'
};
