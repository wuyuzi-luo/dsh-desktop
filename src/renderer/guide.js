// 使用说明引导页脚本：点击"进入工作台"→ 主进程记录已读版本并跳转 Web UI
// 首次启动（或升级后首次）主进程会加载本页替代直接进 Web UI

const enterBtn = document.getElementById('enter'); // 进入工作台按钮

// 点击进入：主进程写 guideSeenVersion 并把主窗口切到 dsh Web UI
enterBtn.addEventListener('click', async () => {
  enterBtn.disabled = true; // 防重复点击
  enterBtn.textContent = '正在进入…'; // 立即反馈
  await window.dshDesktop.enterWorkbench(); // 调主进程（写已读 + 跳转）
});
