/**
 * shared/notify/channels/webpush.js
 * config: { endpoint, p256dh, auth }. VAPID_SUBJECT/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 환경변수 필요.
 *
 * 참고: 이 어댑터는 발송 로직만 구현되어 있고, 브라우저가 구독을 등록하는
 * 프론트엔드 플로우(서비스워커 + 구독 버튼)는 아직 없다 — notify_push_subscriptions에
 * 구독을 채워 넣는 별도 작업이 필요하다.
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
  await webpush.sendNotification(sub, JSON.stringify({ title, body, url }));
}

module.exports = { name: 'webpush', send };
