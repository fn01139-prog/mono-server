/**
 * shared/notify/channels/webpush.js
 * config: { endpoint, p256dh, auth }. VAPID_SUBJECT/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 환경변수 필요.
 * 구독 등록은 admin 콘솔 알림 탭의 "이 브라우저를 웹푸시로 구독" 버튼(shared/public/sw.js) 참고.
 */
const crypto = require('crypto');
const webpush = require('web-push');

/**
 * VAPID_PUBLIC_KEY가 실제로 P-256 곡선 위의 유효한 점인지 검증.
 * web-push 라이브러리는 길이(65바이트)만 로컬에서 검사하고 곡선 유효성은 검사하지 않아서,
 * 키가 복사 과정에서 일부 손상돼도 발송 시도 후 푸시 서비스가 403으로 거부할 때까지 모른다 —
 * system check에서 미리 잡아내기 위한 헬퍼.
 */
function isValidP256PublicKey(base64urlKey) {
  if (!base64urlKey) return false;
  try {
    const buf = Buffer.from(base64urlKey.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (buf.length !== 65 || buf[0] !== 0x04) return false;
    crypto.createECDH('prime256v1').setPublicKey(buf); // 곡선 위의 점이 아니면 여기서 throw
    return true;
  } catch {
    return false;
  }
}

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

module.exports = { name: 'webpush', send, isValidP256PublicKey };
