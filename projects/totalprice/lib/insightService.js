/**
 * projects/totalprice/lib/insightService.js
 * 종목코드 → 현재가 스냅샷/최근 시세/뉴스 수집 → Claude Haiku 4.5 분석까지의
 * 전체 파이프라인. HTTP 라우터(index.js)와 배치잡(core/jobs/totalprice-alert-runner.js)이
 * 동일한 로직을 공유하기 위해 분리했다.
 *
 * 투자 자문이 아닌 정보 참고용 — 결과에 항상 disclaimer를 포함한다.
 */
const pool = require('../../../shared/db');
const { fetchDaily, fetchSnapshot, fetchStockNews } = require('./naverStock');
const { generateInsight, InsightError } = require('./aiAdvisor');

const INSIGHT_CACHE_TTL_MS = 30 * 60 * 1000; // Anthropic API 호출 비용을 줄이기 위한 종목별 캐시
const insightCache = new Map(); // code -> { fetchedAt, data }

const INSIGHT_DISCLAIMER =
  '이 내용은 공개된 시세/뉴스 데이터를 AI(Claude Haiku 4.5)가 요약한 참고 자료이며 투자 자문이 아닙니다. ' +
  '투자 판단과 그 결과에 대한 책임은 본인에게 있습니다.';

/**
 * @param {string} code 6자리 종목코드
 * @param {{ forceRefresh?: boolean }} [opts]
 * @returns {Promise<object>} insight 데이터 (throw 시 message에 사용자에게 보여줄 이유가 담김)
 */
async function getInsight(code, { forceRefresh = false } = {}) {
  const cached = insightCache.get(code);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < INSIGHT_CACHE_TTL_MS) {
    return cached.data;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new InsightError('AI 분석 기능을 사용하려면 ANTHROPIC_API_KEY 환경변수가 필요합니다.', 'missing_api_key', 503);
  }

  const { rows: nameRows } = await pool.query('SELECT name FROM totalprice_stocks WHERE code = $1', [code]);
  const name = nameRows[0]?.name || code;

  const [snapshot, dailyRows, news] = await Promise.all([
    fetchSnapshot(code).catch(e => { console.warn('[totalprice] 스냅샷 조회 실패:', e.message); return null; }),
    fetchDaily(code, { pages: 2 }).catch(e => { console.warn('[totalprice] 일별시세 조회 실패:', e.message); return []; }),
    fetchStockNews(code, { pages: 1 }).catch(e => { console.warn('[totalprice] 뉴스 조회 실패:', e.message); return []; }),
  ]);

  if (!snapshot && dailyRows.length === 0) {
    throw new InsightError('시세 데이터를 가져오지 못해 분석을 진행할 수 없습니다.', 'data_fetch_error', 502);
  }

  const recentDaily = dailyRows.slice(0, 20).reverse(); // 오래된 → 최근 20일
  const analysis = await generateInsight({ code, name, snapshot, recentDaily, news });

  const data = {
    code,
    name,
    generatedAt: new Date().toISOString(),
    model: analysis.model,
    snapshot,
    recentDaily,
    news,
    analysis: {
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      positiveFactors: analysis.positiveFactors,
      riskFactors: analysis.riskFactors,
      watchPoints: analysis.watchPoints,
    },
    disclaimer: INSIGHT_DISCLAIMER,
  };

  insightCache.set(code, { fetchedAt: Date.now(), data });
  return data;
}

module.exports = { getInsight, INSIGHT_DISCLAIMER };
