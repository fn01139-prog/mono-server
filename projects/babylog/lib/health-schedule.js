// 어린이 국가예방접종 · 영유아건강검진 일정
// 출처: 질병관리청 예방접종도우미(nip.kdca.go.kr) 표준예방접종일정을 옮긴
//       구로구보건소 영유아 표준예방접종표(2026-02-23 수정), 대전시 어린이 국가예방접종 안내,
//       구로구보건소 영유아 건강검진 안내. 실제 접종은 의료기관 안내를 따를 것.
// 기간 표기: m=개월, d=일. to는 그 개월 수의 마지막 날까지 포함.

const VACCINES = [
  { code: 'BCG', name: '결핵', product: 'BCG(피내용)', doses: [{ dose: 1, from: { d: 0 }, to: { d: 28 }, label: '생후 4주 이내' }] },
  { code: 'HepB', name: 'B형간염', product: 'HepB', doses: [
    { dose: 1, from: { d: 0 }, to: { d: 7 }, label: '출생 시' },
    { dose: 2, from: { m: 1 }, to: { m: 1 }, label: '1개월' },
    { dose: 3, from: { m: 6 }, to: { m: 6 }, label: '6개월' }] },
  { code: 'DTaP', name: '디프테리아·파상풍·백일해', product: 'DTaP', doses: [
    { dose: 1, from: { m: 2 }, to: { m: 2 }, label: '2개월' },
    { dose: 2, from: { m: 4 }, to: { m: 4 }, label: '4개월' },
    { dose: 3, from: { m: 6 }, to: { m: 6 }, label: '6개월' },
    { dose: 4, from: { m: 15 }, to: { m: 18 }, label: '15~18개월' },
    { dose: 5, from: { m: 48 }, to: { m: 83 }, label: '만 4~6세' }] },
  { code: 'IPV', name: '폴리오', product: 'IPV', doses: [
    { dose: 1, from: { m: 2 }, to: { m: 2 }, label: '2개월' },
    { dose: 2, from: { m: 4 }, to: { m: 4 }, label: '4개월' },
    { dose: 3, from: { m: 6 }, to: { m: 6 }, label: '6개월' },
    { dose: 4, from: { m: 48 }, to: { m: 83 }, label: '만 4~6세' }] },
  { code: 'Hib', name: 'b형 헤모필루스 인플루엔자', product: 'Hib', doses: [
    { dose: 1, from: { m: 2 }, to: { m: 2 }, label: '2개월' },
    { dose: 2, from: { m: 4 }, to: { m: 4 }, label: '4개월' },
    { dose: 3, from: { m: 6 }, to: { m: 6 }, label: '6개월' },
    { dose: 4, from: { m: 12 }, to: { m: 15 }, label: '12~15개월' }] },
  { code: 'PCV', name: '폐렴구균', product: 'PCV(단백결합)', doses: [
    { dose: 1, from: { m: 2 }, to: { m: 2 }, label: '2개월' },
    { dose: 2, from: { m: 4 }, to: { m: 4 }, label: '4개월' },
    { dose: 3, from: { m: 6 }, to: { m: 6 }, label: '6개월' },
    { dose: 4, from: { m: 12 }, to: { m: 15 }, label: '12~15개월' }] },
  { code: 'RV', name: '로타바이러스', group: 'RV', variant: 'RV1', product: '로타릭스(RV1) · 2회', doses: [
    { dose: 1, from: { m: 2 }, to: { m: 2 }, label: '2개월' },
    { dose: 2, from: { m: 4 }, to: { m: 4 }, label: '4개월' }] },
  { code: 'RV', name: '로타바이러스', group: 'RV', variant: 'RV5', product: '로타텍(RV5) · 3회', doses: [
    { dose: 1, from: { m: 2 }, to: { m: 2 }, label: '2개월' },
    { dose: 2, from: { m: 4 }, to: { m: 4 }, label: '4개월' },
    { dose: 3, from: { m: 6 }, to: { m: 6 }, label: '6개월' }] },
  { code: 'MMR', name: '홍역·유행성이하선염·풍진', product: 'MMR', doses: [
    { dose: 1, from: { m: 12 }, to: { m: 15 }, label: '12~15개월' },
    { dose: 2, from: { m: 48 }, to: { m: 83 }, label: '만 4~6세' }] },
  { code: 'VAR', name: '수두', product: 'VAR', doses: [{ dose: 1, from: { m: 12 }, to: { m: 15 }, label: '12~15개월' }] },
  { code: 'HepA', name: 'A형간염', product: 'HepA', doses: [
    { dose: 1, from: { m: 12 }, to: { m: 23 }, label: '12~23개월' },
    { dose: 2, after: { dose: 1, from: { m: 6 }, to: { m: 12 } }, label: '1차 후 6~12개월' }] },
  { code: 'JE', name: '일본뇌염', group: 'JE', variant: 'IJEV', product: '불활성화 백신(사백신) · 5회', doses: [
    { dose: 1, from: { m: 12 }, to: { m: 23 }, label: '12~23개월' },
    { dose: 2, after: { dose: 1, from: { d: 7 }, to: { d: 30 } }, label: '1차 후 1개월 이내' },
    { dose: 3, after: { dose: 2, from: { m: 12 }, to: { m: 12 } }, label: '2차 후 12개월' },
    { dose: 4, from: { m: 72 }, to: { m: 83 }, label: '만 6세' },
    { dose: 5, from: { m: 144 }, to: { m: 155 }, label: '만 12세' }] },
  { code: 'JE', name: '일본뇌염', group: 'JE', variant: 'LJEV', product: '약독화 생백신 · 2회', doses: [
    { dose: 1, from: { m: 12 }, to: { m: 23 }, label: '12~23개월' },
    { dose: 2, after: { dose: 1, from: { m: 12 }, to: { m: 12 } }, label: '1차 후 12개월' }] },
  { code: 'Tdap', name: '파상풍·디프테리아·백일해 (추가)', product: 'Tdap/Td', doses: [{ dose: 6, from: { m: 132 }, to: { m: 155 }, label: '만 11~12세' }] },
  { code: 'HPV', name: '사람유두종바이러스', product: 'HPV', sex: 'F', doses: [{ dose: 1, from: { m: 144 }, to: { m: 155 }, label: '만 12세 (2차는 의료기관 안내)' }] },
];

