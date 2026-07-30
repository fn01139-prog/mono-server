/**
 * shared/notify/channels/discord.js
 * config: { webhook_url }. 수신자별 웹훅 URL을 그대로 저장해서 쓰므로 별도 환경변수 불필요.
 */
const EMBED_COLOR = 0x5865f2; // Discord 블루

async function send(config, { title, body, url }) {
  if (!config.webhook_url) throw new Error('discord webhook_url이 설정되지 않았습니다');

  const embed = {
    color: EMBED_COLOR,
    timestamp: new Date().toISOString(),
    footer: { text: 'mono-server' },
    ...(title && { title }),
    ...(body && { description: body }),
    ...(url && { url }),
  };

  const res = await fetch(config.webhook_url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Discord 전송 실패: ${res.status} ${errBody.slice(0, 200)}`);
  }
}

module.exports = { name: 'discord', send };
