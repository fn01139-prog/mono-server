/**
 * projects/totalprice/lib/aiAdvisor.js
 * 시세/뉴스 데이터를 Claude(Haiku 4.5)에 넘겨 매수/매도 판단에 참고할 수 있는
 * 요약 자료(참고용, 투자 자문 아님)를 생성한다.
 */
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-haiku-4-5-20251001';

/** code/httpStatus를 담아 라우터·배치잡이 사용자에게 보여줄 문구/상태코드를 그대로 쓸 수 있게 한다 */
class InsightError extends Error {
  constructor(message, code, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Anthropic SDK가 던지는 APIError(status/type)를 사용자에게 보여줄 한국어 메시지로 매핑한다.
 * type 목록(SDK resources/shared.d.ts 기준): invalid_request_error, authentication_error,
 * permission_error, not_found_error, rate_limit_error, timeout_error, overloaded_error,
 * api_error, billing_error(크레딧/요금 부족).
 *
 * ⚠️ 실측 확인: 크레딧 부족이 항상 billing_error 타입으로 오는 게 아니라, 실제로는
 * status 400 + type 'invalid_request_error' + 메시지에 "credit balance is too low"가
 * 담겨서 오는 경우가 있었다 → 타입만 보지 말고 메시지 문구도 함께 검사한다.
 */
function mapAnthropicError(e) {
  const type = e?.type;
  const status = e?.status;
  // e.error는 SDK가 파싱해둔 응답 바디({type:'error', error:{type, message}, request_id}).
  // e.message는 기본적으로 "status {원본 JSON 전체}" 형태라 그대로 보여주면 지저분하므로,
  // 가능하면 안쪽의 실제 메시지 문구만 뽑아 쓴다.
  const apiMessage = e?.error?.error?.message || e?.message || '';
  const isBillingIssue =
    type === 'billing_error' ||
    e?.error?.error?.type === 'billing_error' ||
    /credit balance|purchase credits|plans\s*&\s*billing/i.test(apiMessage);

  if (isBillingIssue) {
    return new InsightError(
      'Anthropic API 호출 요금이 부족합니다. console.anthropic.com에서 크레딧을 충전한 뒤 다시 시도해주세요.',
      'billing_error', 402
    );
  }
  if (type === 'authentication_error' || status === 401) {
    return new InsightError('ANTHROPIC_API_KEY가 유효하지 않습니다. 키 값을 다시 확인해주세요.', 'auth_error', 401);
  }
  if (type === 'permission_error' || status === 403) {
    return new InsightError('이 API 키로는 Claude Haiku 4.5 모델에 접근할 권한이 없습니다.', 'permission_error', 403);
  }
  if (type === 'rate_limit_error' || status === 429) {
    return new InsightError('AI 분석 요청이 몰려 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.', 'rate_limit_error', 429);
  }
  if (type === 'overloaded_error' || status === 529) {
    return new InsightError('Anthropic 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.', 'overloaded_error', 503);
  }
  if (type === 'invalid_request_error' || status === 400) {
    return new InsightError(`AI 요청이 올바르지 않습니다: ${apiMessage}`, 'invalid_request', 400);
  }
  if (typeof status === 'number' && status >= 500) {
    return new InsightError('Anthropic 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'server_error', 502);
  }
  if (e?.name === 'APIConnectionError') {
    return new InsightError('Anthropic API에 연결하지 못했습니다. 네트워크 상태를 확인해주세요.', 'connection_error', 502);
  }
  return new InsightError(apiMessage || 'AI 분석 중 알 수 없는 오류가 발생했습니다.', 'unknown_error', 502);
}

function fmtSigned(n, unit = '') {
  if (n === null || n === undefined) return '-';
  return `${n >= 0 ? '+' : ''}${n.toLocaleString('ko-KR')}${unit}`;
}

function buildPrompt({ code, name, snapshot, recentDaily, news }) {
  const snapshotLines = snapshot
    ? [
        `현재가: ${snapshot.price?.toLocaleString('ko-KR') ?? '-'}원 (전일대비 ${fmtSigned(snapshot.change, '원')}, ${fmtSigned(snapshot.changePct, '%')})`,
        `당일 시가/고가/저가: ${snapshot.open ?? '-'} / ${snapshot.high ?? '-'} / ${snapshot.low ?? '-'}`,
        `거래량: ${snapshot.volume?.toLocaleString('ko-KR') ?? '-'}`,
        `52주 최고/최저: ${snapshot.week52High?.toLocaleString('ko-KR') ?? '-'} / ${snapshot.week52Low?.toLocaleString('ko-KR') ?? '-'}`,
        `PER: ${snapshot.per ?? '-'}배`,
        `시가총액: ${snapshot.marketCap ?? '-'}`,
        `기준시각: ${snapshot.asOf ?? '-'}`,
      ]
    : ['현재가 스냅샷을 가져오지 못했습니다.'];

  const dailyLines = recentDaily.length
    ? recentDaily.map(d => `${d.date} 종가 ${d.close?.toLocaleString('ko-KR')}원 (${fmtSigned(d.change)}), 거래량 ${d.volume?.toLocaleString('ko-KR')}`)
    : ['최근 시세 데이터 없음'];

  const newsLines = news.length
    ? news.map(n => `- [${n.date ?? '-'}] ${n.title} (${n.press ?? '출처 미상'})`)
    : ['최근 뉴스 없음'];

  return `당신은 주식 시세/뉴스 데이터를 정리해 투자자가 스스로 판단하는 데 참고할 자료를 작성하는 보조 도구입니다.

[중요 원칙 — 반드시 지킬 것]
- "사세요", "파세요", "지금이 매수 적기입니다" 같은 단정적 매수/매도 지시나 확정적 예측을 하지 마세요.
- 주어진 데이터(가격 추이, 뉴스 제목)에 근거해서만 서술하고, 근거가 부족한 추측은 "~일 가능성", "~로 해석될 수 있음"처럼 유보적으로 표현하세요.
- 이 자료는 투자 자문이 아니라 정보 정리 목적입니다. 최종 판단과 책임은 사용자 본인에게 있음을 항상 전제하세요.

[종목 정보]
종목명: ${name} (${code})
${snapshotLines.join('\n')}

[최근 시세 흐름 (오래된 날짜 → 최근)]
${dailyLines.join('\n')}

[최근 뉴스 헤드라인]
${newsLines.join('\n')}

아래 JSON 형식으로만 응답하세요 (다른 텍스트나 마크다운 없이 순수 JSON만):
{
  "summary": "가격 흐름과 뉴스를 종합한 2~3문장 요약",
  "sentiment": "positive" | "neutral" | "negative",
  "positiveFactors": ["참고할 긍정적 요인", "..."],
  "riskFactors": ["참고할 리스크/부정적 요인", "..."],
  "watchPoints": ["앞으로 확인하면 좋을 지표나 이벤트", "..."]
}`;
}

async function generateInsight({ code, name, snapshot, recentDaily, news }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new InsightError('AI 분석 기능을 사용하려면 ANTHROPIC_API_KEY 환경변수가 필요합니다.', 'missing_api_key', 503);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = buildPrompt({ code, name, snapshot, recentDaily, news });

  let res;
  try {
    res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    throw mapAnthropicError(e);
  }

  const text = (res.content[0]?.text || '').replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new InsightError(`AI 응답을 해석하지 못했습니다: ${e.message}`, 'parse_error', 502);
  }

  return {
    summary: parsed.summary ?? null,
    sentiment: parsed.sentiment ?? 'neutral',
    positiveFactors: Array.isArray(parsed.positiveFactors) ? parsed.positiveFactors : [],
    riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
    watchPoints: Array.isArray(parsed.watchPoints) ? parsed.watchPoints : [],
    model: MODEL,
  };
}

module.exports = { generateInsight, MODEL, InsightError };
