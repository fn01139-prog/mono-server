/**
 * shared/notify/channels/fcm.js
 * config: { fcm_token }. FIREBASE_SERVICE_ACCOUNT 환경변수(서비스 계정 JSON을 base64 인코딩) 필요.
 * 토큰 발급/등록은 모바일 앱(mobileweb)이 로그인 후 POST /auth/notify/channels {type:'fcm', fcmToken, platform, deviceLabel}로 처리.
 */
const admin = require('firebase-admin');

let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT가 설정되지 않았습니다');
  const serviceAccount = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  initialized = true;
}

async function send(config, { title, body, url }) {
  ensureInitialized();
  try {
    await admin.messaging().send({
      token: config.fcm_token,
      notification: { title, body },
      data: url ? { url } : undefined,
    });
  } catch (e) {
    // 삭제된 앱/만료된 토큰 — 웹푸시의 404/410과 동일한 방식으로 죽은 구독 비활성화 처리되도록 표준화
    if (e.code === 'messaging/registration-token-not-registered' || e.code === 'messaging/invalid-registration-token') {
      const err = new Error(`FCM 전송 실패: ${e.message}`);
      err.statusCode = 410;
      throw err;
    }
    throw e;
  }
}

module.exports = { name: 'fcm', send };
