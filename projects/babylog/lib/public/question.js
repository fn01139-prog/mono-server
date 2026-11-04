/**
 * 음성 질문 판별 + 답변 문장 만들기 (웹·앱 공용)
 * "마지막으로 언제 먹였어?", "오늘 분유 몇 ml 먹었지?", "기저귀 몇 번 갈았어?", "오늘 얼마나 잤어?"
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BabyQuestion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const Q_WORDS = /언제|몇\s*(번|회|시|ml|미리|밀리|그램|g|시간|분)|얼마나|얼마큼|총\s*(몇|얼마)|했(어|나|니|지|냐)\s*\??$|먹었(어|나|니|지|냐)\s*\??$|\?$|있(어|나)\s*\??$|중이(야|니|지)\s*\??$|알려\s*줘|어때/;
  const TYPE_RX = [
    ['medicine', /약|해열제|시럽/],
    ['diaper', /기저귀|소변|대변|오줌|응가|똥|쉬/],
    ['sleep', /잠|잤|자고|자는|재웠|낮잠|깼|일어났/],
    ['feeding', /먹|수유|분유|모유|이유식|우유|젖|밥|식사/],
  ];

  /** @returns {null | {intent, type, day, kind?, babyName?}} */
  /** @param medNames 등록된 약 이름·별칭 (브랜드명으로 물어도 알아듣게) */
  function detect(text, babyNames = [], medNames = []) {
    const t = String(text || '').trim();
    if (!t) return null;
    const who = babyNames.find((n) => t.includes(n)) || null;
    // "오늘 밤 당번 누구야?"
    if (/당번/.test(t) && /누구|누가|\?|알려|정해/.test(t)) return { intent: 'duty', type: null, day: 'today', kind: null, babyName: who, text: t };
    // "해열제 언제 먹일 수 있어?", "약 또 먹여도 돼?", "다음 약 언제야?"
    const compact = t.replace(/\s+/g, '');
    const medWord = /약|해열제|시럽/.test(t) || medNames.some((m) => m && compact.includes(String(m).replace(/\s+/g, '')));
    if (medWord && /먹여도|먹일\s*수|줘도|가능|다음/.test(t)) return { intent: 'next_dose', type: 'medicine', day: 'today', kind: null, babyName: who, text: t };
    if (!Q_WORDS.test(t)) return null;
    // 숫자+단위로 끝나는 기록 문장("분유 160 먹었어")은 질문이 아님
    if (/\d+\s*(ml|미리|밀리|그램|g|cc|분|시간)?\s*(먹였|먹었|갈았|잤)/.test(t) && !/몇|얼마|언제|\?/.test(t)) return null;

    const type = (TYPE_RX.find(([, rx]) => rx.test(t)) || [null])[0];
    const day = /어제/.test(t) ? 'yesterday' : 'today';
    const babyName = babyNames.find((n) => t.includes(n)) || null;
    let intent;
    if (/자고\s*있|자는\s*중|깨어\s*있/.test(t)) intent = 'status';
    else if (/언제|마지막|몇\s*시/.test(t)) intent = 'last';
    else if (/몇\s*(번|회)|횟수/.test(t)) intent = 'count';
    else if (type === 'sleep' && /얼마나|몇\s*시간|총/.test(t)) intent = 'sleep_total';
    else if (/몇\s*(ml|미리|밀리|그램|g)|얼마나|얼마큼|총|양/.test(t)) intent = 'total';
    else if (/오늘\s*(어때|요약)|요약|알려\s*줘/.test(t) && !type) intent = 'overview';
    else intent = type ? 'last' : 'overview';

    const kind = /분유/.test(t) ? 'formula' : /모유|젖/.test(t) ? 'breast' : /이유식/.test(t) ? 'solid'
      : /대변|응가|똥/.test(t) ? 'poo' : /소변|오줌|쉬/.test(t) ? 'pee' : null;
    return { intent, type: type || (intent === 'sleep_total' ? 'sleep' : null), day, kind, babyName, text: t };
  }

  // 받침 유무로 조사 선택: josa('수유','은','는') → '수유는'
  function josa(word, withBatchim, without) {
    const w = String(word || ''), c = w.charCodeAt(w.length - 1);
    const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : /[0-9]$/.test(w) ? /[013678]$/.test(w) : false;
    return w + (has ? withBatchim : without);
  }
  function hm(iso) { const d = new Date(iso); const h = d.getHours(); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${d.getMinutes() ? ` ${d.getMinutes()}분` : ''}`; }
  function dur(min) { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`; }
  function ago(min) { return min < 1 ? '방금' : min < 60 ? `${min}분 전` : min < 1440 ? `${dur(min)} 전` : `${Math.floor(min / 1440)}일 전`; }
  const KIND = { formula: '분유', breast: '모유', solid: '이유식', milk: '우유', snack: '간식', pee: '소변', poo: '대변', both: '소변과 대변' };
  const TYPE = { feeding: '수유', diaper: '기저귀 교체', sleep: '수면', medicine: '투약' };

  function amountOf(e) { return e.amount != null ? ` ${e.amount}${e.unit === 'ml' ? '밀리리터' : e.unit === 'g' ? '그램' : e.unit || ''}` : ''; }
  function eventPhrase(e) {
    if (e.type === 'feeding') return `${KIND[e.detail?.kind] || '수유'}${amountOf(e)}${e.detail?.duration_min ? ` ${e.detail.duration_min}분` : ''}`;
    if (e.type === 'diaper') return `기저귀(${KIND[e.detail?.kind] || '교체'})`;
    if (e.type === 'medicine') return `${e.detail?.name || '약'}${amountOf(e)}`;
    if (e.type === 'sleep') return e.detail?.kind === 'wake' ? '깸' : '잠듦';
    return TYPE[e.type] || '기록';
  }

  /**
   * @param q       detect() 결과
   * @param s       /summary 응답 (해당 날짜)
   * @param name    아기 이름
   */
  /** 오늘이 아니면 "내일"/"M월 D일"을 붙인 시각 */
  function when(iso) {
    const d = new Date(iso), now = new Date();
    const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    const tm = new Date(now); tm.setDate(tm.getDate() + 1);
    const yd = new Date(now); yd.setDate(yd.getDate() - 1);
    const prefix = key(d) === key(now) ? '' : key(d) === key(tm) ? '내일 ' : key(d) === key(yd) ? '어제 ' : `${d.getMonth() + 1}월 ${d.getDate()}일 `;
    return prefix + hm(iso);
  }

  function answerDose(q, data) {
    const meds = data?.medicines || [];
    if (!meds.length) return '등록된 약이 없어요. 건강 탭의 투약에서 약과 간격을 먼저 입력해 주세요.';
    const n = (x) => String(x || '').replace(/\s+/g, '');
    const text = n(q.text);
    let pick = meds.filter((m) => [m.name, ...(m.aliases || [])].some((x) => n(x) && text.includes(n(x))));
    if (!pick.length) pick = meds.filter((m) => m.status.last_time && Date.now() - new Date(m.status.last_time) < 48 * 3600000);
    if (!pick.length) pick = meds;
    return pick.slice(0, 3).map((m) => {
      const st = m.status;
      if (!st.last_time) return `${josa(m.name, '은', '는')} 아직 투약 기록이 없어요.`;
      if (st.can_now) return `${josa(m.name, '은', '는')} 설정한 간격이 지났어요. 마지막 투약은 ${when(st.last_time)}이에요.`;
      const left = st.remaining_min >= 60 ? dur(st.remaining_min) : `${st.remaining_min}분`;
      if (st.limited) return `${josa(m.name, '은', '는')} 하루 최대 ${m.max_per_day}회를 채웠어요. ${when(st.next_allowed)}부터 가능해요.`;
      return `${josa(m.name, '은', '는')} ${when(st.next_allowed)}부터 가능해요. ${left} 남았어요.`;
    }).join(' ');
  }

  function answerDuty(data) {
    if (!data?.settings?.duty_enabled) return '밤 당번이 꺼져 있어요. 설정 탭의 알림에서 켤 수 있어요.';
    return data.tonight?.name ? `오늘 밤 당번은 ${josa(data.tonight.name, '이에요', '예요')}.` : '오늘 밤은 당번이 정해지지 않았어요.';
  }

  /** @param extra { medicines, duty } — 질문 종류에 따라 필요한 데이터 */
  function answer(q, s, name, extra = {}) {
    if (q.intent === 'next_dose') return answerDose(q, extra.medicines);
    if (q.intent === 'duty') return answerDuty(extra.duty);
    const who = name ? josa(name, '은', '는') : '';
    const dayWord = q.day === 'yesterday' ? '어제' : '오늘';
    const t = s.totals;
    const filterKind = (e) => !q.kind || e.detail?.kind === q.kind || (q.kind === 'pee' || q.kind === 'poo') && e.detail?.kind === 'both';
    const ofType = (type) => s.events.filter((e) => e.type === type && filterKind(e));

    if (q.intent === 'status' || (q.type === 'sleep' && q.intent === 'last')) {
      if (s.sleeping_now) return `${who} 지금 ${dur(s.sleeping_now.minutes)}째 자고 있어요. ${hm(s.sleeping_now.since)}에 잠들었어요.`;
      const lastSleep = s.sleep_sessions.at(-1);
      if (q.intent === 'status') return lastSleep ? `${who} 깨어 있어요. ${hm(lastSleep.end)}에 일어났어요.` : `${who} 깨어 있어요.`;
      return lastSleep ? `마지막 잠은 ${hm(lastSleep.start)}부터 ${hm(lastSleep.end)}까지, ${dur(lastSleep.minutes)} 잤어요.` : `${dayWord}은 수면 기록이 없어요.`;
    }

    if (q.intent === 'last') {
      const type = q.type || 'feeding';
      let e = null;
      if (q.day === 'today' && !q.kind && s.last[type]) e = s.last[type];
      if (!e) e = ofType(type).at(-1) || null;
      if (!e) return `${dayWord}은 ${q.kind ? KIND[q.kind] + ' ' : ''}${TYPE[type] || ''} 기록이 없어요.`.replace(/\s+기록/, ' 기록');
      const minutes = e.minutes_ago ?? Math.round((Date.now() - new Date(e.time)) / 60000);
      return `마지막 ${josa(TYPE[type] || '기록', '은', '는')} ${hm(e.time)}${q.day === 'today' ? `, ${ago(minutes)}` : ''}이에요. ${eventPhrase({ ...e, type })}.`;
    }

    if (q.intent === 'count') {
      const type = q.type || 'feeding';
      const list = ofType(type);
      if (type === 'diaper' && !q.kind) return `${dayWord} 기저귀는 ${t.diaper.count}번 갈았어요. 소변 ${t.diaper.pee}번, 대변 ${t.diaper.poo}번이에요.`;
      if (!list.length) return `${dayWord}은 ${q.kind ? KIND[q.kind] : TYPE[type] || ''} 기록이 없어요.`;
      return `${dayWord} ${josa(q.kind ? KIND[q.kind] : TYPE[type] || '기록', '은', '는')} ${list.length}번이에요.`;
    }

    if (q.intent === 'total') {
      if (q.kind === 'solid') return `${dayWord} 이유식은 모두 ${Math.round(t.feeding.solid_g)}그램 먹었어요.`;
      if (q.kind) {
        const list = ofType('feeding');
        const sum = list.filter((e) => e.unit === 'ml').reduce((a, e) => a + (e.amount || 0), 0);
        return `${dayWord} ${josa(KIND[q.kind], '은', '는')} ${list.length}번, 모두 ${Math.round(sum)}밀리리터 먹었어요.`;
      }
      return `${dayWord}은 ${t.feeding.count}번 먹었고, 분유·모유는 ${Math.round(t.feeding.ml)}밀리리터${t.feeding.solid_g ? `, 이유식은 ${Math.round(t.feeding.solid_g)}그램` : ''}이에요.`;
    }

    if (q.intent === 'sleep_total') {
      return `${dayWord}은 모두 ${dur(t.sleep.total_min)} 잤어요${t.sleep.nap_min ? `. 낮잠은 ${dur(t.sleep.nap_min)}이에요` : ''}.${s.sleeping_now ? ' 지금도 자는 중이에요.' : ''}`;
    }

    // overview
    const parts = [`${dayWord} 수유 ${t.feeding.count}번, ${Math.round(t.feeding.ml)}밀리리터`, `기저귀 ${t.diaper.count}번`, `수면 ${dur(t.sleep.total_min)}`];
    let tail = '';
    if (q.day === 'today' && s.last.feeding) tail = ` 마지막 수유는 ${ago(s.last.feeding.minutes_ago)}이에요.`;
    return parts.join(', ') + '이에요.' + tail;
  }

  return { detect, answer };
});
