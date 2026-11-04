// 투약 가능 시각 · 밤 당번 판정 · 이유식 재료 이름 · 수면 패턴 (순수 함수)
const { sleepSessions, dayStartUtc, localDate } = require('./summary');

const MIN = 60000, DAY = 86400000;

// ---------------- 투약 ----------------
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/** 투약 이벤트가 어느 약인지. 이름이 여러 약에 걸리면 모른다고 답함(null) */
function matchMedicine(ev, meds) {
  const id = ev.detail?.medicine_id;
  if (id) return meds.find((m) => m.id === id) || null;
  const n = norm(ev.detail?.name);
  if (!n) return meds.length === 1 ? meds[0] : null;
  const hits = meds.filter((m) => [m.name, ...(m.aliases || [])].map(norm).filter(Boolean)
    .some((x) => x === n || x.includes(n) || n.includes(x)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 부모가 입력한 간격·하루 최대 횟수로 다음 투약 가능 시각만 계산 (권장 용량·간격은 정하지 않음)
 * @param doses 이 약의 투약 [{id, t}] (최신순)
 */
function doseStatus(med, doses, now) {
  const sorted = [...doses].sort((a, b) => b.t - a.t);
  const last = sorted[0] || null;
  let next = last ? last.t + med.min_interval_min * MIN : null;
  const in24 = sorted.filter((d) => d.t > now - DAY && d.t <= now);
  let limited = false;
  if (med.max_per_day && in24.length >= med.max_per_day) {
    const freeAt = in24[med.max_per_day - 1].t + DAY;   // 24시간 창에서 하나가 빠지는 시각
    if (!next || freeAt > next) { next = freeAt; limited = true; }
  }
  const can_now = !next || now >= next;
  return {
    last_id: last?.id || null, last_time: last ? new Date(last.t).toISOString() : null,
    next_allowed: next ? new Date(next).toISOString() : null,
    doses_24h: in24.length, limited, can_now, remaining_min: can_now ? 0 : Math.ceil((next - now) / MIN),
  };
}

// ---------------- 밤 당번 ----------------
/** 지금 밤 시간인지, 그 밤이 어느 날 저녁에 시작했는지 (자정 넘는 구간 지원) */
function nightInfo(fs, now, tzMin) {
  const local = new Date(now + tzMin * MIN);
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  const today = local.toISOString().slice(0, 10);
  const yesterday = new Date(now + tzMin * MIN - DAY).toISOString().slice(0, 10);
  const s = fs.night_start, e = fs.night_end;
  let inNight = false, nightDate = today;
  if (s > e) { inNight = m >= s || m < e; nightDate = m >= s ? today : m < e ? yesterday : today; }
  else if (s < e) { inNight = m >= s && m < e; nightDate = s < 720 ? (inNight ? yesterday : today) : today; }
  return { inNight, nightDate, tonight: inNight ? nightDate : today };
}
const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();

/** 그 밤의 당번: 특정 날 지정 > 요일 반복. 없으면 user_id=null */
function dutyFor(date, weekly, overrides) {
  if (overrides.has(date)) return { user_id: overrides.get(date), source: 'override' };
  const w = weekly.get(weekdayOf(date));
  return w ? { user_id: w, source: 'weekly' } : { user_id: null, source: null };
}

// ---------------- 이유식 재료 ----------------
/** "소고기죽" → "소고기", "단호박 퓨레" → "단호박" */
function ingredientOf(food) {
  const f = String(food || '').replace(/\s+/g, '');
  const base = f.replace(/(이유식|무른밥|진밥|미음|퓨레|죽)$/, '');
  return base.length >= 1 ? base : f;
}

// ---------------- 수면 패턴 ----------------
function isNap(s, tzMin) {
  if (s.nap) return true;
  const h = new Date(s.start + tzMin * MIN).getUTCHours();
  return h >= 7 && h < 20;
}
const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

/**
 * @param rows  기간 + 앞 2일의 이벤트
 * @param end   마지막 날 (YYYY-MM-DD, 로컬)
 */
function computePatterns(rows, { end, days = 14, tzMin = 540, now = Date.now() }) {
  const events = rows.map((r) => ({ ...r, t: new Date(r.time).getTime() }));
  const sessions = sleepSessions(events, now).map((s) => ({ ...s, nap: isNap(s, tzMin) })).sort((a, b) => a.start - b.start);
  const todayStr = localDate(now, tzMin);

  // 깨어 있던 시간: 연속한 잠 사이 (8시간 이하만, 기록 누락으로 생긴 긴 공백 제외)
  const wakes = [];
  for (let i = 0; i + 1 < sessions.length; i++) {
    const gap = sessions[i + 1].start - sessions[i].end;
    if (gap > 0 && gap <= 8 * 60 * MIN) wakes.push({ at: sessions[i].end, min: Math.round(gap / MIN) });
  }

  const endStart = dayStartUtc(end, tzMin);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = endStart - i * DAY, to = from + DAY;
    const date = localDate(from, tzMin);
    if (from > now) { out.push({ date, weekday: weekdayOf(date), future: true }); continue; }
    const segs = sessions.filter((s) => s.end > from && s.start < to).map((s) => ({
      from_min: Math.round((Math.max(s.start, from) - from) / MIN), to_min: Math.round((Math.min(s.end, to) - from) / MIN), nap: s.nap, ongoing: !!s.ongoing,
    }));
    const sleep_min = segs.reduce((a, g) => a + g.to_min - g.from_min, 0);
    const nap_min = segs.filter((g) => g.nap).reduce((a, g) => a + g.to_min - g.from_min, 0);
    const started = sessions.filter((s) => s.start >= from && s.start < to);
    const feeds = events.filter((e) => e.type === 'feeding' && e.t >= from && e.t < to);
    const dayWakes = wakes.filter((w) => w.at >= from && w.at < to).map((w) => w.min);
    const has_sleep = segs.length > 0 || events.some((e) => e.type === 'sleep' && e.t >= from && e.t < to);
    out.push({
      date, weekday: weekdayOf(date), partial: date === todayStr, has_sleep,
      sleep_min, nap_min, night_min: sleep_min - nap_min,
      naps: started.filter((s) => s.nap).length,
      longest_min: started.length ? Math.max(...started.map((s) => Math.round((s.end - s.start) / MIN))) : null,
      wake_avg_min: avg(dayWakes), wake_count: dayWakes.length,
      segments: segs,
      feeds: feeds.map((e) => Math.round((e.t - from) / MIN)),
      feed_count: feeds.length,
      ml: Math.round(feeds.filter((e) => e.unit === 'ml').reduce((a, e) => a + (Number(e.amount) || 0), 0)),
    });
  }

  // 평균: 기록이 있는 "다 지난 날"만 (오늘은 진행 중이라 제외)
  const complete = out.filter((d) => !d.future && !d.partial && d.has_sleep);
  const block = (list) => (list.length ? {
    days: list.length,
    sleep_min: avg(list.map((d) => d.sleep_min)),
    night_min: avg(list.map((d) => d.night_min)),
    nap_min: avg(list.map((d) => d.nap_min)),
    naps: list.length ? Math.round((list.reduce((a, d) => a + d.naps, 0) / list.length) * 10) / 10 : null,
    wake_avg_min: avg(list.filter((d) => d.wake_avg_min != null).map((d) => d.wake_avg_min)),
    longest_min: avg(list.filter((d) => d.longest_min != null).map((d) => d.longest_min)),
  } : null);
  const recentDates = new Set(out.slice(-8).map((d) => d.date));   // 오늘 포함 최근 8일 → 완료된 7일
  return {
    end, days: out,
    recent: block(complete.filter((d) => recentDates.has(d.date))),
    previous: block(complete.filter((d) => !recentDates.has(d.date))),
  };
}

module.exports = { matchMedicine, doseStatus, nightInfo, dutyFor, weekdayOf, ingredientOf, computePatterns, isNap };
