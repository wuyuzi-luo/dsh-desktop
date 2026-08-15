// 桌面通知模块：边沿检测 + 去抖 + Windows 原生通知 + 点击聚焦 + flashFrame 兜底

import { Notification, nativeImage } from 'electron'; // Electron 命名导入（已验证在真主进程可用）
import { fileURLToPath } from 'node:url'; // ESM 路径
import { dirname, join } from 'node:path'; // 路径拼接
import { existsSync } from 'node:fs'; // 存在性检查

// 通知图标：Windows 通知不支持 SVG dataURL 光栅化，用预生成的 icon.ico（官方鲸鱼）
const ICON_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.ico'); // src/assets 下（随包分发）

// 同 tag 通知的最小间隔（防重复轰炸）
const MIN_INTERVAL_MS = 3000;

// 创建通知器
export function createNotifier({ getMainWindow }) {
  const lastFired = new Map(); // tag → 上次触发时间戳
  const turnRunning = new Map(); // sessionId → 是否在运行（边沿检测依据）
  let whaleImage = null; // 缓存的鲸鱼通知图标

  // 懒加载鲸鱼图标（从 icon.ico 文件读取，Windows 通知对文件图标支持可靠）
  function getWhaleImage() {
    if (!whaleImage) whaleImage = existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : nativeImage.createEmpty(); // 读文件一次
    return whaleImage; // 返回缓存
  }

  // 去抖判断：同 tag 间隔不足则丢弃
  function throttled(tag) {
    const now = Date.now(); // 当前时间
    const last = lastFired.get(tag) ?? 0; // 上次时间
    if (now - last < MIN_INTERVAL_MS) return false; // 太近 → 丢弃
    lastFired.set(tag, now); // 记录本次
    return true; // 放行
  }

  // 底层弹通知；失败时降级为任务栏闪烁
  function fire(title, body, tag) {
    const win = getMainWindow(); // 主窗口引用
    try {
      const n = new Notification({ title, body, icon: getWhaleImage(), silent: false }); // 构建原生通知
      n.on('click', () => { // 点击通知 → 聚焦窗口
        if (win && !win.isDestroyed()) { win.show(); win.restore(); win.focus(); } // 显示+还原+聚焦
      });
      n.show(); // 弹出
    } catch {
      // 通知不可用（如 dev 模式 AUMID 未注册）→ 任务栏闪烁兜底
      if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true); // 闪烁提醒
    }
  }

  // 回合状态边沿检测（由 event-bridge 的 turn-started/turn-completed 驱动）
  function onTurnStart({ sessionId }) {
    turnRunning.set(sessionId, true); // 记录运行中
  }

  function onTurnCompleted({ sessionId }) {
    // 边沿检测放宽：完成帧可能不伴随 start 帧（桥启动时回合已在进行中），
    // 收到完成帧即报，用 lastFired 去重防真正的重复帧轰炸
    const wasRunning = turnRunning.get(sessionId); // 之前是否标记运行
    turnRunning.delete(sessionId); // 清理状态
    if (!wasRunning && lastFired.get(`turn-${sessionId}`)) return; // 已报过同会话 → 真正的重复帧跳过
    if (!throttled(`turn-${sessionId}`)) return; // 去抖
    fire('回合完成', 'dsh 任务执行完成，点击查看结果', `turn-${sessionId}`); // 弹通知
  }

  // 审批请求（等待审批）
  function onApprovalRequested({ sessionId, toolName, reason }) {
    if (!throttled(`approval-${sessionId}`)) return; // 去抖
    const body = reason ? `${toolName}: ${String(reason).slice(0, 80)}` : `工具 ${toolName} 请求批准`; // 正文（截断）
    fire('等待审批', body, `approval-${sessionId}`); // 弹通知
  }

  // Agent 提问
  function onQuestionRequested({ sessionId, questions }) {
    if (!throttled(`question-${sessionId}`)) return; // 去抖
    const first = Array.isArray(questions) && questions.length ? String(questions[0]).slice(0, 80) : 'Agent 有问题需要回答'; // 取第一条
    fire('Agent 提问', first, `question-${sessionId}`); // 弹通知
  }

  // 任务执行出错（dsh 的 host/agent-error 帧，如 API 请求失败）
  function onAgentError({ sessionId, message }) {
    if (!throttled(`agent-error-${sessionId}`)) return; // 去抖
    fire('任务出错', String(message || '未知错误').slice(0, 120), `agent-error-${sessionId}`); // 弹通知
  }

  // 服务异常停止（由 supervisor error 驱动）
  function onServiceError(message) {
    if (!throttled('service-error')) return; // 去抖
    fire('dsh 服务异常', message || '服务意外停止', 'service-error'); // 弹通知
  }

  // 测试通知（面板按钮自检用）
  function test() {
    fire('测试通知', '通知管线工作正常 🐋', 'test-notify'); // 直接弹一条
  }

  return { onTurnStart, onTurnCompleted, onApprovalRequested, onQuestionRequested, onAgentError, onServiceError, test };
}
