/**
 * shared/notify/index.js
 * 플랫폼 공통 메신저 알림 모듈 — 텔레그램/디스코드/ntfy/웹푸시로 다중 수신자(본인/가족/지인)에게 발송.
 * 모든 앱이 require해서 재사용하며, 카테고리(어느 프로젝트의 어떤 알림인지) 단위로 구독을 관리한다.
 *
 * 사용 예:
 *   const notify = require('../../shared/notify');
 *   await notify.registerCategory('camp-check', '캠핑 체크리스트', '/campchecklist'); // 앱 시작 시 1회
 *   await notify.send({ category: 'camp-check', title: '캠핑 3일 전!', body: '텐트 챙기셨나요?' });
 *
 * 채널 추가 방법: shared/notify/channels/<name>.js 에 { name, send(config, {title, body, url}) } export 후
 * 아래 channels 레지스트리와 CHANNEL_TABLES(db.js), DEFAULT_CHANNELS에 등록.
 */

const pool = require('../db');
const db = require('./db');

const channels = {
  telegram: require('./channels/telegram'),
  discord: require('./channels/discord'),
  ntfy: require('./channels/ntfy'),
  webpush: require('./channels/webpush'),
  fcm: require('./channels/fcm'),
};

const DEFAULT_CHANNELS = Object.keys(channels);

/** 프로젝트가 알림을 처음 쓸 때 1회 호출 → 카테고리 등록 + 기존 'self' 수신자는 자동 구독 (여러 번 호출해도 안전) */
async function registerCategory(key, name, project) {
  const cat = await db.getOrCreateCategory(key, name, project);
  await pool.query(
    `INSERT INTO notify_subscriptions (recipient_id, category_id, channels)
     SELECT id, $1, $2 FROM notify_recipients WHERE relation = 'self'
     ON CONFLICT (recipient_id, category_id) DO NOTHING`,
    [cat.id, DEFAULT_CHANNELS]
  );
  return cat;
}

/**
 * 카테고리 구독자 전체(또는 recipientIds로 지정한 대상)에게 발송.
 * @param {{category:string, title?:string, body:string, recipientIds?:number[], channels?:string[], url?:string}} opts
 */
async function send({ category, title, body, recipientIds, channels: forceChannels, url }) {
  const cat = await db.getOrCreateCategory(category);
  const subs = await db.getActiveSubscriptions(cat.id, recipientIds);

  const tasks = subs.flatMap((sub) => {
    const useChannels = forceChannels || sub.channels;
    return useChannels.map((ch) => sendToChannel({
      channel: ch, categoryId: cat.id, recipientId: sub.recipient_id, title, body, url,
    }));
  });

  return Promise.allSettled(tasks);
}

/**
 * 특정 수신자의 특정 채널로 직접 발송 (구독 여부와 무관 — admin 콘솔 테스트 발송, 예약 알림 등).
 * 그 채널에 기기/연결이 여러 개(예: 웹푸시를 PC·모바일 양쪽에서 구독)면 전부에게 보낸다.
 * categoryId를 넘기면 notify_log에 카테고리가 함께 기록되어 나중에 getLog({ category })로
 * 조회할 수 있다(예: totalprice AI 알림의 발송 이력) — 구독 여부와는 무관하게 항상 발송된다.
 * @returns {Promise<{sent:number, failed:number, total:number}>}
 */
async function sendTest({ recipientId, channel, title, body, categoryId = null }) {
  return sendToChannel({ channel, categoryId, recipientId, title, body });
}

/** 한 채널 타입에 연결된 기기/연결 전부에 보낸다 (웹푸시 여러 기기 등) — 하나가 실패해도 나머지는 계속 시도 */
async function sendToChannel({ channel, categoryId, recipientId, title, body, url }) {
  const adapter = channels[channel];
  if (!adapter) throw new Error(`알 수 없는 채널: ${channel}`);

  const configs = await db.getChannelConfigs(recipientId, channel);
  if (!configs.length) throw new Error(`이 수신자에게 연결된 ${channel} 채널이 없습니다`);

  const results = await Promise.allSettled(
    configs.map((config) => sendToConfig(adapter, config, { channel, categoryId, recipientId, title, body, url }))
  );
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;

  if (sent === 0) {
    const firstError = results.find((r) => r.status === 'rejected');
    throw new Error(failed > 1 ? `전체 ${failed}건 발송 실패 (예: ${firstError.reason.message})` : firstError.reason.message);
  }
  return { sent, failed, total: results.length };
}

async function sendToConfig(adapter, config, { channel, categoryId, recipientId, title, body, url }) {
  try {
    await adapter.send(config, { title, body, url });
    await db.logResult({ categoryId, recipientId, channel, title, body, status: 'success' });
  } catch (e) {
    await db.logResult({ categoryId, recipientId, channel, title, body, status: 'fail', error: e.message });
    // 웹푸시/FCM 구독이 만료/해지된 경우(404/410) 죽은 구독으로 계속 재시도하지 않도록 비활성화
    if ((channel === 'webpush' || channel === 'fcm') && (e.statusCode === 404 || e.statusCode === 410)) {
      await db.deactivateChannel(channel, config.id).catch(() => {});
    }
    throw e;
  }
}

module.exports = { registerCategory, send, sendTest, getLog: db.getLog, channels };
