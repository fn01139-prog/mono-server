/**
 * shared/mailer.js
 * 플랫폼 공통 메일 발송 유틸 — SMTP_* 환경변수 기반.
 * 모든 앱/배치잡이 require해서 재사용하며, 발송 시도는 항상 platform_mail_log에 기록된다.
 * 발신자 주소는 SMTP_FROM 환경변수 하나로 전 프로젝트가 동일하게 사용한다 (프로젝트별 발신자 지정 기능 없음).
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
const nodemailer = require('nodemailer');
const pool = require('./db');

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter = null;
function getTransporter() {
  if (!isConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
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
    const tx = getTransporter();
    if (!tx) throw new Error('SMTP가 설정되지 않았습니다 (SMTP_HOST/SMTP_USER/SMTP_PASS 확인)');
    await tx.sendMail({ from, to, subject, text, html });
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
    host: process.env.SMTP_HOST || null,
    port: process.env.SMTP_PORT || null,
    secure: process.env.SMTP_SECURE === 'true',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || null,
    fromExplicit: !!process.env.SMTP_FROM, // false면 SMTP_USER로 폴백 중이라는 뜻
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
