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
    // 404/410/403은 "요청은 도달했는데 그 주소를 더 이상 안 받아준다"는 뜻이라 대부분
    // 사이트 개편으로 엔드포인트가 바뀌었을 때 나는 상태코드다 — 원인을 바로 알 수 있게 명시.
    const urlHint = [404, 410, 403].includes(res.status)
      ? ` — koreagoldx.co.kr가 API 주소를 변경했을 가능성이 있습니다. ${API_URL} 가 여전히 유효한지 확인이 필요합니다.`
      : '';
    throw new Error(`koreagoldx API 요청 실패 (HTTP ${res.status})${urlHint}: ${text.slice(0, 200)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // 비공식 API가 JSON 대신 HTML(에러 페이지 등)을 돌려주는 경우도 사이트 개편으로 엔드포인트
    // 구조가 바뀌었을 때 흔히 나는 증상이다.
    throw new Error(
      `koreagoldx API 응답이 JSON이 아닙니다 — koreagoldx.co.kr가 API 형식을 변경했을 가능성이 있습니다. `
      + `${API_URL} 가 여전히 유효한지 확인이 필요합니다: ${text.slice(0, 200)}`
    );
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
