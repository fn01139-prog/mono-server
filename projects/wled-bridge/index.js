require('dotenv').config();
const WebSocket = require('ws');

const {
  RAILWAY_WS_URL,
  AGENT_SECRET,
  DEVICE_ID,
  WLED_HOST,
} = process.env;

if (!RAILWAY_WS_URL || !AGENT_SECRET || !DEVICE_ID || !WLED_HOST) {
  console.error('[agent] .env 설정이 누락되었습니다. .env.example을 참고해 .env를 채워주세요.');
  process.exit(1);
}

let ws = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  const url = `${RAILWAY_WS_URL}?token=${encodeURIComponent(AGENT_SECRET)}&deviceId=${encodeURIComponent(DEVICE_ID)}`;
  console.log(`[agent] connecting to ${RAILWAY_WS_URL} as "${DEVICE_ID}"`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[agent] connected');
    reconnectDelay = 1000; // 연결 성공 시 백오프 초기화
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.error('[agent] invalid message from server:', err.message);
      return;
    }

    if (msg.type === 'command') {
      const result = await executeWledCommand(msg.action, msg.value);
      safeSend({
        type: 'ack',
        requestId: msg.requestId,
        success: result.ok,
        error: result.error,
      });
    }
  });

  ws.on('close', (code) => {
    console.warn(`[agent] disconnected (code ${code}), retrying in ${reconnectDelay}ms`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[agent] socket error:', err.message);
  });
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function safeSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

async function executeWledCommand(action, value = {}) {
  const payload = buildWledPayload(action, value);
  if (!payload) {
    return { ok: false, error: `unknown action: ${action}` };
  }

  try {
    const res = await fetch(`http://${WLED_HOST}/json/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { ok: false, error: `WLED responded with ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildWledPayload(action, value) {
  switch (action) {
    case 'on':
      return { on: true };
    case 'off':
      return { on: false };
    case 'brightness':
      // value.level: 0-255
      return { on: true, bri: clamp(value.level, 0, 255) };
    case 'color':
      // value: { r, g, b }
      return {
        on: true,
        seg: [{ col: [[clamp(value.r, 0, 255), clamp(value.g, 0, 255), clamp(value.b, 0, 255)]] }],
      };
    case 'preset':
      // value.id: WLED에 저장된 프리셋 번호
      return { ps: value.id };
    default:
      return null;
  }
}

function clamp(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

connect();

process.on('SIGINT', () => {
  console.log('[agent] shutting down');
  if (ws) ws.close();
  process.exit(0);
});

