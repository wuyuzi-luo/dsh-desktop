// 持续探针：记录所有收到的帧到 build/probe-frames.log（应用联调期间后台跑）
const fs = require('fs');
const port = process.argv[2] ?? 3080;
const log = (line) => fs.appendFileSync('build/probe-frames.log', line + '\n');
log('=== 探针启动 ' + new Date().toLocaleTimeString() + ' ===');
function listen(path, label) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + path);
  ws.onopen = () => { log('[' + label + '] 连接成功（静默接收，不发送任何消息）'); };
  ws.onmessage = (ev) => {
    try {
      const obj = JSON.parse(String(ev.data));
      const method = obj?.method ?? '(未知)';
      log('[' + label + '] ' + new Date().toLocaleTimeString() + ' 帧: ' + method + ' ' + JSON.stringify(obj?.payload ?? obj).slice(0, 200));
    } catch {}
  };
  ws.onclose = () => { log('[' + label + '] 关闭，2秒后重连'); setTimeout(() => { try { listen(path, label); } catch {} }, 2000); };
}
listen('/api/events.host', 'host');
listen('/api/events.mux', 'mux');
// 挂 10 分钟
setTimeout(() => process.exit(0), 600000);
