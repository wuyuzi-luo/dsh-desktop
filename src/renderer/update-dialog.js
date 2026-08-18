// 更新弹窗脚本：订阅主进程推送，渲染 确认/下载中/更新中/完成/暂不更新 五种视图
// 按钮点击通过 window.dshDesktop.updateDialogAction 回传主进程

// 各视图元素（phase → 视图切换）
const views = {
  confirm: document.getElementById('view-confirm'), // 确认页：发现新版本
  downloading: document.getElementById('view-downloading'), // 下载中：APP 安装包
  updating: document.getElementById('view-updating'), // 更新中：dsh 本体 npm 安装
  'app-done': document.getElementById('view-app-done'), // APP 更新完成：请重启
  'dsh-done': document.getElementById('view-dsh-done'), // dsh 更新完成
  deferred: document.getElementById('view-deferred'), // 暂不更新告知页
  'app-error': document.getElementById('view-error'), // APP 下载失败
  'dsh-error': document.getElementById('view-error') // dsh 更新失败
};

// 显示指定视图（其余全部隐藏）
function showView(phase) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== phase; // 逐个切换
}

// 处理主进程推送的弹窗内容
function render(payload) {
  const phase = payload?.phase ?? 'confirm'; // 目标视图
  showView(phase); // 切视图
  if (phase === 'confirm') { // 确认页：填充组件名/版本/更新内容
    document.getElementById('badge').textContent = payload.label ?? '组件'; // 徽标
    document.getElementById('confirmTitle').textContent = `已检测到 ${payload.label ?? ''} 有新版本`; // 标题
    document.getElementById('verCurrent').textContent = '当前 v' + (payload.current ?? '-'); // 当前版本
    document.getElementById('verLatest').textContent = '新版本 v' + (payload.latest ?? '-'); // 新版本
    document.getElementById('notes').textContent = payload.notes ?? ''; // 更新内容
  } else if (phase === 'downloading') { // 下载进度
    document.getElementById('dlBar').style.width = (payload.percent ?? 0) + '%'; // 进度条
    document.getElementById('dlPercent').textContent = (payload.percent ?? 0) + '%'; // 百分比
  } else if (phase === 'app-done') { // APP 完成：显示新版本号
    document.getElementById('appDoneVer').textContent = `新版本 v${payload.version ?? ''} 安装包已下载完成`; // 说明
  } else if (phase === 'dsh-done') { // dsh 完成：显示新版本号
    document.getElementById('dshDoneVer').textContent = `dsh 已更新到 v${payload.version ?? ''}，服务已重启`; // 说明
  } else if (phase === 'app-error') { // APP 下载失败
    document.getElementById('errorTitle').textContent = '安装包下载失败'; // 失败标题
  } else if (phase === 'dsh-error') { // dsh 更新失败
    document.getElementById('errorTitle').textContent = 'dsh 本体更新失败'; // 失败标题
  }
}

// 订阅主进程推送（弹窗内容全部由主进程驱动）
window.dshDesktop.onUpdateDialog((payload) => render(payload)); // 注册监听

// 顶部 ✕：直接关闭弹窗（主进程 closed 事件清引用）
document.getElementById('btnClose').addEventListener('click', () => window.close()); // 关闭

// 确认页按钮
document.getElementById('btnUpdate').addEventListener('click', () => { // 立即更新
  window.dshDesktop.updateDialogAction('update'); // 主进程执行下载/npm 更新
});
document.getElementById('btnLater').addEventListener('click', () => { // 暂不更新
  window.dshDesktop.updateDialogAction('later'); // 主进程切告知页
});

// 完成页按钮
document.getElementById('btnRestart').addEventListener('click', () => { // 立即重启（打开安装包+退出应用）
  window.dshDesktop.updateDialogAction('restart'); // 主进程处理
});
document.getElementById('btnLaterRestart').addEventListener('click', () => { // 稍后（可随时手动安装）
  window.dshDesktop.updateDialogAction('done'); // 关闭弹窗
});
document.getElementById('btnDone').addEventListener('click', () => { // dsh 完成页"完成"
  window.dshDesktop.updateDialogAction('done'); // 关闭弹窗
});
document.getElementById('btnGotIt').addEventListener('click', () => { // 告知页"知道了"
  window.dshDesktop.updateDialogAction('done'); // 关闭弹窗
});
document.getElementById('btnErrDone').addEventListener('click', () => { // 失败页"知道了"
  window.dshDesktop.updateDialogAction('done'); // 关闭弹窗
});
