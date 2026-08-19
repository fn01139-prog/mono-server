// projects/wled-bridge/index.js
//
// 기존 mono-server의 projects/ 오토디스커버리 로더에 맞춰 통합하세요.
// 이 모듈은 두 가지를 제공합니다.
//   1. router              - Express 라우터 (IFTTT 웹훅 수신용, /wled-bridge 아래에 mount)
//   2. attachWss(server)   - 기존 HTTP 서버 인스턴스에 WebSocket 업그레이드를 붙이는 함수
//
// 로더가 다른 형태의 export를 기대한다면 맨 아래 module.exports만 맞춰 조정하면 됩니다.
// 필요한 환경변수: IFTTT_SECRET, WLED_AGENT_SECRET

const express = require('express');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const IFTTT_SECRET = process.env.IFTTT_SECRET;
const AGENT_SECRET = process.env.WLED_AGENT_SECRET;
const ACK_TIMEOUT_MS = 5000;

const router = express.Router();

// deviceId -> { ws, lastSeen }
const agents = new Map();
// requestId -> { resolve }
const pending = new Map();

const ALLOWED_ACTIONS = new Set(['on', 'off', 'brightness', 'color', 'preset']);

router.use(express.json());

// IFTTT Webhooks가 호출하는 엔드포인트
router.post('/webhook', (req, res) => {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${IFTTT_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { action, deviceId, value } = req.body || {};

  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: `invalid action: ${action}` });
  }
  if (typeof deviceId !== 'string' || !deviceId) {
    return res.status(400).json({ error: 'deviceId required' });
  }

  const agent = agents.get(deviceId);
  if (!agent || agent.ws.readyState !== agent.ws.OPEN) {
    return res.status(503).json({ error: 'device offline' });
  }

  const requestId = crypto.randomUUID();

  const timeout = setTimeout(() => {
    pending.delete(requestId);
    res.status(504).json({ error: 'agent timeout' });
  }, ACK_TIMEOUT_MS);

  pending.set(requestId, {
    resolve: (result) => {
      clearTimeout(timeout);
      pending.delete(requestId);
      if (result.success) {
        res.status(200).json({ ok: true });
      } else {
        res.status(502).json({ error: result.error || 'agent reported failure' });
      }
    },
  });

  agent.ws.send(JSON.stringify({ type: 'command', requestId, action, value }));
});

// 상태 확인용 (디버깅/모니터링, 필요 없으면 삭제해도 무방)
router.get('/status', (_req, res) => {
  const list = Array.from(agents.entries()).map(([deviceId, a]) => ({
    deviceId,
    connected: a.ws.readyState === a.ws.OPEN,
    lastSeen: a.lastSeen,
  }));
  res.json(list);
});

function attachWss(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/wled-bridge/agent')) return; // 다른 경로는 다른 모듈이 처리하도록 무시

    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const deviceId = url.searchParams.get('deviceId');

    if (token !== AGENT_SECRET || !deviceId) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, deviceId);
    });
  });

  wss.on('connection', (ws, deviceId) => {
    console.log(`[wled-bridge] agent connected: ${deviceId}`);
    agents.set(deviceId, { ws, lastSeen: new Date() });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const entry = agents.get(deviceId);
      if (entry) entry.lastSeen = new Date();

      if (msg.type === 'ack' && pending.has(msg.requestId)) {
        pending.get(msg.requestId).resolve(msg);
      }
    });

    ws.on('close', () => {
      console.log(`[wled-bridge] agent disconnected: ${deviceId}`);
      agents.delete(deviceId);
    });
  });

  // 30초마다 죽은 연결 정리
  setInterval(() => {
    for (const [deviceId, agent] of agents.entries()) {
      if (agent.ws.readyState !== agent.ws.OPEN) {
        agents.delete(deviceId);
      }
    }
  }, 30000);
}

module.exports = { router, attachWss };
