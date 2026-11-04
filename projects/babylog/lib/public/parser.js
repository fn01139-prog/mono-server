/**
 * 육아 음성 기록 파서
 * 음성 인식 텍스트(한국어) → 이벤트 JSON 배열
 * 브라우저(window.BabyParser)와 Node(require) 양쪽에서 사용 가능
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BabyParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 숫자 정규화 ----------
  const SINO = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
  const SINO_UNIT = { 십: 10, 백: 100, 천: 1000 };
  const NATIVE = { 열한: 11, 열두: 12, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 한: 1, 두: 2, 세: 3, 네: 4, 열: 10 };

  function sinoToNum(s) {
    let total = 0, cur = 0, seen = false;
    for (const ch of s) {
      if (ch in SINO) { cur = SINO[ch]; seen = true; }
      else if (ch in SINO_UNIT) { total += (cur || 1) * SINO_UNIT[ch]; cur = 0; seen = true; }
      else return NaN;
    }
    return seen ? total + cur : NaN;
  }

  // "분유"의 '분'은 단위가 아님
  const COUNTER = '(?:분(?!유)|시간|미리|밀리|ml|씨씨|cc|그램|그람|g|개|스푼|숟가락|그릇)';

  function normalize(text) {
    let t = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
    // 쉼표 숫자(1,000) 정리
    t = t.replace(/(\d),(\d{3})/g, '$1$2');
    // 고유어 시각/시간: "세 시", "두 시간", "열한시"
    t = t.replace(/(열한|열두|다섯|여섯|일곱|여덟|아홉|한|두|세|네|열)\s*시/g, (m, w) => NATIVE[w] + '시');
    // 한자어 숫자 + 단위: "백이십 미리", "오 분", "삼십분"
    // 단어 시작에서만 변환 → "서준이 분유"의 '이'를 숫자로 오인하지 않음
    t = t.replace(new RegExp('(?<=\\s)([영공일이삼사오육륙칠팔구십백천]+)\\s*(?=' + COUNTER + ')', 'g'), (m, w) => {
      const n = sinoToNum(w);
      return isNaN(n) ? m : n + ' ';
    });
    // 단위 없는 한자어 숫자 단어: "분유 백이십", "삼십" (십/백/천 포함 단어만)
    t = t.replace(/(?<=\s)([영일이삼사오육칠팔구]*[십백천][영일이삼사오육칠팔구십백천]*)(?=\s)/g, (m, w) => {
      const n = sinoToNum(w);
      return isNaN(n) ? m : String(n);
    });
    // "반 시간" → 30분
    t = t.replace(/반\s*시간/g, '30분');
    return t;
  }

  // ---------- 시간 ----------
  function pad(n) { return String(n).padStart(2, '0'); }

  function toLocalISO(d) {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const a = Math.abs(off);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00' +
      sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }

  const AM_WORDS = /^(오전|아침|새벽)$/;
  const PM_WORDS = /^(오후|낮|저녁|밤)$/;

  /** 세그먼트에서 시간 표현을 찾아 {date, approx, span}으로 반환. 없으면 null */
  function parseTime(seg, now) {
    let m;
    // N시간 (반) (M분) 전
    m = seg.match(/(\d+)\s*시간(\s*반)?\s*(?:(\d+)\s*분)?\s*(?:쯤\s*|정도\s*)?전/);
    if (m) {
      const mins = (+m[1]) * 60 + (m[2] ? 30 : 0) + (m[3] ? +m[3] : 0);
      return { date: new Date(now - mins * 60000), approx: /쯤|정도/.test(m[0]), span: m[0] };
    }
    // N분 전
    m = seg.match(/(\d+)\s*분\s*(?:쯤\s*|정도\s*)?전/);
    if (m) return { date: new Date(now - (+m[1]) * 60000), approx: /쯤|정도/.test(m[0]), span: m[0] };

    // 절대 시각: (어제) (오후) 3시 (20분|반) / 15:20
    m = seg.match(/(어제|오늘)?\s*(오전|오후|아침|낮|저녁|밤|새벽)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시(?!간)\s*(?:(\d{1,2})\s*분|(반))?)\s*(쯤|경|정도)?/);
    if (m) {
      const day = m[1], period = m[2];
      let h = +m[3];
      const min = m[4] ? +m[4] : m[5] ? +m[5] : m[6] ? 30 : 0;
      if (h > 24 || min > 59) return null;
      const base = new Date(now);
      base.setSeconds(0, 0);
      if (day === '어제') base.setDate(base.getDate() - 1);

      let candidates = [];
      if (period && AM_WORDS.test(period)) candidates = [h === 12 ? 0 : h];
      else if (period && PM_WORDS.test(period)) candidates = [h < 12 ? h + 12 : h];
      else candidates = h >= 13 ? [h] : [h % 12, (h % 12) + 12];

      // 날짜가 명시되지 않았으면 "현재 이전 중 가장 가까운 시각"을 선택
      const days = day ? [0] : [0, -1];
      const limit = now.getTime() + 10 * 60000;
      let best = null;
      for (const dd of days) {
        for (const hh of candidates) {
          const d = new Date(base);
          d.setDate(d.getDate() + dd);
          d.setHours(hh, min, 0, 0);
          if (day || d.getTime() <= limit) {
            if (!best || d > best) best = d;
          }
        }
      }
      if (!best) {
        best = new Date(base);
        best.setHours(candidates[0], min, 0, 0);
      }
      return { date: best, approx: !!m[7] || !period && h <= 12, span: m[0] };
    }

    // 방금 / 지금 / 아까
    m = seg.match(/방금|지금|막\s|아까|조금\s*전|좀\s*전/);
    if (m) return { date: new Date(now), approx: /아까|전/.test(m[0]), span: m[0] };
    return null;
  }

  // ---------- 종류 판별 ----------
  const RX = {
    medicine: /해열제|약을|약\s|약$|시럽|영양제|비타민|유산균|철분제|감기약/,
    diaper: /기저귀|소변|대변|오줌|응가|똥|쉬야|쉬\s*(?:했|쌌|만)|변\s*(?:봤|쌌)/,
    sleep: /낮잠|밤잠|재웠|잠들|잠\s*들|잤|깼|일어났|기상|수면/,
    bath: /목욕|씻겼/,
    feeding: /이유식|분유|모유|수유|젖|먹였|먹었|먹음|마셨|간식|우유|죽|미음|퓨레/,
  };

  function detectType(seg) {
    for (const t of ['medicine', 'diaper', 'sleep', 'bath', 'feeding']) if (RX[t].test(seg)) return t;
    return 'etc';
  }

  const UNIT_MAP = {
    ml: 'ml', 미리: 'ml', 밀리: 'ml', 밀리리터: 'ml', cc: 'ml', 씨씨: 'ml',
    g: 'g', 그램: 'g', 그람: 'g',
    스푼: '스푼', 숟가락: '스푼', 개: '개', 그릇: '그릇',
  };

  function parseAmount(seg) {
    let m = seg.match(/(\d+(?:\.\d+)?)\s*(밀리리터|ml|미리|밀리|cc|씨씨|g|그램|그람|스푼|숟가락|개|그릇)/i);
    if (m) return { amount: +m[1], unit: UNIT_MAP[m[2].toLowerCase()] || m[2], explicit: true };
    m = seg.match(/반\s*(그릇|스푼|숟가락)/);
    if (m) return { amount: 0.5, unit: UNIT_MAP[m[1]], explicit: true };
    // 단위 없는 숫자 (시간 표현은 미리 제거된 상태)
    m = seg.match(/(\d+(?:\.\d+)?)(?!\s*(?:분|시|번|회|살|개월|:|\d))/);
    if (m) return { amount: +m[1], unit: null, explicit: false };
    return null;
  }

  function feedingSubtype(seg) {
    if (/분유/.test(seg)) return 'formula';
    if (/모유|수유|젖/.test(seg)) return 'breast';
    if (/이유식|죽|미음|퓨레|무른밥|진밥/.test(seg)) return 'solid';
    if (/우유/.test(seg)) return 'milk';
    if (/간식|과자|떡뻥/.test(seg)) return 'snack';
    return 'unknown';
  }

  const DEFAULT_UNIT = { formula: 'ml', breast: 'ml', milk: 'ml', solid: 'g', snack: 'g', unknown: 'ml' };

  function extractFood(seg) {
    let m = seg.match(/([가-힣]{1,8}(?:죽|미음|퓨레|무른밥|진밥))/);
    if (m) return m[1];
    m = seg.match(/([가-힣]{1,8})\s*이유식/);
    if (m && m[1].length >= 2 && !/에$/.test(m[1]) &&
        !/^(방금|아까|지금|오늘|어제|저녁|아침|점심|오전|오후|그리고|그램|미리)$/.test(m[1])) return m[1];
    return null;
  }

  // ---------- 세그먼트 → 이벤트 ----------
  function buildEvent(seg, type, time, raw) {
    const ev = { type, time: null, amount: null, unit: null, detail: {}, raw_text: raw };
    let rest = seg;
    if (time) rest = rest.replace(time.span, ' ');

    if (type === 'feeding') {
      const sub = feedingSubtype(rest);
      ev.detail.kind = sub;
      // 모유 직수 시간: "왼쪽 10분 수유"
      const dur = rest.match(/(\d+)\s*분\s*(?:동안\s*)?(?:수유|먹|물)/);
      if (sub === 'breast' && dur) {
        ev.detail.duration_min = +dur[1];
        rest = rest.replace(dur[0], ' ');
      }
      if (/왼쪽|좌/.test(rest)) ev.detail.side = 'left';
      if (/오른쪽|우측/.test(rest)) ev.detail.side = ev.detail.side ? 'both' : 'right';
      if (/양쪽/.test(rest)) ev.detail.side = 'both';
      const food = extractFood(rest);
      if (food) ev.detail.food = food;
      const a = parseAmount(rest);
      if (a) { ev.amount = a.amount; ev.unit = a.unit || DEFAULT_UNIT[sub]; }
      if (/남겼|다 못|조금만/.test(rest)) ev.detail.note = '남김';
    } else if (type === 'diaper') {
      const pee = /소변|오줌|쉬/.test(rest);
      const poo = /대변|응가|똥|변\s*(?:봤|쌌)/.test(rest);
      ev.detail.kind = pee && poo ? 'both' : poo ? 'poo' : pee ? 'pee' : 'unknown';
      if (/묽|설사/.test(rest)) ev.detail.note = '묽음';
      else if (/딱딱|변비/.test(rest)) ev.detail.note = '딱딱함';
    } else if (type === 'sleep') {
      ev.detail.kind = /깼|일어났|기상/.test(rest) ? 'wake' : 'sleep';
      if (/낮잠/.test(rest)) ev.detail.nap = true;
      const d = rest.match(/(\d+)\s*시간(?:\s*(반)|\s*(\d+)\s*분)?|(\d+)\s*분/);
      if (d && /동안|잤/.test(rest)) {
        ev.detail.duration_min = d[4] ? +d[4] : (+d[1]) * 60 + (d[2] ? 30 : 0) + (d[3] ? +d[3] : 0);
      }
    } else if (type === 'medicine') {
      const name = rest.match(/(해열제|감기약|영양제|비타민|유산균|철분제|시럽|[가-힣]{1,6}약)/);
      if (name) ev.detail.name = name[1];
      const a = parseAmount(rest);
      if (a) { ev.amount = a.amount; ev.unit = a.unit || 'ml'; }
    }
    return ev;
  }

  function splitSegments(text) {
    return text
      .split(/\s*(?:그리고|그 다음에?|그다음에?|,|\.|(?<=[가-힣])하고\s|(?<=[가-힣])고\s|(?<=[가-힣])이랑\s)\s*/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * @param {string} text 인식된 문장
   * @param {Date} [now] 기준 시각 (기본: 현재)
   * @returns {{events: object[], normalized: string}}
   */
  function parse(text, now) {
    now = now ? new Date(now) : new Date();
    const raw = String(text || '').trim();
    const norm = normalize(raw);
    const segs = splitSegments(norm);

    let sharedTime = null;
    const events = [];
    for (const seg of segs) {
      const t = parseTime(seg, now);
      if (t && !sharedTime) sharedTime = t;
      const type = detectType(seg);
      if (type === 'etc') continue;
      const ev = buildEvent(seg, type, t, raw);
      ev.segment = seg; // 여러 아기 이름이 섞인 문장에서 이벤트별 아기 매칭용
      const use = t || sharedTime;
      ev.time = toLocalISO(use ? use.date : now);
      ev.approx_time = use ? use.approx : false;
      ev.time_source = t ? 'segment' : sharedTime ? 'shared' : 'now';
      events.push(ev);
    }

    // 문장 앞쪽에 시간이 없고 뒤쪽 세그먼트에만 있으면 앞 이벤트에도 적용
    if (sharedTime) {
      for (const ev of events) {
        if (ev.time_source === 'now') {
          ev.time = toLocalISO(sharedTime.date);
          ev.approx_time = sharedTime.approx;
          ev.time_source = 'shared';
        }
      }
    }

    for (const ev of events) {
      ev.id = uuid();
      const needsAmount = ev.type === 'feeding' && ev.detail.kind !== 'breast';
      ev.confidence = needsAmount && ev.amount == null ? 'low' : 'high';
      delete ev.time_source;
    }

    if (!events.length && raw) {
      events.push({
        id: uuid(), type: 'etc', time: toLocalISO(now), amount: null, unit: null,
        detail: { memo: raw }, raw_text: raw, approx_time: false, confidence: 'low',
      });
    }
    return { events, normalized: norm.trim() };
  }

  return { parse, normalize, toLocalISO, _internal: { sinoToNum, parseTime, splitSegments } };
});
