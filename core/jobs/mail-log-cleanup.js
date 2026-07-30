/**
 * core/jobs/mail-log-cleanup.js
 * 90일이 지난 메일 발송 로그(platform_mail_log)를 정리한다.
 */
module.exports = {
  id: 'mail-log-cleanup',
  name: '메일 발송 로그 정리',
  schedule: '0 3 * * *', // 매일 03:00
  description: '90일 이전 메일 발송 로그를 삭제합니다.',
  run: async (pool) => {
    const { rowCount } = await pool.query(
      `DELETE FROM platform_mail_log WHERE created_at < NOW() - INTERVAL '90 days'`
    );
    return `${rowCount}건 삭제`;
  },
};
