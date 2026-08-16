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
  btnClose: document.getElementById('btnClose'), // 关闭面板
  btnDshUpdate: document.getElementById('btnDshUpdate'), // 更新 dsh 本体
  skillModal: document.getElementById('skillModal'), // Skill 添加弹层
  skinPick: document.getElementById('skinPick'), // 选择图片应用
  skinReset: document.getElementById('skinReset'), // 恢复默认
  skinOpacitySlider: document.getElementById('skinOpacitySlider'), // 透明度滑块
  skinOpacityVal: document.getElementById('skinOpacityVal'), // 透明度数值
  btnOpenGuide: document.getElementById('btnOpenGuide'), // 打开完整使用说明
  skillModeManual: document.getElementById('skillModeManual'), // 手动安装模式
  skillModeImport: document.getElementById('skillModeImport'), // 自动搜索导入模式
  skillManualFields: document.getElementById('skillManualFields'), // 手动安装区
  skillImportFields: document.getElementById('skillImportFields'), // 搜索导入区
  skillPick: document.getElementById('skillPick'), // 选择文件夹/zip
  skillImportList: document.getElementById('skillImportList'), // 可导入列表
  skillImportEmpty: document.getElementById('skillImportEmpty'), // 空提示
  skillImportFilter: document.getElementById('skillImportFilter'), // 筛选输入框
  skillModalCancel: document.getElementById('skillModalCancel'), // 关闭弹层
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

// 渲染更新状态（APP 按钮 + dsh 本体按钮）
function renderUpdater() {
  const u = snapshot?.updater?.app ?? {}; // APP 更新状态
  const d = snapshot?.updater?.dsh ?? {}; // dsh 本体更新状态
  const map = { // APP 文案表
    checking: '⏳ 检查中…',
    available: `⬇ 更新到 v${u.info?.version ?? ''}`, // 有新版：点击即确认下载
    downloading: `⬇ 下载中 ${u.info?.percent ?? ''}%`,
    downloaded: '✓ 已下载（点通知安装）',
    'up-to-date': '✓ 已是最新',
    error: '↻ 检查更新'
  };
  els.btnUpdate.textContent = map[u.status] ?? '↻ 检查更新'; // 按钮文案
  if (d.status === 'available') { // dsh 有新版：显示更新按钮
    els.btnDshUpdate.hidden = false; // 显示
    els.btnDshUpdate.textContent = `⬆ dsh v${d.current} → v${d.latest}`; // 版本对比文案
  } else if (d.status === 'updating') { // 更新中
    els.btnDshUpdate.hidden = false; // 显示
    els.btnDshUpdate.textContent = '⏳ dsh 更新中…'; // 进度文案
  } else {
    els.btnDshUpdate.hidden = true; // 其余状态隐藏（保持底部行简洁）
  }
}

