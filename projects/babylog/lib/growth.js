// WHO 성장 표준 백분위 (who-growth-standards: WHO 공식 LMS 표 내장, 0~5세)
// 숫자만 계산하고 해석은 하지 않는다. 판단은 소아과에서.
const who = require('who-growth-standards');

const MEASURES = {
  weight: { indicator: 'wfa', fn: who.weightForAge, field: 'weight_kg', unit: 'kg' },
  height: { indicator: 'lhfa', fn: who.heightForAge, field: 'height_cm', unit: 'cm' },
  head: { indicator: 'hcfa', fn: who.headCircumferenceForAge, field: 'head_cm', unit: 'cm' },
};
const BANDS = [3, 15, 50, 85, 97];
const MAX_DAY = 1856; // WHO 표 범위 (약 5세)

const sexOf = (s) => (s === 'M' ? 'male' : s === 'F' ? 'female' : null);
function ageDays(birth, on) {
  const [y1, m1, d1] = birth.split('-').map(Number), [y2, m2, d2] = on.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** 측정 1건 → 항목별 {value, percentile, z} */
function scoreRecord(rec, birth, sex) {
  const s = sexOf(sex), age = birth ? ageDays(birth, rec.measured_on) : null;
  const out = { age_days: age };
  for (const [k, m] of Object.entries(MEASURES)) {
    const v = rec[m.field] == null ? null : Number(rec[m.field]);
    if (v == null) continue;
    const r = { value: v };
    if (s && age != null && age >= 0 && age <= MAX_DAY) {
      try {
        const g = m.fn(v, { sex: s, ageDays: age });
        r.percentile = Math.round(g.percentile * 10) / 10;
        r.z = Math.round(g.zScore * 100) / 100;
      } catch { /* 범위 밖 */ }
    }
    out[k] = r;
  }
  return out;
}

/** 차트용 백분위 곡선 (0일 ~ maxDay, step일 간격) */
function curves(sex, maxDay) {
  const s = sexOf(sex);
  if (!s) return null;
  const last = Math.min(MAX_DAY, Math.max(maxDay, 0));
  const step = last <= 400 ? 7 : last <= 800 ? 14 : 30;
  const res = {};
  for (const [k, m] of Object.entries(MEASURES)) {
    const lines = {};
    for (const p of BANDS) {
      const pts = [];
      for (let d = 0; d <= last; d += step) pts.push([d, Math.round(who.valueAtPercentile(m.indicator, s, p, d) * 100) / 100]);
      if (pts[pts.length - 1][0] !== last) pts.push([last, Math.round(who.valueAtPercentile(m.indicator, s, p, last) * 100) / 100]);
      lines[`p${p}`] = pts;
    }
    res[k] = { unit: m.unit, lines };
  }
  return res;
}

module.exports = { scoreRecord, curves, ageDays, MAX_DAY };
