/**
 * shared/notify/db.js
 * notify_* 테이블 접근 헬퍼. shared/db.js의 공통 pool을 그대로 재사용한다.
 */

const pool = require('../db');

const CHANNEL_TABLES = {
  telegram: 'notify_telegram_channels',
  discord: 'notify_discord_channels',
  ntfy: 'notify_ntfy_channels',
  webpush: 'notify_push_subscriptions',
};

/* ── 발송 코어가 쓰는 헬퍼 ─────────────────────────────────────────────── */

async function getOrCreateCategory(key, name, project) {
  const { rows } = await pool.query(
    `INSERT INTO notify_categories (key, name, project) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET name = COALESCE(notify_categories.name, EXCLUDED.name)
     RETURNING *`,
    [key, name || key, project || null]
  );
  return rows[0];
}

async function getActiveSubscriptions(categoryId, recipientIds) {
  const params = [categoryId];
  let filter = '';
  if (recipientIds?.length) {
    params.push(recipientIds);
    filter = 'AND s.recipient_id = ANY($2)';
  }
  const { rows } = await pool.query(
    `SELECT s.* FROM notify_subscriptions s
     JOIN notify_recipients r ON r.id = s.recipient_id
     WHERE s.category_id = $1 AND s.is_active = TRUE AND r.is_active = TRUE ${filter}`,
    params
  );
  return rows;
}

async function getChannelConfig(recipientId, channel) {
  const table = CHANNEL_TABLES[channel];
  if (!table) return null;
  // 같은 채널에 채널이 여러 개(예: 웹푸시 VAPID 키 재발급 후 재구독) 있을 수 있어
  // 가장 최근에 등록된 걸 우선한다 — 안 그러면 죽은 옛날 구독으로 계속 발송을 시도하게 됨
  const { rows } = await pool.query(
    `SELECT * FROM ${table} WHERE recipient_id = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1`,
    [recipientId]
  );
  return rows[0] || null;
}

