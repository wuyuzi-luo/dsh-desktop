// boot 页脚本：订阅主进程服务状态，驱动状态文案与按钮
// missing 态提供三选项：帮我安装 / 选择已安装目录 / 取消（自己装）
// 服务就绪后主进程会自动把页面切到 dsh Web UI，这里只负责过渡期的展示

const statusEl = document.getElementById('status'); // 状态文案元素
const subEl = document.getElementById('sub'); // 副文案元素
const retryBtn = document.getElementById('retry'); // 重试按钮
const setupEl = document.getElementById('setup'); // missing 三选项容器
const installBtn = document.getElementById('install-dsh'); // 帮我安装按钮
const pickDirBtn = document.getElementById('pick-dir'); // 选择已安装目录按钮
const cancelBtn = document.getElementById('cancel-setup'); // 取消按钮
const logEl = document.getElementById('install-log'); // 安装日志框
const nodeLink = document.getElementById('node-link'); // Node.js 下载链接（need-node 时显示）
const nodeHint = document.getElementById('node-hint'); // Node.js 前置条件提示行
const confirmNodeBtn = document.getElementById('confirm-node'); // "我已确认安装 Node.js"按钮
const setupBtns = document.getElementById('setup-btns'); // 三选项容器（确认 Node 后显示）

// 设置三选项按钮可用性（安装期间禁用防重复点击）
function setSetupEnabled(enabled) {
  for (const b of [installBtn, pickDirBtn, cancelBtn]) b.disabled = !enabled; // 统一切换
}

// 追加一行安装日志并滚到底部
function appendLog(line) {
  logEl.hidden = false; // 显示日志框
  logEl.textContent += (logEl.textContent ? '\n' : '') + line; // 追加行
  logEl.scrollTop = logEl.scrollHeight; // 自动滚到最新
}

// 按服务状态更新界面（running 时自己跳转到 Web UI，与主进程切页互为双保险）
function render(state, url) {
  setupEl.hidden = true; // 默认隐藏三选项
  retryBtn.hidden = true; // 默认隐藏重试
  logEl.hidden = true; // 默认隐藏日志
  nodeLink.hidden = true; // 默认隐藏下载链接
  if (state === 'starting') { // 启动中
    statusEl.textContent = '正在启动 dsh 服务…'; // 文案
  } else if (state === 'running') { // 运行中
    statusEl.textContent = '服务已就绪，正在进入工作台…'; // 文案
    if (url) { // 有服务地址则自己跳转（主进程切页可能因导航时机错过）
      setTimeout(() => { window.location.replace(url); }, 500); // 半秒后跳转
    }
  } else if (state === 'missing') { // 未找到 dsh 安装（CLI 入口不存在）
    statusEl.textContent = '未识别到用户已安装 DeepSeek Harness（dsh）'; // 文案
    subEl.textContent = '请先确认 Node.js 环境，再选择安装方式'; // 引导说明
    setupEl.hidden = false; // 显示引导区
    nodeHint.hidden = false; // 显示 Node.js 提示
    confirmNodeBtn.hidden = false; // 显示确认按钮
    setupBtns.hidden = true; // 三选项先隐藏（确认 Node 后才放出，避免小白搞混）
    setSetupEnabled(true); // 恢复按钮可用
  } else if (state === 'error') { // 错误
    statusEl.textContent = 'dsh 服务异常'; // 文案
    subEl.textContent = '请完全退出应用（托盘鲸鱼图标右键 → 退出）后重新进入一次；仍异常可点击重试'; // 副文案
    retryBtn.hidden = false; // 显示重试
  } else { // stopped
    statusEl.textContent = 'dsh 服务已停止'; // 文案
    retryBtn.hidden = false; // 可重试
  }
}

// 订阅主进程推送
window.dshDesktop.onState((payload) => {
  if (!payload) return; // 空载荷忽略
  if (payload.type === 'service') { // 服务状态变化 → 重绘
    render(payload.state, payload.url);
  } else if (payload.type === 'setup') { // 自动安装进度
    if (payload.phase === 'start' || payload.phase === 'line') { // 开始/日志行
      if (payload.phase === 'start') { logEl.textContent = ''; } // 开始时清空旧日志
      appendLog(payload.text); // 追加显示
    } else if (payload.phase === 'error') { // 安装失败
      subEl.textContent = payload.text; // 副文案展示失败原因（日志保留供查看）
      if (payload.text.includes('Node.js')) nodeLink.hidden = false; // 缺 Node 时显示下载链接
    } else if (payload.phase === 'done') { // 安装完成
      statusEl.textContent = payload.text; // 更新主文案
    }
  }
});

