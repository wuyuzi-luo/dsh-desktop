// 协议探针：独立 Node 脚本（不依赖 Electron），用 WebSocket 连 dsh 两条事件流
// 打印收到的帧方法名与 payload，验证桌面通知的信号源协议可用
// 用法：node test/sse-probe.js [port=3080] [seconds=15]

const port = Number(process.argv[2] ?? 3080); // 目标端口（默认 3080）
const seconds = Number(process.argv[3] ?? 15); // 监听时长（默认 15 秒）
const seen = new Set(); // 见过的帧方法名（去重计数）

// 连接并监听一条 WS 事件流
function listenStream(path, label) {
  return new Promise((resolve) => { // 连接结果包装
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`); // 直连
    ws.onopen = () => { // 成功
      console.log(`[${label}] WS 连接成功`); // 打印
      // 不发送任何消息：dsh 的 WS 为纯下行，发消息会被 1008 踢掉
      resolve(); // 决议
    };
    ws.onmessage = (ev) => { // 收帧
      try {
        const obj = JSON.parse(String(ev.data)); // 解析信封
        const method = obj?.method ?? '(未知)'; // 帧方法
        const key = `${label}:${method}`; // 去重键
        if (seen.has(key)) return; // 见过的只数一次
        seen.add(key); // 记录
        console.log(`[${label}] 帧: ${method} ${JSON.stringify(obj?.payload ?? obj).slice(0, 140)}`); // 打印
      } catch { /* 坏帧忽略 */ }
    };
    ws.onerror = () => console.log(`[${label}] WS 错误`); // 错误打印
    ws.onclose = () => console.log(`[${label}] WS 关闭`); // 关闭打印
  });
}

// 主流程：并行监听两条流，到时间退出
console.log(`协议探针开始：端口 ${port}，监听 ${seconds} 秒（期间在 dsh 里发个任务效果最佳）`); // 提示
await Promise.all([listenStream('/api/events.host', 'host'), listenStream('/api/events.mux', 'mux')]); // 双流
await new Promise((r) => setTimeout(r, seconds * 1000)); // 定时等待
console.log('探针结束。'); // 收尾
process.exit(0); // 退出