// 左侧导航切换
document.querySelectorAll('.navitem').forEach((tab) => { // 绑定导航项
  tab.addEventListener('click', () => { // 点击切换
    document.querySelectorAll('.navitem').forEach((t) => t.classList.remove('active')); // 清激活
    document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active')); // 清面板
    tab.classList.add('active'); // 激活导航项
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
els.btnUpdate.addEventListener('click', async () => { // 检查/确认更新
  const u = snapshot?.updater?.app ?? {}; // 当前 APP 更新状态
  if (u.status === 'available') { // 有新版 → 用户确认下载
    els.btnUpdate.textContent = '⏳ 下载中…'; // 反馈
    await window.dshDesktop.downloadUpdate(); // 下载
  } else { // 否则执行检查（APP + dsh 本体）
    els.btnUpdate.textContent = '⏳ 检查中…'; // 反馈
    await window.dshDesktop.checkUpdate(); // 检查
  }
  setTimeout(refreshAll, 2000); // 稍后刷新
});
els.btnDshUpdate.addEventListener('click', async () => { // 确认更新 dsh 本体
  els.btnDshUpdate.textContent = '⏳ dsh 更新中…'; // 反馈
  await window.dshDesktop.updateDsh(); // npm 更新 + 重启服务
  setTimeout(refreshAll, 3000); // 稍后刷新
});
els.btnOpenGuide.addEventListener('click', () => window.dshDesktop.openGuide()); // 主窗口打开完整使用说明
els.btnClose.addEventListener('click', () => window.close()); // 关闭面板（主进程 closed 事件会清引用，可再次 Ctrl+Shift+D 呼出）

// 皮肤 Tab：选择图片应用（实时注入主窗口）
els.skinPick.addEventListener('click', async () => {
  const result = await window.dshDesktop.setSkin(); // 主进程弹图片选择器并注入
  if (result && result.error) { alert('设置失败：' + result.error); return; } // 失败提示
  if (result && result.ok) { /* 成功：不弹窗打扰，用户直接看主窗口效果 */ }
});
els.skinReset.addEventListener('click', async () => { // 恢复默认（实时移除）
  await window.dshDesktop.clearSkin(); // 移除注入
  els.skinOpacitySlider.value = 100; // 滑块复位
  els.skinOpacityVal.textContent = '100%'; // 数值复位
});
// 透明度滑块：拖动实时生效
els.skinOpacitySlider.addEventListener('input', async () => {
  const v = Number(els.skinOpacitySlider.value); // 当前值
  els.skinOpacityVal.textContent = v + '%'; // 数值显示
  await window.dshDesktop.setSkinOpacity(v); // 实时重注入（主窗口立即变化）
});

// 技能添加：打开弹层（手动安装 / 自动搜索导入）
els.skillAdd.addEventListener('click', () => { // 打开弹层
  els.skillModal.hidden = false; // 显示
  setSkillMode('manual'); // 默认手动模式
});

// 切换弹层模式
function setSkillMode(mode) {
  const isManual = mode === 'manual'; // 是否手动
  els.skillModeManual.className = 'abtn' + (isManual ? ' primary' : ''); // 高亮手动
  els.skillModeImport.className = 'abtn' + (isManual ? '' : ' primary'); // 高亮导入
  els.skillManualFields.hidden = !isManual; // 显示/隐藏手动区
  els.skillImportFields.hidden = isManual; // 显示/隐藏导入区
  if (!isManual) renderSkillImportList(); // 切入导入模式时加载列表
}
els.skillModeManual.addEventListener('click', () => setSkillMode('manual')); // 手动模式
els.skillModeImport.addEventListener('click', () => setSkillMode('import')); // 导入模式
els.skillModalCancel.addEventListener('click', () => { els.skillModal.hidden = true; }); // 关闭弹层

// 可导入技能缓存（筛选用）
let importableSkills = []; // 全量扫描结果

// 渲染可自动搜索导入的技能列表（每项带"导入"按钮，支持名称筛选）
function renderSkillImportListFromCache() {
  const kw = (els.skillImportFilter.value || '').trim().toLowerCase(); // 筛选关键词
  const items = kw ? importableSkills.filter((s) => String(s.name).toLowerCase().includes(kw)) : importableSkills; // 过滤
  els.skillImportEmpty.hidden = items.length > 0; // 空提示显隐
  els.skillImportList.innerHTML = items.map((s) => ` // 逐条渲染
    <div class="row" data-skilldir="${escapeHtml(s.dir)}">
      <div class="info">
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="desc">${escapeHtml(s.source)}</div>
      </div>
      <button class="abtn" data-import>导入</button>
    </div>
  `).join('');
  els.skillImportList.querySelectorAll('[data-import]').forEach((btn) => { // 绑定导入
    btn.addEventListener('click', async () => { // 点击导入
      const dir = btn.closest('.row').dataset.skilldir; // 目录（HTML 转义后取回）
      btn.textContent = '导入中…'; // 反馈
      try { // 调主进程复制
        await window.dshDesktop.adoptSkill({ dir }); // 导入
        importableSkills = importableSkills.filter((s) => s.dir !== dir); // 从缓存移除
        renderSkillImportListFromCache(); // 重渲染
        refreshAll(); // 刷新技能列表
      } catch (err) { // 失败
        btn.textContent = '导入'; // 恢复
        alert('导入失败：' + (err?.message ?? err)); // 提示
      }
    });
  });
}

// 加载可导入技能并渲染
async function renderSkillImportList() {
  els.skillImportList.innerHTML = '<div class="empty">搜索中…</div>'; // 加载态
  importableSkills = (await window.dshDesktop.importSkillsList()) ?? []; // 扫描
  renderSkillImportListFromCache(); // 渲染
}
els.skillImportFilter.addEventListener('input', renderSkillImportListFromCache); // 输入即筛选

// 手动安装：调主进程弹选择（文件夹或 zip）
els.skillPick.addEventListener('click', async () => { // 选择安装
  const result = await window.dshDesktop.installSkill(); // 主进程弹框并安装
  if (result && result.error) { // 安装失败（如 zip 内无 SKILL.md）
    alert('安装失败：' + result.error); // 展示错误
    return;
  }
  els.skillModal.hidden = true; // 成功关闭弹层
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
