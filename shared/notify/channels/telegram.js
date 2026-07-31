/**
 * shared/notify/channels/telegram.js
 * config: { chat_id }. TELEGRAM_BOT_TOKEN 환경변수 필요.
 */
async function send(config, { title, body }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN이 설정되지 않았습니다');

  const text = title ? `*${title}*\n${body || ''}` : (body || '');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.chat_id, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Telegram 전송 실패: ${res.status} ${errBody.slice(0, 200)}`);
  }
}

module.exports = { name: 'telegram', send };
