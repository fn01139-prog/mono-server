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

async function fetchGoldPrice({ type = 'Au', startDate, endDate } = {}) {
  if (!VALID_TYPES.has(type)) type = 'Au';
  const defaults = defaultDateRange();
  const dataDateStart = startDate || defaults.start;
  const dataDateEnd = endDate || defaults.end;

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

  return { type, dataDateStart, dataDateEnd, list: json.list || [] };
}

module.exports = { fetchGoldPrice, defaultDateRange };
