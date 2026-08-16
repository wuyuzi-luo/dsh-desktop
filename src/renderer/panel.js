// 面板脚本：三 Tab（工作区/Skills/MCP）+ 状态订阅 + 底部按键行
// 所有数据经 preload 暴露的 window.dshDesktop 与主进程通信

// 各元素引用
const els = {
  ver: document.getElementById('ver'), // 版本号
  svcDot: document.getElementById('svcDot'), // 服务状态点
  svcText: document.getElementById('svcText'), // 服务状态文案
  svcUrl: document.getElementById('svcUrl'), // 服务地址
  wsList: document.getElementById('wsList'), // 工作区列表
  skillList: document.getElementById('skillList'), // 技能列表
  mcpList: document.getElementById('mcpList'), // MCP 列表
  btnOpen: document.getElementById('btnOpen'), // 打开工作台
  btnRestart: document.getElementById('btnRestart'), // 重启服务
  btnUpdate: document.getElementById('btnUpdate'), // 检查更新
  btnGuide: document.getElementById('btnGuide'), // 使用说明
  btnClose: document.getElementById('btnClose'), // 关闭面板
  skillAdd: document.getElementById('skillAdd'), // 添加技能
  mcpAdd: document.getElementById('mcpAdd'), // 添加 MCP
  mcpModal: document.getElementById('mcpModal') // MCP 表单弹层
};

let snapshot = null; // 最近一次全量快照缓存

// 渲染服务状态行
function renderService() {
  const state = snapshot?.service ?? 'stopped'; // 当前状态
  const map = { running: '服务运行中', starting: '服务启动中', error: '服务异常', missing: '未找到 dsh', stopped: '服务已停止' }; // 文案表
  els.svcDot.className = 'status-dot' + (state !== 'stopped' ? ' ' + state : ''); // 状态色
  els.svcText.textContent = map[state] ?? state; // 文案
  els.svcUrl.textContent = snapshot?.url ?? ''; // 地址
}

// 渲染工作区列表
function renderWorkspaces() {
  const list = snapshot?.workspaces ?? []; // 列表
  if (!list.length) { els.wsList.innerHTML = '<div class="empty">（无工作区）</div>'; return; } // 空态
  els.wsList.innerHTML = list.map((ws) => ` // 逐条渲染
    <div class="row" data-wsid="${ws.id}">
      <div class="info">
        <div class="name">${escapeHtml(ws.title)}</div>
        <div class="desc">${escapeHtml(ws.path)} · ${ws.sessionCount} 个会话</div>
      </div>
      <span class="open">↗</span>
    </div>`).join('');
  els.wsList.querySelectorAll('.row').forEach((row) => { // 绑定点击
    row.addEventListener('click', () => { // 点击打开目录
      const ws = list.find((w) => w.id === row.dataset.wsid); // 找回对象
      if (ws) window.dshDesktop.openWorkspace(ws); // 调主进程
    });
  });
}

// 渲染技能列表（CC Switch 式：名称 + 描述 + 开关 + 展开正文）
function renderSkills() {
  const list = snapshot?.skills ?? []; // 列表
  if (!list.length) { els.skillList.innerHTML = '<div class="empty">（无技能）</div>'; return; } // 空态
  els.skillList.innerHTML = list.map((s) => `
    <div class="row" data-skillid="${s.id}" data-dir="${escapeHtml(s.dir)}">
      <div class="info">
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="desc">${escapeHtml(s.source)} · ${escapeHtml(s.description || '')}</div>
      </div>
      <label class="switch" title="启用/停用">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} data-toggle="skill" />
        <span class="slider"></span>
      </label>
      <span class="open">▾</span>
    </div>
    <div class="detail" data-for="${s.id}"></div>`).join('');
  els.skillList.querySelectorAll('input[data-toggle="skill"]').forEach((input) => { // 开关事件
    input.addEventListener('change', async () => { // 切换
      const id = input.closest('.row').dataset.skillid; // 技能 id
      snapshot = await window.dshDesktop.getState(); // 拉最新（toggle 后主进程已更新）
      const skill = snapshot.skills.find((s) => s.id === id); // 找对象
      if (skill) { // 调主进程切换并刷新
        await window.dshDesktop.toggleSkill(id, input.checked);
        refreshAll();
      }
    });
  });
  els.skillList.querySelectorAll('.row').forEach((row) => { // 展开详情
    row.addEventListener('click', async (e) => { // 点击行（点开关除外）
      if (e.target.closest('.switch')) return; // 开关自身事件不冲突
      const detail = els.skillList.querySelector(`.detail[data-for="${row.dataset.skillid}"]`); // 详情元素
      const content = await window.dshDesktop.skillContent(row.dataset.skillid); // 拉正文
      detail.textContent = content ?? '（无内容）'; // 填充
      detail.classList.toggle('show'); // 展开/收起
    });
  });
}

