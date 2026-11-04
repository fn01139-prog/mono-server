// 규칙 파서가 못 알아들은 문장을 Claude로 보정 (ANTHROPIC_API_KEY 있을 때만)
const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';
const API_VERSION = '2026-10-21';

const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          baby_name: { type: 'string', description: '문장에 언급된 아기 이름. 없으면 빈 문자열' },
          type: { type: 'string', enum: ['feeding', 'diaper', 'sleep', 'medicine', 'bath', 'etc'] },
          kind: { type: 'string', enum: ['formula', 'breast', 'solid', 'milk', 'snack', 'pee', 'poo', 'both', 'sleep', 'wake', 'unknown'] },
          time: { type: 'string', description: 'ISO 8601, 반드시 시간대 오프셋 포함' },
          amount: { type: 'number', description: '용량. 모르면 -1' },
          unit: { type: 'string', enum: ['ml', 'g', '스푼', '그릇', '개', ''] },
          food: { type: 'string', description: '이유식 메뉴 또는 약 이름. 없으면 빈 문자열' },
          duration_min: { type: 'integer', description: '수유/수면 지속 시간(분). 없으면 0' },
          nap: { type: 'boolean' },
          approx_time: { type: 'boolean', description: '"쯤", "아까"처럼 시간이 대략적이면 true' },
          note: { type: 'string', description: '묽음, 남김 등 짧은 메모. 없으면 빈 문자열' },
        },
        required: ['baby_name', 'type', 'kind', 'time', 'amount', 'unit', 'food', 'duration_min', 'nap', 'approx_time', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
};

const SYSTEM = `너는 육아 기록 앱의 문장 해석기다. 부모가 말한 한국어 문장을 이벤트 목록으로 바꾼다.
규칙:
- type: feeding(분유·모유·이유식·우유·간식 먹임), diaper(기저귀·소변·대변), sleep(잠듦/깸), medicine(약), bath(목욕), etc(그 외).
- kind: feeding은 formula/breast/solid/milk/snack, diaper는 pee/poo/both, sleep은 sleep(잠듦)/wake(깸). 해당 없으면 unknown.
- time: 기준 시각과 시간대를 사용해 "30분 전", "세 시 반", "어제 밤 11시"를 절대 시각으로 계산한다. 시간이 없으면 기준 시각. 오전/오후가 없으면 기준 시각 이전 중 가장 가까운 시각.
- 단위가 없으면 분유·모유·우유는 ml, 이유식·간식은 g.
- "1시간 잤어"처럼 끝난 잠은 kind=wake, duration_min=60, time=말한 시점.
- 한 문장에 여러 일이 있으면 여러 이벤트로 나눈다. 아기 이름이 있으면 baby_name에 넣는다.
- 육아와 무관하면 events를 빈 배열로.`;

const TYPES = new Set(['feeding', 'diaper', 'sleep', 'medicine', 'bath', 'etc']);
const KINDS = {
  feeding: ['formula', 'breast', 'solid', 'milk', 'snack', 'unknown'],
  diaper: ['pee', 'poo', 'both', 'unknown'],
  sleep: ['sleep', 'wake'],
};

/** 모델 출력 검증 → 앱 이벤트 형식으로 */
function toEvents(out, { raw, now, babies, defaultBabyId }) {
  const list = Array.isArray(out?.events) ? out.events.slice(0, 10) : [];
  const res = [];
  for (const e of list) {
    if (!TYPES.has(e.type)) continue;
    let t = new Date(e.time);
    // 미래 10분 이후 또는 7일보다 과거면 신뢰하지 않음
    if (isNaN(t) || t - now > 10 * 60000 || now - t > 7 * 86400000) t = new Date(now);
    const detail = {};
    if (KINDS[e.type]?.includes(e.kind)) detail.kind = e.kind;
    else if (KINDS[e.type]) detail.kind = KINDS[e.type][0] === 'sleep' ? 'sleep' : 'unknown';
    if (e.food) detail[e.type === 'medicine' ? 'name' : 'food'] = String(e.food).slice(0, 40);
    if (Number.isInteger(e.duration_min) && e.duration_min > 0 && e.duration_min <= 1440) detail.duration_min = e.duration_min;
    if (e.nap) detail.nap = true;
    if (e.note) detail.note = String(e.note).slice(0, 40);
    if (e.type === 'etc') detail.memo = raw.slice(0, 200);
    const amount = typeof e.amount === 'number' && e.amount >= 0 && e.amount <= 10000 ? e.amount : null;
    const baby = babies.find((b) => e.baby_name && (e.baby_name.includes(b.name) || b.name.includes(e.baby_name)));
    res.push({
      type: e.type, time: t.toISOString(), amount,
      unit: amount != null && ['ml', 'g', '스푼', '그릇', '개'].includes(e.unit) ? e.unit : null,
      detail, raw_text: raw, approx_time: !!e.approx_time,
      baby_id: baby ? baby.id : defaultBabyId, confidence: 'high', source: 'ai',
    });
  }
  return res;
}

async function parseWithAI({ text, now = Date.now(), tzMin = 540, babies = [], defaultBabyId = null }) {
  if (!aiEnabled()) { const e = new Error('AI 보정이 설정되지 않았습니다'); e.status = 501; throw e; }
  const nowLocal = new Date(now + tzMin * 60000).toISOString().slice(0, 19);
  const sign = tzMin >= 0 ? '+' : '-', a = Math.abs(tzMin);
  const offset = `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': API_VERSION,
    },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `기준 시각: ${nowLocal}${offset}\n아기 이름: ${babies.map((b) => b.name).join(', ') || '(없음)'}\n문장: ${text}`,
      }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body?.error?.message || `AI 호출 실패 (${res.status})`);
    e.status = 502; throw e;
  }
  const textOut = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(textOut); } catch { const e = new Error('AI 응답 해석 실패'); e.status = 502; throw e; }
  return toEvents(parsed, { raw: text, now, babies, defaultBabyId });
}

module.exports = { parseWithAI, aiEnabled, toEvents };