const CHECKUPS = [
  { dose: 1, from: { d: 14 }, to: { d: 35 }, label: '생후 14~35일' },
  { dose: 2, from: { m: 4 }, to: { m: 6 }, label: '4~6개월' },
  { dose: 3, from: { m: 9 }, to: { m: 12 }, label: '9~12개월' },
  { dose: 4, from: { m: 18 }, to: { m: 24 }, label: '18~24개월' },
  { dose: 5, from: { m: 30 }, to: { m: 36 }, label: '30~36개월' },
  { dose: 6, from: { m: 42 }, to: { m: 48 }, label: '42~48개월' },
  { dose: 7, from: { m: 54 }, to: { m: 60 }, label: '54~60개월' },
  { dose: 8, from: { m: 66 }, to: { m: 71 }, label: '66~71개월' },
];

const NOTES = [
  { code: 'IIV', name: '인플루엔자', text: '생후 6개월부터 매년 접종합니다. 처음 맞는 해에는 2회가 필요할 수 있고, 무료 대상 나이는 해마다 공지됩니다.' },
  { code: 'DENTAL', name: '영유아 구강검진', text: '18개월 이후 건강검진 시기에 함께 받을 수 있습니다. 정확한 차수는 보건소에 확인하세요.' },
];

const SOURCES = [
  { title: '질병관리청 예방접종도우미', url: 'https://nip.kdca.go.kr/irhp/infm/goVcntInfo.do?menuCd=115' },
  { title: '구로구보건소 영유아 표준예방접종표', url: 'https://www.guro.go.kr/health/contents.do?key=1469' },
  { title: '구로구보건소 영유아 건강검진', url: 'https://www.guro.go.kr/health/contents.do?key=1357' },
];

