/**
 * shared/notify/channels/ntfy.js
 * config: { topic, server }. 기본 서버는 공용 https://ntfy.sh.
 */
async function send(config, { title, body }) {
  if (!config.topic) throw new Error('ntfy topic이 설정되지 않았습니다');

  const server = (config.server || 'https://ntfy.sh').replace(/\/$/, '');
  const res = await fetch(`${server}/${config.topic}`, {
    method: 'POST',
    headers: title ? { title: encodeURIComponent(title) } : {},
    body: body || '',
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`ntfy 전송 실패: ${res.status} ${errBody.slice(0, 200)}`);
  }
}

module.exports = { name: 'ntfy', send };
