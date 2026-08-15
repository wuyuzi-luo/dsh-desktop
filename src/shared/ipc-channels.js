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
  // 手动检查更新
  UPDATER_CHECK: 'updater:check',
  // 更新状态推送（发现新版/下载中/已是最新）
  UPDATER_STATE: 'updater:state'
};