// ---------- 날짜 계산 (YYYY-MM-DD, 시간대 영향 없음) ----------
const pad = (n) => String(n).padStart(2, '0');
function parse(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }
function fmt(dt) { return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; }
function addMonths(s, months) {
  const { y, m, d } = parse(s);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last)); // 1/31 + 1개월 → 2/28
  return fmt(target);
}
function addDays(s, days) { const { y, m, d } = parse(s); return fmt(new Date(Date.UTC(y, m - 1, d + days))); }
const start = (base, o) => (o.m != null ? addMonths(base, o.m) : addDays(base, o.d));
const end = (base, o) => (o.m != null ? addDays(addMonths(base, o.m + 1), -1) : addDays(base, o.d));
function daysBetween(a, b) { const A = parse(a), B = parse(b); return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000); }

function statusOf(item, today) {
  if (item.done_on) return 'done';
  if (today < item.from) return 'upcoming';
  if (today <= item.to) return 'due';
  return 'overdue';
}

/**
 * @param {{birth:string, sex?:'M'|'F'|null, prefs?:object, records?:{kind,code,dose,done_on,place}[], today:string}} p
 */
function buildSchedule({ birth, sex = null, prefs = {}, records = [], today }) {
  const done = new Map(records.map((r) => [`${r.kind}:${r.code}:${r.dose}`, r]));
  const choice = { RV: prefs.RV === 'RV5' ? 'RV5' : 'RV1', JE: prefs.JE === 'LJEV' ? 'LJEV' : 'IJEV' };

  const vaccines = [];
  for (const v of VACCINES) {
    if (v.group && choice[v.group] !== v.variant) continue;
    if (v.sex && sex && v.sex !== sex) continue;
    const byDose = {};
    for (const ds of v.doses) {
      let from, to;
      if (ds.after) {
        const prev = byDose[ds.after.dose];
        const base = prev.done_on || prev.from;  // 이전 차수를 아직 안 맞았으면 예정일 기준으로 추정
        from = start(base, ds.after.from); to = end(base, ds.after.to);
      } else { from = start(birth, ds.from); to = end(birth, ds.to); }
      const rec = done.get(`vaccine:${v.code}:${ds.dose}`);
      const item = {
        kind: 'vaccine', code: v.code, dose: ds.dose, name: v.name, product: v.product, label: ds.label,
        from, to, done_on: rec?.done_on || null, place: rec?.place || null, estimated: !!(ds.after && !byDose[ds.after.dose].done_on),
      };
      item.status = statusOf(item, today);
      item.days_until = daysBetween(today, from);
      byDose[ds.dose] = item;
      vaccines.push(item);
    }
  }
  vaccines.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.code.localeCompare(b.code)));

  const checkups = CHECKUPS.map((c) => {
    const rec = done.get(`checkup:CHECKUP:${c.dose}`);
    const item = { kind: 'checkup', code: 'CHECKUP', dose: c.dose, name: `영유아 건강검진 ${c.dose}차`, label: c.label,
      from: start(birth, c.from), to: end(birth, c.to), done_on: rec?.done_on || null, place: rec?.place || null };
    item.status = statusOf(item, today);
    item.days_until = daysBetween(today, item.from);
    return item;
  });

  return { vaccines, checkups, prefs: choice, notes: NOTES, sources: SOURCES };
}

/** 유효한 완료 기록인지 (알 수 없는 코드/차수 차단) */
function isKnown(kind, code, dose) {
  if (kind === 'checkup') return code === 'CHECKUP' && CHECKUPS.some((c) => c.dose === dose);
  return VACCINES.some((v) => v.code === code && v.doses.some((d) => d.dose === dose));
}

module.exports = { buildSchedule, isKnown, addMonths, addDays, daysBetween, VACCINES, CHECKUPS };
