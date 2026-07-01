'use strict';

/**
 * shared/notify.js
 *
 * Discord·Telegram 구독자 알림 공통 모듈.
 * 실패해도 throw 하지 않으므로 메인 요청 흐름에 영향 없음.
 *
 * ── 환경변수 ──────────────────────────────────────────────────────────────────
 *   DISCORD_WEBHOOK_URL   Discord 채널 Webhook URL (서버 가입 = 구독)
 *   TELEGRAM_BOT_TOKEN    Telegram 봇 토큰
 *   TELEGRAM_CHAT_ID      Telegram 채널/그룹 ID  (@channelusername 또는 숫자 ID)
 *
 *   ※ 프로젝트마다 다른 채널에 보내야 한다면 opts 로 오버라이드:
 *     TRAVELLOG_DISCORD_WEBHOOK, TRAVELLOG_TELEGRAM_CHAT_ID 등 별도 변수를 만들고
 *     opts.discordWebhook / opts.telegramChatId 로 넘기면 됩니다.
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────────
 *   const notify = require('../../shared/notify');
 *
 *   // 단순 텍스트
 *   await notify.send('새 여행 기록이 등록되었습니다.');
 *
 *   // 구조화 메시지
 *   await notify.send({
 *     title:  '새 게시글',
 *     body:   '제주도 3박 4일 여행기가 업로드되었습니다.',
 *     url:    'https://fn0113.up.railway.app/travellog/42',
 *     footer: 'TravelLog',
 *     color:  notify.COLOR.SUCCESS,
 *   });
 *
 *   // 특정 채널만
 *   await notify.send({ ... }, { channels: ['telegram'] });
 *
 *   // 프로젝트별 채널 오버라이드
 *   await notify.send({ ... }, {
 *     discordWebhook:  process.env.MDBOARD_DISCORD_WEBHOOK,
 *     telegramChatId:  process.env.MDBOARD_TELEGRAM_CHAT_ID,
 *   });
 */

const https = require('https');
const http  = require('http');

// ─── 공통 색상 상수 (Discord embed color) ────────────────────────────────────
const COLOR = {
  DEFAULT : 0x5865F2, // Discord 블루
  SUCCESS : 0x2ECC71, // 초록
  WARNING : 0xF39C12, // 주황
  ERROR   : 0xE74C3C, // 빨강
  INFO    : 0x3498DB, // 파랑
};

// ─── 환경변수 기본값 ──────────────────────────────────────────────────────────
const ENV = {
  discordWebhook: process.env.DISCORD_WEBHOOK_URL  || '',
  telegramToken:  process.env.TELEGRAM_BOT_TOKEN   || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID     || '',
};

// ─── 내부: JSON POST (외부 의존성 없음) ───────────────────────────────────────
function jsonPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const data   = JSON.stringify(body);
    const parsed = new URL(urlStr);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || undefined,
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end',  ()    => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(raw);
          else reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Discord ──────────────────────────────────────────────────────────────────
async function sendDiscord(payload, cfg) {
  const webhook = cfg.discordWebhook;
  if (!webhook) return;

  const embed = {
    color:       payload.color ?? COLOR.DEFAULT,
    timestamp:   new Date().toISOString(),
    footer:      { text: payload.footer ?? 'mono-server' },
    ...(payload.title     && { title:       payload.title }),
    ...(payload.body      && { description: payload.body  }),
    ...(payload.url       && { url:         payload.url   }),
    ...(payload.fields    && { fields:      payload.fields }),
    ...(payload.thumbnail && { thumbnail:   { url: payload.thumbnail } }),
    ...(payload.image     && { image:       { url: payload.image     } }),
  };

  await jsonPost(webhook, {
    ...(payload.username && { username: payload.username }),
    embeds: [embed],
  });
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
function escapeTg(str) {
  // HTML 모드 이스케이프 (MarkdownV2보다 단순)
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegram(payload, cfg) {
  const token  = cfg.telegramToken;
  const chatId = cfg.telegramChatId;
  if (!token || !chatId) return;

  const lines = [];
  if (payload.title)  lines.push(`<b>${escapeTg(payload.title)}</b>`);
  if (payload.body)   lines.push(escapeTg(payload.body));
  if (payload.fields) {
    payload.fields.forEach(f =>
      lines.push(`<b>${escapeTg(f.name)}</b>: ${escapeTg(f.value)}`)
    );
  }
  if (payload.url)    lines.push(`<a href="${escapeTg(payload.url)}">🔗 자세히 보기</a>`);
  if (payload.footer) lines.push(`\n<i>${escapeTg(payload.footer)}</i>`);

  await jsonPost(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id:                  chatId,
      text:                     lines.join('\n\n'),
      parse_mode:               'HTML',
      disable_web_page_preview: false,
    }
  );
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * @typedef {object} NotifyPayload
 * @property {string}   [title]      제목 (굵게 표시)
 * @property {string}   [body]       본문
 * @property {string}   [url]        링크 URL
 * @property {string}   [footer]     출처 표시 (기본: 'mono-server')
 * @property {number}   [color]      Discord embed 색상 정수 (notify.COLOR 상수 사용)
 * @property {string}   [thumbnail]  Discord 우측 썸네일 이미지 URL
 * @property {string}   [image]      Discord 하단 큰 이미지 URL
 * @property {string}   [username]   Discord Webhook 표시 이름 오버라이드
 * @property {{ name: string, value: string, inline?: boolean }[]} [fields]
 *
 * @typedef {object} NotifyOptions
 * @property {('discord'|'telegram')[]} [channels]      전송할 채널 목록 (기본: 설정된 채널 전부)
 * @property {string} [discordWebhook]   프로젝트별 Webhook URL
 * @property {string} [telegramToken]    프로젝트별 봇 토큰
 * @property {string} [telegramChatId]   프로젝트별 Chat ID
 */

/**
 * 구독자에게 알림을 전송합니다.
 *
 * @param {string | NotifyPayload} message
 * @param {NotifyOptions} [opts]
 * @returns {Promise<PromiseSettledResult[]>}
 */
async function send(message, opts = {}) {
  const cfg     = { ...ENV, ...opts };
  const payload = typeof message === 'string' ? { body: message } : message;

  // 채널 자동 감지: 환경변수가 설정된 것만 포함
  const channels = opts.channels ?? [
    ...(cfg.discordWebhook                          ? ['discord']  : []),
    ...(cfg.telegramToken && cfg.telegramChatId     ? ['telegram'] : []),
  ];

  if (channels.length === 0) {
    console.warn('[notify] 전송할 채널이 없습니다. DISCORD_WEBHOOK_URL 또는 TELEGRAM_* 환경변수를 확인하세요.');
    return [];
  }

  const tasks = channels.map(ch =>
    ch === 'discord' ? sendDiscord(payload, cfg) : sendTelegram(payload, cfg)
  );

  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[notify] ${channels[i]} 전송 실패:`, r.reason?.message ?? r.reason);
    }
  });

  return results;
}

module.exports = { send, COLOR };
