/**
 * shared/mailer.js
 * 플랫폼 공통 메일 발송 유틸 — SMTP_* 환경변수 기반.
 * 모든 앱/배치잡이 require해서 재사용하며, 발송 시도는 항상 platform_mail_log에 기록된다.
 *
 * 사용 예:
 *   const { sendMail } = require('../../shared/mailer');
 *   await sendMail({ to: 'a@b.com', subject: '제목', text: '본문', appPrefix: '/mdboard' });
 */

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
  };
}

async function getLogs(limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM platform_mail_log ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

module.exports = { sendMail, getConfigStatus, getLogs, isConfigured };
