// 아기별 하루 요약 계산 (순수 함수 → 테스트 쉬움)
const DAY = 86400000;
const MAX_OPEN_SLEEP_MIN = 16 * 60; // 깸 기록이 없는 잠은 16시간까지만 진행 중으로 인정

/** 'YYYY-MM-DD' + 시간대 오프셋(분) → 그날 0시의 UTC ms */
function dayStartUtc(date, tzMin) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - tzMin * 60000;
}

function localDate(ms, tzMin) {
  return new Date(ms + tzMin * 60000).toISOString().slice(0, 10);
}

/** 수면/깸 이벤트를 잠든~깬 구간으로 묶기 */
function sleepSessions(events, now) {
  const list = events.filter((e) => e.type === 'sleep').sort((a, b) => a.t - b.t);
  const sessions = [];
  let open = null;
  for (const e of list) {
    const dur = Number(e.detail?.duration_min) || 0;
    if (e.detail?.kind === 'wake') {
      if (open) { sessions.push({ start: open.t, end: e.t, nap: !!open.detail?.nap }); open = null; }
      else if (dur) sessions.push({ start: e.t - dur * 60000, end: e.t, nap: !!e.detail?.nap });
    } else if (dur) {
      // "1시간 잤어" → 말한 시점에 끝난 잠
      if (open) { sessions.push({ start: open.t, end: e.t - dur * 60000, nap: !!open.detail?.nap }); open = null; }
      sessions.push({ start: e.t - dur * 60000, end: e.t, nap: !!e.detail?.nap });
    } else {
      if (open) sessions.push({ start: open.t, end: null, nap: !!open.detail?.nap, unclosed: true }); // 깸 누락
      open = e;
    }
  }
  if (open) {
    const ongoing = now - open.t <= MAX_OPEN_SLEEP_MIN * 60000;
    sessions.push({ start: open.t, end: ongoing ? now : null, nap: !!open.detail?.nap, ongoing, unclosed: !ongoing });
  }
  return sessions.filter((s) => s.end && s.end > s.start);
}

function clipMinutes(s, from, to) {
  const a = Math.max(s.start, from), b = Math.min(s.end, to);
  return b > a ? Math.round((b - a) / 60000) : 0;
}

function dayTotals(events, sessions, from, to) {
  const inDay = events.filter((e) => e.t >= from && e.t < to);
  const feeds = inDay.filter((e) => e.type === 'feeding');
  const diapers = inDay.filter((e) => e.type === 'diaper');
  const kind = (e) => e.detail?.kind;
  return {
    feeding: {
      count: feeds.length,
      ml: feeds.filter((e) => e.unit === 'ml').reduce((s, e) => s + (e.amount || 0), 0),
      solid_g: feeds.filter((e) => e.unit === 'g').reduce((s, e) => s + (e.amount || 0), 0),
      by_kind: feeds.reduce((acc, e) => { const k = kind(e) || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
      breast_min: feeds.reduce((s, e) => s + (Number(e.detail?.duration_min) || 0), 0),
    },
    diaper: {
      count: diapers.length,
      pee: diapers.filter((e) => ['pee', 'both'].includes(kind(e))).length,
      poo: diapers.filter((e) => ['poo', 'both'].includes(kind(e))).length,
    },
    sleep: {
      total_min: sessions.reduce((s, x) => s + clipMinutes(x, from, to), 0),
      nap_min: sessions.filter((x) => x.nap).reduce((s, x) => s + clipMinutes(x, from, to), 0),
    },
    medicine: { count: inDay.filter((e) => e.type === 'medicine').length },
    bath: { count: inDay.filter((e) => e.type === 'bath').length },
    inDay,
  };
}

/**
 * @param {object[]} rows  DB 이벤트 (요청일 기준 앞 8일 ~ 뒤 1일)
 * @param {{date:string, tzMin:number, now?:number}} opt
 */
function computeSummary(rows, { date, tzMin, now = Date.now() }) {
  const events = rows.map((r) => ({ ...r, t: new Date(r.time).getTime() }));
  const from = dayStartUtc(date, tzMin), to = from + DAY;
  const sessions = sleepSessions(events, now);
  const { inDay, ...totals } = dayTotals(events, sessions, from, to);

  // 마지막 이벤트 (현재 시각 이전, 요청일 끝 이전)
  const cutoff = Math.min(now, to);
  const lastOf = (type) => events.filter((e) => e.type === type && e.t <= cutoff).sort((a, b) => b.t - a.t)[0] || null;
  const pick = (e) => e && { id: e.id, time: e.time, amount: e.amount, unit: e.unit, detail: e.detail, minutes_ago: Math.round((now - e.t) / 60000) };
  const isToday = localDate(now, tzMin) === date;
  const ongoing = isToday ? sessions.find((s) => s.ongoing) : null;

  // 최근 7일 추이 (요청일 포함)
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const f = from - i * DAY, t = f + DAY;
    const d = dayTotals(events, sessions, f, t);
    trend.push({ date: localDate(f, tzMin), ml: d.feeding.ml, solid_g: d.feeding.solid_g, feeds: d.feeding.count, diapers: d.diaper.count, sleep_min: d.sleep.total_min });
  }

  return {
    date,
    is_today: isToday,
    totals,
    last: { feeding: pick(lastOf('feeding')), diaper: pick(lastOf('diaper')), sleep: pick(lastOf('sleep')) },
    sleeping_now: ongoing ? { since: new Date(ongoing.start).toISOString(), minutes: Math.round((now - ongoing.start) / 60000) } : null,
    sleep_sessions: sessions
      .filter((s) => s.end > from && s.start < to)
      .map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), minutes: clipMinutes(s, from, to), nap: s.nap, ongoing: !!s.ongoing })),
    events: inDay.sort((a, b) => a.t - b.t).map(({ t, ...e }) => e),
    trend,
  };
}

module.exports = { computeSummary, dayStartUtc, localDate, sleepSessions };
