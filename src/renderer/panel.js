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
  btnUpdate: document.getElementById('btnUpdate'), // 检查更新（APP + dsh 本体）
  btnClose: document.getElementById('btnClose'), // 关闭面板
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
  skillPick: document.getElementById('skillPick'), // 选择 zip 压缩包
  skillPickDir: document.getElementById('skillPickDir'), // 选择技能文件夹
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
    <div class="row" data-wsid="${escapeHtml(ws.id)}">
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
    <div class="row" data-skillid="${escapeHtml(s.id)}" data-dir="${escapeHtml(s.dir)}">
      <div class="info">
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="desc">${escapeHtml(s.source)} · ${escapeHtml(s.description || '')}</div>
      </div>
      <label class="switch" title="启用/停用">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} data-toggle="skill" />
        <span class="slider"></span>
      </label>
      <span class="open">▾</span>
      ${(s.source === 'dsh 用户技能' || s.source === '已停用') ? '<span class="del" title="删除技能">✕</span>' : ''}
    </div>
    <div class="detail" data-for="${escapeHtml(s.id)}"></div>`).join(''); // 仅自家安装/停用的技能可删（外部目录只读展示） // data-* 值统一转义（技能 id 含目录路径，可能带引号等特殊字符）
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
      if (e.target.classList.contains('del')) { // 点 ✕ = 删除（主进程弹确认对话框）
        const r = await window.dshDesktop.deleteSkill(row.dataset.skillid); // 删除
        if (r && r.error) alert('删除失败：' + r.error); // 错误提示（如外部目录技能）
        refreshAll(); // 刷新
        return;
      }
      // 用 dataset 遍历比较代替属性选择器插值（id 含引号/括号时选择器注入或失配）
      const detail = [...els.skillList.querySelectorAll('.detail')].find((d) => d.dataset.for === row.dataset.skillid); // 详情元素
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
      // 用 dataset 遍历比较代替属性选择器插值（名称含引号/括号时选择器注入或失配）
      const detail = [...els.mcpList.querySelectorAll('.detail')].find((d) => d.dataset.for === name); // 详情元素
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
  const opacity = Number(snapshot?.skinOpacity); // 皮肤透明度实际值（此前滑块恒显 100%，不读真实配置）
  if (Number.isFinite(opacity)) { // 有效值才同步
    els.skinOpacitySlider.value = opacity; // 滑块位置
    els.skinOpacityVal.textContent = opacity + '%'; // 数值显示
  }
  renderService(); // 状态行
  renderWorkspaces(); // 工作区
  renderSkills(); // 技能
  renderMcps(); // MCP
  renderUpdater(); // 更新状态
  maybeAutoCheckAll(); // 状态未知/失败时后台全量补查（不阻塞渲染，完成后自会再刷新）
}

// 渲染更新状态（单一"检查更新"按钮：APP 与 dsh 任一有新版本即提示）
function renderUpdater() {
  const u = snapshot?.updater?.app ?? {}; // APP 更新状态
  const d = snapshot?.updater?.dsh ?? {}; // dsh 本体更新状态
  const appNew = u.status === 'available'; // APP 有新版
  const dshNew = d.status === 'available'; // dsh 有新版
  if (u.status === 'checking' || d.status === 'checking') { // 检查中
    els.btnUpdate.textContent = '⏳ 检查中…'; // 状态
    els.btnUpdate.dataset.mode = 'none'; // 点击无动作
  } else if (appNew || dshNew) { // 任一组件有新版本
    els.btnUpdate.textContent = '⬇ 有新版本可用'; // 新版提示（点击重新检查并弹确认弹窗）
    els.btnUpdate.dataset.mode = 'check'; // 点击=检查+弹窗
  } else if (d.status === 'error' && d.latest && d.current && d.latest !== d.current) {
    // dsh 更新失败但已知有新版：面板持续显示失败状态（失败页关掉后用户也能看到下一步，不"失联"）
    els.btnUpdate.textContent = '⚠ 更新失败 点此重试'; // 失败提示
    els.btnUpdate.dataset.mode = 'check'; // 点击=重新检查+弹窗
  } else if (u.status === 'downloaded') { // APP 已下载完成待重启（此前无分支：面板显示"检查更新"，用户找不到重启入口）
    els.btnUpdate.textContent = '✅ 已下载完成，重启桌面端生效'; // 重启提示
    els.btnUpdate.dataset.mode = 'none'; // 无需点击（重启动作在用户自己）
  } else if (u.status === 'downloading') { // APP 下载中
    els.btnUpdate.textContent = `⏳ 下载中 ${u.info?.percent ?? 0}%`; // 进度
    els.btnUpdate.dataset.mode = 'none'; // 点击无动作
  } else if (d.status === 'updating') { // dsh 更新中
    els.btnUpdate.textContent = '⏳ dsh 更新中…'; // 状态
    els.btnUpdate.dataset.mode = 'none'; // 点击无动作
  } else if (u.status === 'up-to-date' && d.status === 'up-to-date') { // 两个都已是最新
    els.btnUpdate.textContent = '✓ 已是最新'; // 状态
    els.btnUpdate.dataset.mode = 'check'; // 点击=再查一次
  } else { // idle / error：提供检查入口
    els.btnUpdate.textContent = '↻ 检查更新'; // 入口
    els.btnUpdate.dataset.mode = 'check'; // 点击=检查
  }
}

// 面板打开时自动全量静默检查一次（APP+dsh，不弹窗不通知，结果直接显示在按钮上）
// 用户要求：一进控制面板就能看到更新状态，不用再按一次"检测更新"
let autoChecked = false; // 本面板会话内只自动检查一次，避免反复打扰
async function maybeAutoCheckAll() {
  if (autoChecked) return; // 已检查过
  const u = snapshot?.updater?.app ?? {}; // APP 当前状态
  const d = snapshot?.updater?.dsh ?? {}; // dsh 当前状态
  const known = ['available', 'up-to-date', 'downloading', 'updating', 'downloaded']; // 已明确的状态无需补查
  if (known.includes(u.status) && known.includes(d.status)) return; // 两个都有结果了
  autoChecked = true; // 置标志（先置防重入）
  await window.dshDesktop.quietCheckAll(); // 全量静默检查（主进程不弹窗不通知）
  await refreshAll(); // 用检查结果刷新按钮
}

// 手动检查完成后向用户告知各组件最新情况（明确区分 APP 与 dsh 各自有无新版）
// 文案格式（用户要求，左对齐）：
//   暂无新版本
//   桌面端当前版本为：vX，已是最新
//   （空行）dsh 本体版本为：vY，当前已是最新
function reportCheckResult() {
  const u = snapshot?.updater?.app ?? {}; // APP 状态
  const d = snapshot?.updater?.dsh ?? {}; // dsh 状态
  const appNew = u.status === 'available'; // APP 有新版
  const dshNew = d.status === 'available'; // dsh 有新版
  // 检查失败但保留着上次"有新版"的结论（latest>current）时同样视为有新版（弹窗已由主进程重弹）
  const appHasKnownUpdate = appNew || (u.info?.version && u.info.version !== snapshot?.version); // APP 有已知新版
  const dshHasKnownUpdate = dshNew || (d.latest && d.current && d.latest !== d.current); // dsh 有已知新版
  if (appHasKnownUpdate || dshHasKnownUpdate) return; // 有新版：确认弹窗已弹出（或由主进程重弹），不再弹消息框
  const lines = []; // 详情行（空行分隔，左对齐）
  if (u.status === 'up-to-date') { // APP 已是最新
    lines.push(`桌面端当前版本为：v${u.info?.version ?? snapshot?.version ?? '-'}，已是最新`); // 桌面端状态行
  } else { // APP 检查失败（网络原因）
    lines.push('桌面端更新检查失败，请检查网络后重试'); // 失败提示行
  }
  if (d.status === 'up-to-date') { // dsh 已是最新
    lines.push(`dsh 本体版本为：v${d.latest ?? d.current ?? '-'}，当前已是最新`); // dsh 状态行
  } else { // dsh 检查失败（网络原因，之前把失败误显示成"已是最新"）
    lines.push('dsh 本体更新检查失败，请检查网络后重试'); // 失败提示行
  }
  const bothOk = u.status === 'up-to-date' && d.status === 'up-to-date'; // 两个组件都查成功且已最新
  window.dshDesktop.showMessage({ // 系统消息框
    title: bothOk ? '暂无新版本' : '检查未完成', // 有检查失败时不谎报"暂无新版本"
    message: lines.join('\n\n') // 详情多行（空行分隔，左对齐）
  });
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
els.btnUpdate.addEventListener('click', async () => { // "检查更新"按钮：APP 与 dsh 本体一起查
  const mode = els.btnUpdate.dataset.mode; // 当前按钮模式
  if (mode !== 'check') return; // 检查中/下载中/更新中不可重复点击
  if (!snapshot) await refreshAll(); // 首次快照尚未返回：先补拉（否则后续用空快照渲染会静默/谎报"检查失败"）
  els.btnUpdate.dataset.mode = 'none'; // 立即禁用：检查是异步的，不置 none 双击会触发两次检查（refreshAll 后按状态恢复）
  els.btnUpdate.textContent = '⏳ 检查中…'; // 反馈
  await window.dshDesktop.checkUpdate(); // 检查（主进程并行查完两者；有新版自动弹确认弹窗，与启动弹窗一致）
  await refreshAll(); // 用结果刷新按钮
  reportCheckResult(); // 无新版时消息框告知（按用户格式，左对齐分行）
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
// zip 与文件夹共用安装结果处理（选择模式不同，安装流程一致）
async function pickAndInstallSkill(mode) { // mode: 'zip' | 'dir'
  const result = await window.dshDesktop.installSkill({ mode }); // 主进程弹框并安装
  if (!result) return; // 取消选择
  if (result.error) { // 安装失败（如 zip 内无 SKILL.md）
    alert('安装失败：' + result.error); // 展示错误
    return;
  }
  els.skillModal.hidden = true; // 成功关闭弹层
  refreshAll(); // 刷新列表
}
els.skillPick.addEventListener('click', () => pickAndInstallSkill('zip')); // 选择 zip 压缩包安装
els.skillPickDir.addEventListener('click', () => pickAndInstallSkill('dir')); // 选择技能文件夹安装

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

// 订阅主进程推送（服务状态变化实时更新状态行；更新状态推送实时刷新更新按钮——此前面板打开期间下载进度冻结）
window.dshDesktop.onState((payload) => {
  if (payload && payload.type === 'service') { // 服务状态推送
    if (snapshot) snapshot.service = payload.state; // 更新缓存
    renderService(); // 重绘状态行
  } else if (payload && payload.type === 'updater') { // 更新状态推送（下载进度/检查结果/失败态）
    if (snapshot) snapshot.updater = { app: payload.app, dsh: payload.dsh }; // 更新缓存
    renderUpdater(); // 重绘更新按钮
  }
});

// 启动：拉一次全量快照
refreshAll();
