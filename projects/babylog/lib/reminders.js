// 알림 규칙 엔진 (순수 함수)
// 입력: 아기 설정 + 종류별 최신 이벤트 → 지금 보내야 할 알림 목록
const MIN = 60000;
const MAX_OPEN_SLEEP_MIN = 16 * 60;
const LATE_WINDOW_MIN = 180;        // 예정 시각보다 3시간 넘게 지났으면 보내지 않음 (오래된 기록으로 폭탄 알림 방지)
const DAY_START_H = 7, DAY_END_H = 20; // 이 시간대에 시작한 잠을 낮잠으로 봄

const pad = (n) => String(n).padStart(2, '0');
function localHM(ms, tzMin) { const d = new Date(ms + tzMin * MIN); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
function localHour(ms, tzMin) { return new Date(ms + tzMin * MIN).getUTCHours(); }
function dur(min) { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`; }
const KIND = { formula: '분유', breast: '모유', solid: '이유식', milk: '우유', snack: '간식' };

/** 마지막 수면 이벤트로 지금 자는지/깨어 있는지 판단 */
function sleepState(lastSleep, now) {
  if (!lastSleep) return { state: 'unknown' };
  const t = new Date(lastSleep.time).getTime();
  const dmin = Number(lastSleep.detail?.duration_min) || 0;
  if (lastSleep.detail?.kind === 'sleep' && !dmin) {
    if (now - t > MAX_OPEN_SLEEP_MIN * MIN) return { state: 'unknown' }; // 깸 기록 누락
    return { state: 'sleeping', since: t, event: lastSleep };
  }
  return { state: 'awake', since: t, event: lastSleep }; // 깸, 또는 "1시간 잤어"(끝난 잠)
}

/**
 * @param {object} s     reminder_settings 행
 * @param {object} last  { feeding, diaper, sleep } 종류별 최신 이벤트
 * @param {{now:number, tzMin:number, babyName:string}} ctx
 * @returns {{rule, anchorId, title, body, dueAt}[]}
 */
function evaluate(s, last, { now, tzMin, babyName }) {
  const out = [];
  const sleep = sleepState(last.sleep, now);
  const sleeping = sleep.state === 'sleeping';
  const push = (rule, anchorId, dueAt, title, body) => {
    if (now >= dueAt && now - dueAt <= LATE_WINDOW_MIN * MIN) out.push({ rule, anchorId, dueAt, title, body });
  };

  if (s.feeding_enabled && last.feeding && !(sleeping && s.skip_while_sleeping)) {
    const t = new Date(last.feeding.time).getTime();
    const what = [KIND[last.feeding.detail?.kind], last.feeding.amount != null ? `${last.feeding.amount}${last.feeding.unit || ''}` : ''].filter(Boolean).join(' ');
    push('feeding', last.feeding.id, t + s.feeding_interval_min * MIN,
      `${babyName} 수유 시간`,
      `마지막 수유 후 ${dur(s.feeding_interval_min)} 지났어요 (${localHM(t, tzMin)}${what ? ' · ' + what : ''})`);
  }

  if (s.diaper_enabled && last.diaper && !(sleeping && s.skip_while_sleeping)) {
    const t = new Date(last.diaper.time).getTime();
    push('diaper', last.diaper.id, t + s.diaper_interval_min * MIN,
      `${babyName} 기저귀 확인`,
      `마지막 교체 후 ${dur(s.diaper_interval_min)} 지났어요 (${localHM(t, tzMin)})`);
  }

  if (s.nap_enabled && sleeping) {
    const h = localHour(sleep.since, tzMin);
    const isNap = sleep.event.detail?.nap || (h >= DAY_START_H && h < DAY_END_H);
    if (isNap) {
      push('nap', sleep.event.id, sleep.since + s.nap_max_min * MIN,
        `${babyName} 낮잠 ${dur(s.nap_max_min)}째`,
        `${localHM(sleep.since, tzMin)}부터 자고 있어요. 깨울지 확인해 보세요.`);
    }
  }

  if (s.wake_enabled && sleep.state === 'awake') {
    push('wake', sleep.event.id, sleep.since + s.wake_window_min * MIN,
      `${babyName} 재울 시간`,
      `깬 지 ${dur(s.wake_window_min)} 지났어요 (${localHM(sleep.since, tzMin)} 기상)`);
  }
  return out;
}

/** 방해금지 시간인지 (자정을 넘는 구간 지원: 23:00~06:00) */
function inQuietHours(u, now) {
  if (!u?.quiet_enabled) return false;
  const d = new Date(now + (u.tz_min ?? 540) * MIN);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const a = u.quiet_start, b = u.quiet_end;
  return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
}

/** 다음 알림 예정 시각 (설정 화면 미리보기용) */
function nextDue(s, last, now) {
  const res = {};
  const sleep = sleepState(last.sleep, now);
  if (s.feeding_enabled && last.feeding) res.feeding = new Date(new Date(last.feeding.time).getTime() + s.feeding_interval_min * MIN).toISOString();
  if (s.diaper_enabled && last.diaper) res.diaper = new Date(new Date(last.diaper.time).getTime() + s.diaper_interval_min * MIN).toISOString();
  if (s.nap_enabled && sleep.state === 'sleeping') res.nap = new Date(sleep.since + s.nap_max_min * MIN).toISOString();
  if (s.wake_enabled && sleep.state === 'awake') res.wake = new Date(sleep.since + s.wake_window_min * MIN).toISOString();
  res.sleeping = sleep.state === 'sleeping';
  return res;
}

module.exports = { evaluate, inQuietHours, nextDue, sleepState };
