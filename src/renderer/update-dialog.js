// 更新弹窗脚本：订阅主进程推送，渲染 确认/下载中/更新中/完成/暂不更新/失败 六种视图
// 底部按钮行按视图切换显隐与文案，点击通过 window.dshDesktop.updateDialogAction 回传主进程

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

// 底部按钮元素
const btnLater = document.getElementById('btnLater'); // 暂不更新（确认页）
const btnLaterRestart = document.getElementById('btnLaterRestart'); // 稍后（APP 完成页）
const btnUpdate = document.getElementById('btnUpdate'); // 主按钮（文案随视图变化）

// 显示指定视图（其余全部隐藏）
function showView(phase) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== phase; // 逐个切换
}

// 按视图配置底部按钮：显隐 + 主按钮文案
function renderActions(phase) {
  btnLater.hidden = true; // 默认全隐藏
  btnLaterRestart.hidden = true; // 默认全隐藏
  btnUpdate.hidden = true; // 默认全隐藏
  if (phase === 'confirm') { // 确认页：暂不更新 + 立即更新
    btnLater.hidden = false; // 显示暂不更新
    btnUpdate.hidden = false; // 显示立即更新
    btnUpdate.textContent = '立即更新'; // 主按钮文案
  } else if (phase === 'app-done') { // APP 完成：稍后 + 立即重启
    btnLaterRestart.hidden = false; // 显示稍后
    btnUpdate.hidden = false; // 显示立即重启
    btnUpdate.textContent = '立即重启'; // 主按钮文案
  } else if (phase === 'dsh-done') { // dsh 完成：完成
    btnUpdate.hidden = false; // 显示完成
    btnUpdate.textContent = '完成'; // 主按钮文案
  } else if (phase === 'deferred' || phase === 'app-error' || phase === 'dsh-error') {
    // 告知页/失败页：知道了
    btnUpdate.hidden = false; // 显示知道了
    btnUpdate.textContent = '知道了'; // 主按钮文案
  }
  // 下载中/更新中：无按钮（进度由主进程自动接续）
}

// 处理主进程推送的弹窗内容
function render(payload) {
  const phase = payload?.phase ?? 'confirm'; // 目标视图
  showView(phase); // 切视图
  renderActions(phase); // 切按钮
  if (phase === 'confirm') { // 确认页：填充组件名/版本/更新内容
    document.getElementById('headTitle').textContent = payload.label ?? '更新提示'; // 标题栏
    document.getElementById('confirmTitle').textContent = `已检测到 ${payload.label ?? ''} 有新版本`; // 主标题
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

// 顶部 ✕：直接关闭弹窗（主进程 closed 事件会清引用并弹队列中的下一个）
document.getElementById('btnClose').addEventListener('click', () => window.close()); // 关闭

// 底部按钮动作（按当前视图语义回传）
btnLater.addEventListener('click', () => { // 确认页"暂不更新"
  window.dshDesktop.updateDialogAction('later'); // 主进程切告知页
});
btnLaterRestart.addEventListener('click', () => { // APP 完成页"稍后"
  window.dshDesktop.updateDialogAction('done'); // 关闭弹窗（可稍后手动运行安装包）
});
btnUpdate.addEventListener('click', () => { // 主按钮：按当前视图动作
  const visibleView = Object.keys(views).find((key) => !views[key].hidden); // 当前可见视图
  if (visibleView === 'confirm') { // 确认页 → 立即更新
    window.dshDesktop.updateDialogAction('update'); // 主进程执行下载/npm 更新
  } else if (visibleView === 'app-done') { // APP 完成页 → 立即重启
    window.dshDesktop.updateDialogAction('restart'); // 打开安装包 + 退出应用
  } else { // 完成/告知/失败页 → 关闭
    window.dshDesktop.updateDialogAction('done'); // 关闭弹窗
  }
});
