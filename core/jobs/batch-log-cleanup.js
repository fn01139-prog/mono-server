/**
 * core/jobs/batch-log-cleanup.js
 * 180일이 지난 배치 실행 로그(platform_batch_log)를 정리한다. (자기 자신 로그 포함)
 */
module.exports = {
  id: 'batch-log-cleanup',
  name: '배치 실행 로그 정리',
  schedule: '30 3 * * *', // 매일 03:30
  description: '180일 이전 배치 실행 로그를 삭제합니다.',
  run: async (pool) => {
    const { rowCount } = await pool.query(
      `DELETE FROM platform_batch_log WHERE started_at < NOW() - INTERVAL '180 days'`
    );
    return `${rowCount}건 삭제`;
  },
};
