/**
 * projects/goldprice/lib/koreagoldx.js
 * 한국금거래소 비공식 시세 API 클라이언트.
 *
 * ⚠️ 비공식 엔드포인트입니다 (koreagoldx.co.kr/api/price/chart/list).
 *    사이트 개편 시 요청 형식이나 응답 구조가 바뀔 수 있습니다.
 */
const API_URL = 'https://koreagoldx.co.kr/api/price/chart/list';
const VALID_TYPES = new Set(['Au', 'Ag', 'Pt']);

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 5); // 사이트 기본 조회기간과 동일
  return { start: formatDate(start), end: formatDate(end) };
}

const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2; // 비공식 API라 순간적인 타임아웃/네트워크 오류가 잦아 1회 재시도로 흡수
const RETRY_DELAY_MS = 700;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestOnce({ type, dataDateStart, dataDateEnd }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 브라우저처럼 보이게 하는 헤더. 차단되면 devtools에서 최신 User-Agent로 교체.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://www.koreagoldx.co.kr/price/gold',
      Origin: 'https://www.koreagoldx.co.kr',
      Accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify({ srchDt: 'SEARCH', type, dataDateStart, dataDateEnd }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`koreagoldx API 요청 실패 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`koreagoldx API 응답이 JSON이 아닙니다: ${text.slice(0, 200)}`);
  }

  return json.list || [];
}

async function fetchGoldPrice({ type = 'Au', startDate, endDate } = {}) {
  if (!VALID_TYPES.has(type)) type = 'Au';
  const defaults = defaultDateRange();
  const dataDateStart = startDate || defaults.start;
  const dataDateEnd = endDate || defaults.end;

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const list = await requestOnce({ type, dataDateStart, dataDateEnd });
      return { type, dataDateStart, dataDateEnd, list };
    } catch (e) {
      lastErr = e.name === 'TimeoutError' || e.name === 'AbortError'
        ? new Error(`koreagoldx API 응답 시간 초과 (${REQUEST_TIMEOUT_MS}ms)`)
        : e;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

module.exports = { fetchGoldPrice, defaultDateRange };
