/**
 * core/jobs/totalprice-stocklist-refresh.js
 * Npay 증권(finance.naver.com) 시가총액 페이지에서 코스피/코스닥 전 종목의
 * 코드+명칭을 크롤링해 totalprice_stocks 테이블을 갱신한다.
 */
const { fetchAllListedStocks } = require('../../projects/totalprice/lib/naverStock');

module.exports = {
  id: 'totalprice-stocklist-refresh',
  name: '주식 종목 목록 갱신',
  schedule: '0 4 * * 0', // 매주 일요일 04:00
  description: 'Npay 증권에서 코스피/코스닥 전 종목 코드+명칭을 크롤링해 totalprice_stocks에 반영합니다.',
  run: async (pool) => {
    const stocks = await fetchAllListedStocks({ delayMs: 150 });
    if (stocks.length === 0) throw new Error('크롤링 결과가 비어있습니다 (페이지 구조 변경 가능성)');

    // 한 행씩 순차 upsert하면 원격 DB 왕복 지연 때문에 수천 개 종목에 수 분이 걸리고,
    // 그 동안 열려있는 트랜잭션이 다른 세션의 DDL(마이그레이션)을 락으로 막는다.
    // → CHUNK_SIZE개씩 묶어 멀티로우 INSERT로 왕복 횟수를 줄인다.
    const CHUNK_SIZE = 200;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < stocks.length; i += CHUNK_SIZE) {
        const chunk = stocks.slice(i, i + CHUNK_SIZE);
        const values = [];
        const placeholders = chunk.map(({ code, name, market }, j) => {
          const base = j * 3;
          values.push(code, name, market);
          return `($${base + 1}, $${base + 2}, $${base + 3}, NOW())`;
        });
        await client.query(
          `INSERT INTO totalprice_stocks (code, name, market, updated_at)
           VALUES ${placeholders.join(', ')}
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, market = EXCLUDED.market, updated_at = NOW()`,
          values
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return `${stocks.length}개 종목 갱신 완료`;
  },
};