async function logResult({ categoryId = null, recipientId = null, channel, title, body, status, error = null }) {
  await pool.query(
    `INSERT INTO notify_log (category_id, recipient_id, channel, title, body, status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [categoryId, recipientId, channel, title || null, body || null, status, error]
  );
}

/**
 * @param {{recipientId?:number, category?:string, from?:string, to?:string, status?:string, limit?:number}} [opts]
 */
async function getLog({ recipientId, category, from, to, status, limit = 50 } = {}) {
  const conditions = [];
  const params = [];
  if (recipientId) { params.push(recipientId); conditions.push(`l.recipient_id = $${params.length}`); }
  if (category)    { params.push(category);    conditions.push(`c.key = $${params.length}`); }
  if (from)        { params.push(from);        conditions.push(`l.sent_at >= $${params.length}`); }
  if (to)          { params.push(to);          conditions.push(`l.sent_at <= $${params.length}`); }
  if (status)       { params.push(status);      conditions.push(`l.status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT l.*, r.name AS recipient_name, c.key AS category_key, c.name AS category_name
     FROM notify_log l
     LEFT JOIN notify_recipients r ON r.id = l.recipient_id
     LEFT JOIN notify_categories c ON c.id = l.category_id
     ${where}
     ORDER BY l.sent_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

/* ── admin 콘솔용 CRUD 헬퍼 ───────────────────────────────────────────── */

async function listRecipients() {
  const { rows: recipients } = await pool.query('SELECT * FROM notify_recipients ORDER BY created_at');
  const channelCounts = await Promise.all(
    Object.entries(CHANNEL_TABLES).map(async ([type, table]) => {
      const { rows } = await pool.query(
        `SELECT recipient_id, COUNT(*)::int AS c FROM ${table} WHERE is_active = TRUE GROUP BY recipient_id`
      );
      return { type, rows };
    })
  );
  return recipients.map(r => {
    const channels = {};
    for (const { type, rows } of channelCounts) {
      channels[type] = rows.find(x => x.recipient_id === r.id)?.c || 0;
    }
    return { ...r, channels };
  });
}

async function createRecipient(name, relation) {
  const { rows } = await pool.query(
    `INSERT INTO notify_recipients (name, relation) VALUES ($1, $2) RETURNING *`,
    [name, relation || 'self']
  );
  return rows[0];
}

async function updateRecipient(id, { name, relation, isActive }) {
  if (name) await pool.query('UPDATE notify_recipients SET name = $1 WHERE id = $2', [name, id]);
  if (relation) await pool.query('UPDATE notify_recipients SET relation = $1 WHERE id = $2', [relation, id]);
  if (typeof isActive === 'boolean') {
    await pool.query('UPDATE notify_recipients SET is_active = $1 WHERE id = $2', [isActive, id]);
  }
}

async function deleteRecipient(id) {
  await pool.query('DELETE FROM notify_recipients WHERE id = $1', [id]);
}

async function listChannelsForRecipient(recipientId) {
  const result = {};
  for (const [type, table] of Object.entries(CHANNEL_TABLES)) {
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE recipient_id = $1 ORDER BY created_at`, [recipientId]);
    result[type] = rows;
  }
  return result;
}

async function addChannel(recipientId, type, config) {
  if (type === 'telegram') {
    const { rows } = await pool.query(
      `INSERT INTO notify_telegram_channels (recipient_id, chat_id) VALUES ($1, $2)
       ON CONFLICT (chat_id) DO UPDATE SET recipient_id = $1, is_active = TRUE RETURNING *`,
      [recipientId, config.chatId]
    );
    return rows[0];
  }
  if (type === 'discord') {
    const { rows } = await pool.query(
      `INSERT INTO notify_discord_channels (recipient_id, webhook_url) VALUES ($1, $2) RETURNING *`,
      [recipientId, config.webhookUrl]
    );
    return rows[0];
  }
  if (type === 'ntfy') {
    const { rows } = await pool.query(
      `INSERT INTO notify_ntfy_channels (recipient_id, topic, server) VALUES ($1, $2, $3)
       ON CONFLICT (topic) DO UPDATE SET recipient_id = $1, is_active = TRUE RETURNING *`,
      [recipientId, config.topic, config.server || 'https://ntfy.sh']
    );
    return rows[0];
  }
  if (type === 'webpush') {
    const { rows } = await pool.query(
      `INSERT INTO notify_push_subscriptions (recipient_id, endpoint, p256dh, auth, label) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET recipient_id = $1, p256dh = $3, auth = $4, is_active = TRUE RETURNING *`,
      [recipientId, config.endpoint, config.p256dh, config.auth, config.label || null]
    );
    return rows[0];
  }
  throw new Error(`알 수 없는 채널 타입: ${type}`);
}

async function deleteChannel(type, id) {
  const table = CHANNEL_TABLES[type];
  if (!table) throw new Error(`알 수 없는 채널 타입: ${type}`);
  await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

/** 죽은 채널(예: 404/410 응답 받은 웹푸시 구독)을 비활성화 — 다음부터 발송 대상에서 제외됨 */
async function deactivateChannel(type, id) {
  const table = CHANNEL_TABLES[type];
  if (!table) throw new Error(`알 수 없는 채널 타입: ${type}`);
  await pool.query(`UPDATE ${table} SET is_active = FALSE WHERE id = $1`, [id]);
}

async function listCategories() {
  const { rows } = await pool.query('SELECT * FROM notify_categories ORDER BY key');
  return rows;
}

async function listSubscriptionsForRecipient(recipientId) {
  const { rows } = await pool.query(
    `SELECT s.*, c.key AS category_key, c.name AS category_name, c.project
     FROM notify_subscriptions s JOIN notify_categories c ON c.id = s.category_id
     WHERE s.recipient_id = $1 ORDER BY c.key`,
    [recipientId]
  );
  return rows;
}

async function upsertSubscription(recipientId, categoryId, channels, isActive = true) {
  const { rows } = await pool.query(
    `INSERT INTO notify_subscriptions (recipient_id, category_id, channels, is_active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (recipient_id, category_id) DO UPDATE SET channels = $3, is_active = $4
     RETURNING *`,
    [recipientId, categoryId, channels, isActive]
  );
  return rows[0];
}

module.exports = {
  CHANNEL_TABLES,
  getOrCreateCategory, getActiveSubscriptions, getChannelConfig, logResult, getLog,
  listRecipients, createRecipient, updateRecipient, deleteRecipient,
  listChannelsForRecipient, addChannel, deleteChannel, deactivateChannel,
  listCategories, listSubscriptionsForRecipient, upsertSubscription,
};
