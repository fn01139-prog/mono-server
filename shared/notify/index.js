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
    return useChannels.map((ch) => sendOne({
      channel: ch, categoryId: cat.id, recipientId: sub.recipient_id, title, body, url,
    }));
  });

  return Promise.allSettled(tasks);
}

/** 특정 수신자의 특정 채널로 직접 발송 (구독 여부와 무관 — admin 콘솔 테스트 발송용) */
async function sendTest({ recipientId, channel, title, body }) {
  return sendOne({ channel, categoryId: null, recipientId, title, body });
}

async function sendOne({ channel, categoryId, recipientId, title, body, url }) {
  const adapter = channels[channel];
  if (!adapter) throw new Error(`알 수 없는 채널: ${channel}`);

  const config = await db.getChannelConfig(recipientId, channel);
  if (!config) throw new Error(`이 수신자에게 연결된 ${channel} 채널이 없습니다`);

  try {
    await adapter.send(config, { title, body, url });
    await db.logResult({ categoryId, recipientId, channel, title, body, status: 'success' });
  } catch (e) {
    await db.logResult({ categoryId, recipientId, channel, title, body, status: 'fail', error: e.message });
    throw e;
  }
}

module.exports = { registerCategory, send, sendTest, getLog: db.getLog, channels };