// 重试按钮：请求主进程重新拉起服务；仍缺 dsh 时恢复三选项
retryBtn.addEventListener('click', async () => {
  statusEl.textContent = '正在启动 dsh 服务…'; // 立即反馈
  retryBtn.hidden = true; // 隐藏按钮
  const result = await window.dshDesktop.retryService(); // 调主进程
  if (result === 'missing') render('missing'); // 仍然缺 dsh → 重新显示三选项
});

// "我已确认安装 Node.js"按钮：系统自动检测，达标才放出三选项
confirmNodeBtn.addEventListener('click', async () => {
  confirmNodeBtn.disabled = true; // 防重复点击
  confirmNodeBtn.textContent = '正在检测…'; // 反馈
  const result = await window.dshDesktop.checkNode(); // 调主进程检测
  confirmNodeBtn.textContent = '我已确认安装 Node.js'; // 恢复文案
  confirmNodeBtn.disabled = false; // 恢复可用
  if (result && result.ok) { // 检测通过
    nodeHint.hidden = true; // 收起提示
    confirmNodeBtn.hidden = true; // 收起确认按钮
    setupBtns.hidden = false; // 放出三选项
    subEl.textContent = `✅ 已检测到 Node.js v${result.version}，请选择安装方式`; // 确认反馈
  } else { // 未检测到
    subEl.textContent = '❌ 未检测到 Node.js（需要 22.19+ 或 24+），请先安装后再点确认'; // 提示先装
  }
});

// 取消按钮：用户打算自己安装 dsh，收起三选项只留重试
cancelBtn.addEventListener('click', () => {
  setupEl.hidden = true; // 收起选项
  subEl.textContent = '请安装 dsh 后点击重试'; // 换引导文案
  retryBtn.hidden = false; // 留重试
});

// 选择已安装目录按钮：主进程弹目录选择器 → 校验 → 写配置 → 自动重试
pickDirBtn.addEventListener('click', async () => {
  const result = await window.dshDesktop.pickDshDir(); // 调主进程（弹框）
  if (!result) return; // 无返回（异常）维持现状
  if (result.canceled) return; // 用户取消选择
  if (result.error) { // 所选目录无效
    subEl.textContent = result.error; // 副文案展示具体原因，可再次点击重选
    return;
  }
  setupEl.hidden = true; // 成功：收起选项
  statusEl.textContent = '正在启动 dsh 服务…'; // 立即反馈
  // 主进程 restart 会推送 starting/running 状态，本页自动更新
});

// 帮我安装按钮：主进程自动检测 Node → npm 安装 dsh → 校验 → 写配置 → 重启
installBtn.addEventListener('click', async () => {
  setSetupEnabled(false); // 安装期间禁用全部选项
  subEl.textContent = '正在检测环境…'; // 立即反馈
  const result = await window.dshDesktop.autoInstallDsh(); // 调主进程（期间进度经 setup 事件推送）
  if (!result) { // 异常（理论上不会发生）
    setSetupEnabled(true); // 恢复按钮
    return;
  }
  if (result.error) { // 安装失败
    subEl.textContent = (result.error === 'need-node') // 按错误码给文案
      ? '未检测到可用的 Node.js（需要 22.19+ 或 24+）。请先安装 Node.js 后重试'
      : (result.error === 'busy' ? '安装正在进行中，请稍候' : '安装失败，请检查网络后重试');
    if (result.error === 'need-node') nodeLink.hidden = false; // 缺 Node：显示官网下载链接
    if (result.log) appendLog(result.log); // 有尾部日志则展示
    setSetupEnabled(true); // 恢复按钮可再次尝试
    return;
  }
  setupEl.hidden = true; // 成功：收起选项（后续状态由服务推送驱动）
  logEl.hidden = true; // 隐藏日志
});

// Node.js 下载链接：默认浏览器打开官网（小白一键安装）
nodeLink.addEventListener('click', () => {
  window.dshDesktop.openExternal('https://nodejs.org/zh-cn/download'); // 中文官网下载页
});

// 三选项界面里的 Node.js 提示链接（与上方独立链接同行为）
const nodeHintLink = document.getElementById('node-hint-link'); // 提示行内链接
nodeHintLink.addEventListener('click', () => {
  window.dshDesktop.openExternal('https://nodejs.org/zh-cn/download'); // 中文官网下载页
});

// 初始拉取一次当前状态（防止错过推送）
window.dshDesktop.getState().then((snap) => {
  if (snap && snap.service) render(snap.service); // 渲染当前态
});
