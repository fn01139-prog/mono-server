/**
 * shared/notify/channels/discord_dm.js
 * config: { discord_user_id }. DISCORD_BOT_TOKEN 환경변수 필요.
 * notify_discord_channels(웹훅, 채널 게시용)와 달리 봇이 유저 개인에게 DM을 보낸다 —
 * 봇과 수신자가 같은 서버(길드)에 있어야 발송 가능 (Discord 정책, 자격 조건일 뿐 실제
 * 발송 대상과는 무관 — https://discord.com/developers/applications 에서 봇 생성 → 비공개
 * 서버에 초대 → 알림 받을 사람도 그 서버에 초대 → 각자 User ID를 admin 콘솔/내 알림 설정에 등록).
 * Gateway 연결(discord.js) 없이 REST만으로 DM 채널 생성 후 메시지 전송.
 */
const API_BASE = 'https://discord.com/api/v10';
const EMBED_COLOR = 0x5865f2; // Discord 블루

async function send(config, { title, body, url }) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN이 설정되지 않았습니다');
  if (!config.discord_user_id) throw new Error('discord_user_id가 설정되지 않았습니다');

  const headers = { 'content-type': 'application/json', authorization: `Bot ${token}` };

  const dmRes = await fetch(`${API_BASE}/users/@me/channels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recipient_id: config.discord_user_id }),
  });
  if (!dmRes.ok) {
    const errBody = await dmRes.text().catch(() => '');
    throw new Error(`Discord DM 채널 생성 실패: ${dmRes.status} ${errBody.slice(0, 200)}`);
  }
  const { id: dmChannelId } = await dmRes.json();

  const embed = {
    color: EMBED_COLOR,
    timestamp: new Date().toISOString(),
    footer: { text: 'mono-server' },
    ...(title && { title }),
    ...(body && { description: body }),
    ...(url && { url }),
  };

  const msgRes = await fetch(`${API_BASE}/channels/${dmChannelId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!msgRes.ok) {
    const errBody = await msgRes.text().catch(() => '');
    throw new Error(`Discord DM 전송 실패: ${msgRes.status} ${errBody.slice(0, 200)}`);
  }
}

module.exports = { name: 'discord_dm', send };
