/**
 * shared/mailer.js
 * 플랫폼 공통 메일 발송 유틸 — Brevo(구 Sendinblue) HTTP API 기반.
 * 모든 앱/배치잡이 require해서 재사용하며, 발송 시도는 항상 platform_mail_log에 기록된다.
 * 발신자 주소는 SMTP_FROM 환경변수 하나로 전 프로젝트가 동일하게 사용한다 (프로젝트별 발신자 지정 기능 없음).
 *
 * Railway 등 일부 호스팅 환경은 아웃바운드 SMTP 계열 포트(25/465/587/2525)를 막아두는 경우가 있어
 * (Gmail/Brevo SMTP 전부 connection timeout으로 확인됨) raw SMTP 대신 HTTPS(443)로 통신하는
 * Brevo REST API로 발송한다. 443은 이 서버가 이미 문제없이 쓰는 포트라 막힐 가능성이 없다.
 *
 * 발송 사용 예:
 *   const { sendMail } = require('../../shared/mailer');
 *   await sendMail({ to: 'a@b.com', subject: '제목', text: '본문', appPrefix: '/mdboard' });
 *
 * 프로젝트 자체 발송 이력 조회 API를 붙이고 싶으면 mailLogRouter를 마운트:
 *   // projects/mdboard/index.js
 *   const { mailLogRouter } = require('../../shared/mailer');
 *   router.use(mailLogRouter('/mdboard'));   // GET <prefix>/api/mail-logs
 */

const express = require('express');
const pool = require('./db');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function isConfigured() {
  return !!(process.env.BREVO_API_KEY && (process.env.SMTP_FROM || process.env.SMTP_USER));
}

/**
 * @param {{to:string, subject:string, text?:string, html?:string, appPrefix?:string, sentBy?:string}} opts
 */
async function sendMail({ to, subject, text, html, appPrefix = null, sentBy = null }) {
  if (!to?.trim() || !subject?.trim()) throw new Error('to, subject는 필수입니다');

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  let status = 'success';
  let errorMsg = null;

  try {
    if (!isConfigured()) throw new Error('메일 발송이 설정되지 않았습니다 (BREVO_API_KEY/SMTP_FROM 확인)');
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: from },
        to: [{ email: to.trim() }],
        subject: subject.trim(),
        textContent: text || undefined,
        htmlContent: html || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
    }
  } catch (e) {
    status = 'error';
    errorMsg = e.message;
  }

  await pool.query(
    `INSERT INTO platform_mail_log (to_addr, subject, status, error, app_prefix, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [to.trim(), subject.trim(), status, errorMsg, appPrefix, sentBy]
  ).catch(e => console.error('[mailer] 로그 기록 실패:', e.message));

  if (status === 'error') throw new Error(errorMsg);
  return { ok: true };
}

async function getConfigStatus() {
  return {
    configured: isConfigured(),
    provider: 'Brevo (HTTP API)',
    apiKeySet: !!process.env.BREVO_API_KEY,
    from: process.env.SMTP_FROM || process.env.SMTP_USER || null,
    fromExplicit: !!process.env.SMTP_FROM,
  };
}

/**
 * @param {{appPrefix?:string, sentBy?:string, limit?:number}} [opts]
 */
async function getLogs({ appPrefix, sentBy, limit = 50 } = {}) {
  const conditions = [];
  const params = [];
  if (appPrefix) { params.push(appPrefix); conditions.push(`app_prefix = $${params.length}`); }
  if (sentBy) { params.push(sentBy); conditions.push(`sent_by = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM platform_mail_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * 프로젝트 라우터에 바로 마운트할 수 있는 "이 앱의 메일 발송 이력 조회" 라우터.
 * 로그인/앱 권한 가드는 loader.js가 이미 앞단(`${prefix}/api`)에서 처리하므로 여기선 신경 쓸 필요 없음.
 *
 * @param {string} appPrefix - 이 앱의 prefix (예: '/mdboard') — platform_mail_log.app_prefix로 필터링
 * @param {{scopeToSender?: boolean}} [opts] - true면 로그인한 사용자가 sentBy로 보낸 로그만 노출
 *   (앱이 개인화된 알림을 보내고 "내가 보낸 메일만" 보여주고 싶을 때 사용. 기본값 false = 앱 전체 이력 노출)
 * @returns {import('express').Router} GET /mail-logs?limit=50
 */
function mailLogRouter(appPrefix, opts = {}) {
  const router = express.Router();
  router.get('/mail-logs', async (req, res) => {
    try {
      const logs = await getLogs({
        appPrefix,
        sentBy: opts.scopeToSender ? req.user?.userId : undefined,
        limit: Number(req.query.limit) || 50,
      });
      res.json({ success: true, data: logs });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
  return router;
}

module.exports = { sendMail, getConfigStatus, getLogs, mailLogRouter, isConfigured };
