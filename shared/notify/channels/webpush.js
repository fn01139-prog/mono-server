/**
 * shared/notify/channels/webpush.js
 * config: { endpoint, p256dh, auth }. VAPID_SUBJECT/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 환경변수 필요.
 * 구독 등록은 admin 콘솔 알림 탭의 "이 브라우저를 웹푸시로 구독" 버튼(shared/public/sw.js) 참고.
 */
const webpush = require('web-push');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('VAPID_SUBJECT/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY가 설정되지 않았습니다');
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

async function send(config, { title, body, url }) {
  ensureConfigured();
  const sub = { endpoint: config.endpoint, keys: { p256dh: config.p256dh, auth: config.auth } };
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body, url }));
  } catch (e) {
    // web-push의 WebPushError는 실제 원인(만료된 구독, VAPID 키 불일치 등)이 statusCode/body에
    // 담겨있는데 기본 e.message("Received unexpected response code")는 이걸 다 숨긴다.
    if (e.statusCode) {
      throw new Error(`웹푸시 전송 실패 (HTTP ${e.statusCode}): ${String(e.body || e.message || '').slice(0, 300)}`);
    }
    throw e;
  }
}

module.exports = { name: 'webpush', send };
