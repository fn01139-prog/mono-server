/**
 * projects/totalprice/lib/naverStock.js
 * Npay 증권(finance.naver.com) 비공식 페이지 크롤러.
 *
 * ⚠️ 공식 API가 아닙니다. 페이지 구조가 바뀌면 파싱이 깨질 수 있습니다.
 *    페이지별로 인코딩이 다르다(item/sise_day 등 구형 페이지는 EUC-KR, item/main 등은 UTF-8)
 *    → 응답 Content-Type의 charset을 그대로 읽어 디코딩한다.
 */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://finance.naver.com/',
  Accept: 'text/html,application/xhtml+xml',
};

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`요청 실패 (HTTP ${res.status}): ${url}`);
  const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1] || 'utf-8';
  return new TextDecoder(charset).decode(await res.arrayBuffer());
}

function toNumber(str) {
  const n = Number(String(str).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * 코스피(sosok=0)/코스닥(sosok=1) 시가총액 페이지에서 종목코드+명칭 목록을 가져온다.
 */
async function fetchMarketListPage(sosok, page) {
  const html = await fetchHtml(
    `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`
  );
  const rows = [...html.matchAll(/<a href="\/item\/main\.naver\?code=(\d{6})" class="tltle">([^<]+)<\/a>/g)];
  return rows.map(([, code, name]) => ({ code, name: name.trim() }));
}

async function fetchMarketListLastPage(sosok) {
  const html = await fetchHtml(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=1`);
  const m = html.match(new RegExp(`sise_market_sum\\.naver\\?sosok=${sosok}&amp;page=(\\d+)[^>]*>\\s*맨뒤`));
  return m ? Number(m[1]) : 1;
}

/**
 * 코스피/코스닥 전 종목(code, name, market)을 크롤링한다. 페이지 사이에 짧은 지연을 둔다.
 */
async function fetchAllListedStocks({ onProgress, delayMs = 150 } = {}) {
  const markets = [
    { sosok: 0, market: 'KOSPI' },
    { sosok: 1, market: 'KOSDAQ' },
  ];
  const result = [];

  for (const { sosok, market } of markets) {
    const lastPage = await fetchMarketListLastPage(sosok);
    for (let page = 1; page <= lastPage; page++) {
      const rows = await fetchMarketListPage(sosok, page);
      rows.forEach(r => result.push({ ...r, market }));
      if (onProgress) onProgress({ market, page, lastPage });
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return result;
}

/**
 * 종목별 일별 시세(날짜/종가/전일비/시가/고가/저가/거래량). 최신순.
 */
function parseDayTable(html) {
  const table = html.match(/<table[^>]*class="type2"[\s\S]*?<\/table>/);
  if (!table) return [];
  const rowsHtml = [...table[0].matchAll(/<tr onMouseOver="mouseOver\(this\)"[\s\S]*?<\/tr>/g)];

  return rowsHtml
    .map(([rowHtml]) => {
      const cells = [...rowHtml.matchAll(/<span class="tah[^"]*">([^<]*)<\/span>/g)].map(m => m[1].trim());
      // cells: [날짜, 종가, (상승/하락 blind 텍스트는 별도 매치되지 않음), 전일비값, 시가, 고가, 저가, 거래량]
      if (cells.length < 7) return null;
      const isDown = /bu_pdn/.test(rowHtml);
      const [date, close, changeVal, open, high, low, volume] = cells;
      return {
        date,
        close: toNumber(close),
        change: toNumber(changeVal) * (isDown ? -1 : 1),
        open: toNumber(open),
        high: toNumber(high),
        low: toNumber(low),
        volume: toNumber(volume),
      };
    })
    .filter(Boolean);
}

async function fetchDaily(code, { pages = 4 } = {}) {
  const maxPages = Math.min(Math.max(pages, 1), 20);
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchHtml(`https://finance.naver.com/item/sise_day.naver?code=${code}&page=${page}`);
    const rows = parseDayTable(html);
    if (rows.length === 0) break;
    out.push(...rows);
  }
  return out;
}

/**
 * 종목별 시간대별(체결) 시세: 체결시각/체결가/전일비/매도/매수/거래량/변동량.
 */
function parseTimeTable(html) {
  const table = html.match(/<table[^>]*class="type2"[\s\S]*?<\/table>/);
  if (!table) return [];
  const rowsHtml = [...table[0].matchAll(/<tr onMouseOver="mouseOver\(this\)"[\s\S]*?<\/tr>/g)];

  return rowsHtml
    .map(([rowHtml]) => {
      const cells = [...rowHtml.matchAll(/<span class="tah[^"]*">([^<]*)<\/span>/g)].map(m => m[1].trim());
      if (cells.length < 6) return null; // 장 시작 전/데이터 없는 행(&nbsp;)은 스킵
      const isDown = /bu_pdn/.test(rowHtml);
      const [time, price, changeVal, ask, bid, volume, diff] = cells;
      return {
        time,
        price: toNumber(price),
        change: toNumber(changeVal) * (isDown ? -1 : 1),
        ask: toNumber(ask),
        bid: toNumber(bid),
        volume: toNumber(volume),
        diff: toNumber(diff),
      };
    })
    .filter(Boolean);
}

async function fetchIntraday(code, { thistime = '', pages = 3 } = {}) {
  const maxPages = Math.min(Math.max(pages, 1), 10);
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchHtml(
      `https://finance.naver.com/item/sise_time.naver?code=${code}&thistime=${thistime}&page=${page}`
    );
    const rows = parseTimeTable(html);
    if (rows.length === 0) break;
    out.push(...rows);
  }
  return out;
}

/**
 * 종목 현재가 스냅샷(기준시각/현재가/전일대비/거래량/52주 최고·최저/시가총액/PER 등).
 * item/main.naver의 "종목 시세 정보" 접근성 블록(<dl class="blind">)이 가장 안정적이라 우선 사용하고,
 * 시가총액/PER/52주 등 부가 지표는 있으면 채우고 없으면 null로 둔다(페이지 구조 변경에 관대하게).
 */
function parseSnapshot(html) {
  const blind = html.match(/<dt>종목 시세 정보<\/dt>([\s\S]*?)<\/dl>/);
  const text = blind ? blind[1] : '';

  const asOfMatch = text.match(/<dd>(\d{4}년[^<]+)<\/dd>/);
  const priceMatch = text.match(
    /<dd>현재가\s*([\d,]+)\s*전일대비\s*(상승|하락|보합)\s*([\d,]+)\s*(?:플러스|마이너스|보합)\s*([\d.]+)\s*퍼센트\s*<\/dd>/
  );
  const grab = label => {
    const m = text.match(new RegExp(`<dd>${label}\\s*([\\d,]+)\\s*<\\/dd>`));
    return m ? toNumber(m[1]) : null;
  };

  const clean = s => s.replace(/\s+/g, ' ').trim();

  const marketCapMatch = html.match(/id="_market_sum">([\s\S]*?)<\/em>\s*억원/);
  const perMatch = html.match(/PER\(배\)[\s\S]*?<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
  const w52Match = html.match(/52주최고[\s\S]*?<\/th>[\s\S]*?<em>([\d,]+)<\/em>[\s\S]*?<em>([\d,]+)<\/em>/);

  let change = null;
  let changePct = null;
  if (priceMatch) {
    const sign = priceMatch[2] === '하락' ? -1 : 1;
    change = toNumber(priceMatch[3]) * sign;
    changePct = Number(priceMatch[4]) * sign;
  }

  return {
    asOf: asOfMatch ? clean(asOfMatch[1]) : null,
    price: priceMatch ? toNumber(priceMatch[1]) : null,
    change,
    changePct,
    prevClose: grab('전일가'),
    open: grab('시가'),
    high: grab('고가'),
    low: grab('저가'),
    volume: grab('거래량'),
    week52High: w52Match ? toNumber(w52Match[1]) : null,
    week52Low: w52Match ? toNumber(w52Match[2]) : null,
    per: perMatch && clean(perMatch[1]) ? Number(clean(perMatch[1])) : null,
    marketCap: marketCapMatch ? `${clean(marketCapMatch[1])}억원` : null,
  };
}

async function fetchSnapshot(code) {
  const html = await fetchHtml(`https://finance.naver.com/item/main.naver?code=${code}`);
  return parseSnapshot(html);
}

const NEWS_ENTITIES = [
  [/&ldquo;/g, '“'], [/&rdquo;/g, '”'], [/&lsquo;/g, '‘'], [/&rsquo;/g, '’'],
  [/&hellip;/g, '…'], [/&quot;/g, '"'], [/&amp;/g, '&'],
];

function decodeNewsText(str) {
  return NEWS_ENTITIES.reduce((s, [re, rep]) => s.replace(re, rep), str).trim();
}

/**
 * 종목 뉴스 헤드라인(제목/언론사/날짜/링크). 최신순.
 */
async function fetchStockNews(code, { pages = 1 } = {}) {
  const maxPages = Math.min(Math.max(pages, 1), 5);
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchHtml(
      `https://finance.naver.com/item/news_news.naver?code=${code}&page=${page}&sm=title_entity_id.basic`
    );
    const table = html.match(/<table[^>]*class="type5"[\s\S]*?<\/table>/);
    if (!table) break;

    const titles = [...table[0].matchAll(/class="tit"[^>]*>([\s\S]*?)<\/a>/g)]
      .map(m => decodeNewsText(m[1].replace(/<[^>]+>/g, '')));
    const links = [...table[0].matchAll(/href="([^"]+)" class="tit"/g)].map(m => m[1]);
    const presses = [...table[0].matchAll(/class="info">([^<]*)<\/td>/g)].map(m => m[1].trim());
    const dates = [...table[0].matchAll(/class="date">\s*([^<]*)<\/td>/g)].map(m => m[1].trim());

    if (titles.length === 0) break;
    titles.forEach((title, i) => {
      out.push({
        title,
        press: presses[i] || null,
        date: dates[i] || null,
        url: links[i] ? `https://finance.naver.com${links[i]}` : null,
      });
    });
  }
  return out;
}

module.exports = { fetchAllListedStocks, fetchDaily, fetchIntraday, fetchSnapshot, fetchStockNews };
