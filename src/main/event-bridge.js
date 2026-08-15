// 事件桥：WebSocket 直连 dsh 的事件流（ws://.../api/events.host + /api/events.mux）
// 帧信封格式（已从 dsh-client-connection 源码核实）：
//   {type:'server-request', rpcId, method, payload} —— 事件数据在 payload 内
// 白名单解析、未知帧静默忽略、断线指数退避重连——桌面通知的唯一信号源

import { EventEmitter } from 'node:events'; // 事件总线
import { getConfig } from './config.js'; // 读端口配置

// 断线重连参数
const RETRY_MIN_MS = 1000; // 首次重连延迟 1s
const RETRY_MAX_MS = 30_000; // 重连延迟上限 30s
// 关注的帧方法白名单（payload 字段按 dsh 的 hostFrameSchema/muxFrameSchema 核实）
const FRAME_FIELDS = {
  'host/session-status': ['sessionId', 'running'], // 回合状态帧
  'host/agent-error': ['sessionId', 'message'], // 任务出错帧（如 API 失败）
  'approval/requested': ['sessionId', 'approvalId', 'toolName', 'reason'], // 审批请求帧
  'approval/resolved': ['sessionId', 'approvalId'], // 审批解决帧
  'question/requested': ['sessionId', 'questions'] // Agent 提问帧
};

// 创建事件桥
export function createEventBridge() {
  const emitter = new EventEmitter(); // 对外事件总线
  let running = false; // 桥是否应保持连接
  let sockets = []; // 当前两个 WebSocket 实例
  let retryDelay = RETRY_MIN_MS; // 当前重连延迟（指数增长）
  let reconnectTimer = null; // 重连定时器

  // 连接单条流（返回 Promise<WebSocket>，连上后自动收帧）
  function connectStream(path, label) {
    return new Promise((resolve, reject) => { // 以 Promise 封装连接结果
      const port = getConfig('port'); // 目标端口
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`); // 直连（无 Origin，dsh 信任放行）
      sockets.push(ws); // 登记以便统一停止
      let opened = false; // 是否已 open（防重复决议）
      // 注意：dsh 的 WS 是纯下行通道（downlink only），客户端发任何消息都会被 1008 踢掉，必须静默接收
      ws.onopen = () => { // 连接成功
        opened = true; // 标记
        // 不发送任何消息：dsh 的 WS 为纯下行（downlink only），发消息会被服务端 1008 踢掉
        resolve(ws); // 决议成功
      };
      ws.onmessage = (ev) => { // 收到帧
        try {
          const obj = JSON.parse(String(ev.data)); // 解析信封
          const method = obj?.method; // 帧方法
          if (!method || !FRAME_FIELDS[method]) return; // 白名单外静默忽略
          const payload = obj?.payload ?? {}; // 事件数据在 payload 内
          const picked = {}; // 只挑白名单字段
          for (const key of FRAME_FIELDS[method]) picked[key] = payload[key]; // 逐字段拷贝
          dispatch({ method, ...picked }); // 派发干净事件
        } catch { /* 坏帧忽略 */ }
      };
      ws.onerror = () => { // 连接错误
        if (!opened) reject(new Error(`${label} connect error`)); // 未连上则失败
      };
      ws.onclose = () => { // 关闭（服务端断开或我们主动停）
        if (!opened) reject(new Error(`${label} closed before open`)); // 未连上即关 = 失败
        else if (running) scheduleReconnect(); // 运行中意外断开 → 排定重连
      };
    });
  }

  // 派发一帧到语义事件
  function dispatch(frame) {
    const { method } = frame; // 帧方法
    if (method === 'host/session-status') { // 回合状态
      emitter.emit(frame.running ? 'turn-started' : 'turn-completed', { sessionId: frame.sessionId }); // 转成语义事件
    } else if (method === 'approval/requested') { // 审批请求
      emitter.emit('approval-requested', frame); // 转发
    } else if (method === 'question/requested') { // 提问
      emitter.emit('question-requested', frame); // 转发
    } else if (method === 'approval/resolved') { // 审批解决
      emitter.emit('approval-resolved', frame); // 转发
    } else if (method === 'host/agent-error') { // 任务出错
      emitter.emit('agent-error', frame); // 转发
    }
  }

  // 启动：并行连接两条流
  async function start() {
    running = true; // 标记运行
    try {
      await Promise.all([ // 并行连接
        connectStream('/api/events.host', 'host'),
        connectStream('/api/events.mux', 'mux')
      ]);
      retryDelay = RETRY_MIN_MS; // 成功后重置退避
      emitter.emit('reconnected'); // 通知已连接
    } catch { // 任一连接失败 → 统一重连
      if (!running) return; // 停止中退出
      emitter.emit('disconnected'); // 通知断线
      scheduleReconnect(); // 排定重连
    }
  }

  // 指数退避重连
  function scheduleReconnect() {
    if (reconnectTimer || !running) return; // 已有任务或已停止
    reconnectTimer = setTimeout(async () => { // 延迟后重试
      reconnectTimer = null; // 清引用
      sockets = sockets.filter((s) => s.readyState === WebSocket.OPEN); // 清掉死连接引用
      try {
        await start(); // 重连（内部递归管理）
      } catch {
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS); // 失败翻倍延迟
        scheduleReconnect(); // 继续排定
      }
    }, retryDelay); // 按当前延迟
  }

  // 停止桥（应用退出时调用）
  function stop() {
    running = false; // 停止标记
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } // 清重连定时器
    for (const ws of sockets) { try { ws.close(); } catch { /* 已关闭忽略 */ } } // 关闭所有连接
    sockets = []; // 清空登记
  }

  // 订阅语义事件（返回退订函数）
  function on(event, fn) {
    emitter.on(event, fn); // 注册
    return () => emitter.off(event, fn); // 返回退订
  }

  return { start, stop, on };
}
