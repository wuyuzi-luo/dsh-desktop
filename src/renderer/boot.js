// boot 页脚本：订阅主进程服务状态，驱动状态文案与重试按钮
// 服务就绪后主进程会自动把页面切到 dsh Web UI，这里只负责过渡期的展示

const statusEl = document.getElementById('status'); // 状态文案元素
const subEl = document.getElementById('sub'); // 副文案元素
const retryBtn = document.getElementById('retry'); // 重试按钮

// 按服务状态更新界面（running 时自己跳转到 Web UI，与主进程切页互为双保险）
function render(state, url) {
  if (state === 'starting') { // 启动中
    statusEl.textContent = '正在启动 dsh 服务…'; // 文案
    retryBtn.hidden = true; // 隐藏重试
  } else if (state === 'running') { // 运行中
    statusEl.textContent = '服务已就绪，正在进入工作台…'; // 文案
    retryBtn.hidden = true; // 隐藏重试
    if (url) { // 有服务地址则自己跳转（主进程切页可能因导航时机错过）
      setTimeout(() => { window.location.replace(url); }, 500); // 半秒后跳转
    }
  } else if (state === 'error') { // 错误
    statusEl.textContent = 'dsh 服务启动失败'; // 文案
    subEl.textContent = '请检查 dsh 安装或点击重试'; // 副文案
    retryBtn.hidden = false; // 显示重试
  } else { // stopped
    statusEl.textContent = 'dsh 服务已停止'; // 文案
    retryBtn.hidden = false; // 可重试
  }
}

// 订阅主进程推送
window.dshDesktop.onState((payload) => {
  if (payload && payload.type === 'service') render(payload.state, payload.url); // 服务状态变化 → 重绘
});

// 重试按钮：请求主进程重新拉起服务
retryBtn.addEventListener('click', () => {
  statusEl.textContent = '正在启动 dsh 服务…'; // 立即反馈
  retryBtn.hidden = true; // 隐藏按钮
  window.dshDesktop.retryService(); // 调主进程
});

// 初始拉取一次当前状态（防止错过推送）
window.dshDesktop.getState().then((snap) => {
  if (snap && snap.service) render(snap.service); // 渲染当前态
});