// 渲染 MCP 列表（CC Switch 式：名称 + 传输 + 状态 + 开关 + 展开配置）
function renderMcps() {
  const list = snapshot?.mcps ?? []; // 列表
  if (!list.length) { els.mcpList.innerHTML = '<div class="empty">（无 MCP）</div>'; return; } // 空态
  els.mcpList.innerHTML = list.map((m) => `
    <div class="row" data-mcpname="${escapeHtml(m.serverName)}">
      <div class="info">
        <div class="name">${escapeHtml(m.serverName)} <span style="color:#5d6b98;font-weight:400">· ${escapeHtml(m.transport)}</span></div>
        <div class="desc">${escapeHtml(m.transport === 'stdio' ? (m.command || '') : (m.url || ''))} · ${statusText(m.status)}</div>
      </div>
      <label class="switch" title="启用/停用">
        <input type="checkbox" ${m.enabled !== false ? 'checked' : ''} data-toggle="mcp" />
        <span class="slider"></span>
      </label>
      <span class="open">✕</span>
    </div>
    <div class="detail" data-for="${escapeHtml(m.serverName)}"></div>`).join('');
  els.mcpList.querySelectorAll('input[data-toggle="mcp"]').forEach((input) => { // 开关
    input.addEventListener('change', async () => { // 切换（HMR 立即生效）
      const name = input.closest('.row').dataset.mcpname; // 名称
      await window.dshDesktop.toggleMcp(name, input.checked); // 调主进程
      refreshAll(); // 刷新
    });
  });
  els.mcpList.querySelectorAll('.row').forEach((row) => { // 行点击
    row.addEventListener('click', async (e) => { // 展开详情或删除
      if (e.target.closest('.switch')) return; // 开关不冲突
      if (e.target.classList.contains('open')) { // 点 ✕ = 删除
        await window.dshDesktop.removeMcp(row.dataset.mcpname); // 删除
        refreshAll(); // 刷新
        return;
      }
      const name = row.dataset.mcpname; // 名称
      const m = (snapshot?.mcps ?? []).find((x) => x.serverName === name); // 找定义
      const detail = els.mcpList.querySelector(`.detail[data-for="${name}"]`); // 详情元素
      detail.textContent = JSON.stringify(m, null, 2); // 显示完整配置（env 已脱敏）
      detail.classList.toggle('show'); // 展开/收起
    });
  });
}

// 探测状态 → 中文文案
function statusText(status) {
  const map = { ok: '连接正常', unreachable: '不可达', configured: '已配置' }; // 文案表
  if (status && status.startsWith('http-')) return `HTTP ${status.slice(5)}`; // HTTP 错误码
  return map[status] ?? (status || ''); // 其余
}

// HTML 转义（防列表注入）
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 全量刷新（拉快照 + 重绘三个列表）
async function refreshAll() {
  snapshot = await window.dshDesktop.getState(); // 拉快照
  els.ver.textContent = 'v' + (snapshot?.version ?? '-'); // 版本
  renderService(); // 状态行
  renderWorkspaces(); // 工作区
  renderSkills(); // 技能
  renderMcps(); // MCP
  renderUpdater(); // 更新状态
}

// 渲染更新状态到按钮文案
function renderUpdater() {
  const u = snapshot?.updater ?? {}; // 更新状态
  const map = { // 文案表
    available: '⬇ 发现新版本', downloading: `⬇ 下载中 ${u.info?.percent ?? ''}%`,
    downloaded: '✓ 已下载（退出时安装）', up_to_date: undefined, 'up-to-date': '✓ 已是最新', error: '检查更新'
  };
  els.btnUpdate.textContent = map[u.status] ?? '↻ 检查更新'; // 按钮文案
}

// Tab 切换
document.querySelectorAll('.tab').forEach((tab) => { // 绑定页签
  tab.addEventListener('click', () => { // 点击切换
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active')); // 清激活
    document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active')); // 清面板
    tab.classList.add('active'); // 激活页签
    document.getElementById('pane-' + tab.dataset.tab).classList.add('active'); // 激活面板
  });
});

// 底部按键行
els.btnOpen.addEventListener('click', () => window.dshDesktop.openWebUi()); // 打开工作台
els.btnRestart.addEventListener('click', async () => { // 重启服务
  els.svcText.textContent = '正在重启…'; // 反馈
  await window.dshDesktop.restartService(); // 调主进程
  setTimeout(refreshAll, 2500); // 稍后刷新状态
});
els.btnUpdate.addEventListener('click', async () => { // 检查更新
  els.btnUpdate.textContent = '⏳ 检查中…'; // 反馈
  await window.dshDesktop.checkUpdate(); // 检查
  setTimeout(refreshAll, 2000); // 稍后刷新
});
els.btnGuide.addEventListener('click', () => window.dshDesktop.openGuide()); // 主窗口打开使用说明
els.btnClose.addEventListener('click', () => window.close()); // 关闭面板（主进程 closed 事件会清引用，可再次 Ctrl+Shift+D 呼出）

// 技能添加：调主进程弹选择（文件夹或 zip）
els.skillAdd.addEventListener('click', async () => { // 安装技能
  const result = await window.dshDesktop.installSkill(); // 主进程弹框并安装
  if (result && result.error) { // 安装失败（如 zip 内无 SKILL.md）
    alert('安装失败：' + result.error); // 展示错误
    return;
  }
  refreshAll(); // 刷新列表
});

// MCP 添加弹层（手动添加 / 导入已有 两种模式）
els.mcpAdd.addEventListener('click', () => { // 打开弹层（默认手动模式）
  els.mcpModal.hidden = false; // 显示
  switchMcpMode('manual'); // 初始手动模式
});
document.getElementById('mcpCancel').addEventListener('click', () => { els.mcpModal.hidden = true; }); // 取消
document.getElementById('mcpTransport').addEventListener('change', (e) => { // 传输切换
  document.getElementById('stdioFields').hidden = e.target.value !== 'stdio'; // stdio 字段
  document.getElementById('httpFields').hidden = e.target.value !== 'streamable-http'; // http 字段
});

// 切换弹层模式：manual=手动表单，import=导入已有列表
async function switchMcpMode(mode) {
  const manualBtn = document.getElementById('modeManual'); // 手动按钮
  const importBtn = document.getElementById('modeImport'); // 导入按钮
  const manualFields = document.getElementById('manualFields'); // 表单区
  const importFields = document.getElementById('importFields'); // 导入区
  const saveBtn = document.getElementById('mcpSave'); // 保存按钮（仅手动模式用）
  const isManual = mode === 'manual'; // 是否手动
  manualBtn.classList.toggle('primary', isManual); // 高亮手动按钮
  importBtn.classList.toggle('primary', !isManual); // 高亮导入按钮
  manualFields.hidden = !isManual; // 显示表单
  importFields.hidden = isManual; // 隐藏导入区
  saveBtn.hidden = !isManual; // 保存按钮只在手动模式
  if (!isManual) { // 切到导入模式 → 拉取可导入列表
    const list = await window.dshDesktop.listImportableMcps(); // 扫描外部实例
    const importList = document.getElementById('importList'); // 列表容器
    const importEmpty = document.getElementById('importEmpty'); // 空态提示
    importEmpty.hidden = list.length > 0; // 有无数据
    importList.innerHTML = list.map((m) => ` // 逐条渲染
      <div class="row" data-import="${escapeHtml(m.serverName)}">
        <div class="info">
          <div class="name">${escapeHtml(m.serverName)} <span style="color:#5d6b98;font-weight:400">· ${escapeHtml(m.transport || '')}</span></div>
          <div class="desc">${escapeHtml(m.transport === 'stdio' ? (m.command || '') : (m.url || ''))}</div>
        </div>
        <span class="open">＋ 收编</span>
      </div>`).join('');
    importList.querySelectorAll('.row').forEach((row) => { // 绑定收编点击
      row.addEventListener('click', async () => { // 点击收编
        await window.dshDesktop.adoptMcp(list.find((x) => x.serverName === row.dataset.import)); // 收编
        els.mcpModal.hidden = true; // 关弹层
        refreshAll(); // 刷新列表
      });
    });
  }
}
document.getElementById('modeManual').addEventListener('click', () => switchMcpMode('manual')); // 手动模式
document.getElementById('modeImport').addEventListener('click', () => switchMcpMode('import')); // 导入模式

document.getElementById('mcpSave').addEventListener('click', async () => { // 保存（手动添加）
  const transport = document.getElementById('mcpTransport').value; // 传输方式
  const def = { // 组装定义
    serverName: document.getElementById('mcpName').value.trim(), // 名称
    transport, // 传输
    enabled: true // 默认启用
  };
  if (transport === 'stdio') { // stdio 字段
    def.command = document.getElementById('mcpCommand').value.trim(); // 命令
    def.args = document.getElementById('mcpArgs').value.split(',').map((s) => s.trim()).filter(Boolean); // 参数
  } else { // http 字段
    def.url = document.getElementById('mcpUrl').value.trim(); // URL
  }
  if (!def.serverName || (transport === 'stdio' && !def.command) || (transport === 'streamable-http' && !def.url)) { // 校验
    alert('请填写完整信息'); // 提示
    return;
  }
  await window.dshDesktop.addMcp(def); // 添加（主进程同步 patch，HMR 生效）
  els.mcpModal.hidden = true; // 关弹层
  refreshAll(); // 刷新
});

// 订阅主进程推送（服务状态变化时实时更新状态行）
window.dshDesktop.onState((payload) => {
  if (payload && payload.type === 'service') { // 服务状态推送
    if (snapshot) snapshot.service = payload.state; // 更新缓存
    renderService(); // 重绘状态行
  }
});

// 启动：拉一次全量快照
refreshAll();
