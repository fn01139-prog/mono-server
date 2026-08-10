/**
 * projects/mortgage/public/js/calc.js
 * 원리금균등 / 원금균등 / 체증식 상환 스케줄 계산 + DSR 추정치.
 * 체증식은 은행마다 실제 공식이 달라 "구간별 체증률" 근사 모델을 사용한다 — 참고용.
 */
(function () {
  function monthlyRate(annualRatePct) {
    return (annualRatePct || 0) / 100 / 12;
  }

  function finalize(schedule, principal, totalInterest) {
    return {
      schedule,
      totalInterest,
      totalPayment: principal + totalInterest,
      firstMonthPayment: schedule.length ? schedule[0].payment : 0,
      lastMonthPayment: schedule.length ? schedule[schedule.length - 1].payment : 0,
      peakMonthPayment: schedule.reduce((max, s) => Math.max(max, s.payment), 0),
      firstYearPayment: schedule.slice(0, 12).reduce((sum, s) => sum + s.payment, 0),
    };
  }

  function graceOnlyPhase(principal, r, months) {
    const rows = [];
    let totalInterest = 0;
    for (let m = 1; m <= months; m++) {
      const interest = principal * r;
      totalInterest += interest;
      rows.push({ month: m, principal: 0, interest, payment: interest, balance: principal });
    }
    return { rows, totalInterest };
  }

  // 원리금균등: 거치기간 동안 이자만 납부, 이후 매월 동일 금액(원금+이자) 납부
  function equalPayment(principal, annualRatePct, termYears, graceMonths) {
    const r = monthlyRate(annualRatePct);
    const n = Math.max(1, Math.round((termYears || 0) * 12));
    const g = Math.min(Math.max(graceMonths || 0, 0), n - 1);
    const repayMonths = n - g;

    const grace = graceOnlyPhase(principal, r, g);
    let balance = principal;
    let totalInterest = grace.totalInterest;
    const schedule = grace.rows.slice();

    const M = r === 0
      ? principal / repayMonths
      : principal * r * Math.pow(1 + r, repayMonths) / (Math.pow(1 + r, repayMonths) - 1);

    for (let m = 1; m <= repayMonths; m++) {
      const interest = balance * r;
      let principalPart = M - interest;
      let payment = M;
      if (m === repayMonths) { principalPart = balance; payment = principalPart + interest; }
      balance = Math.max(0, balance - principalPart);
      totalInterest += interest;
      schedule.push({ month: g + m, principal: principalPart, interest, payment, balance });
    }

    return finalize(schedule, principal, totalInterest);
  }

  // 원금균등: 거치기간 동안 이자만, 이후 매월 원금 균등 + 잔액 기준 이자(점감)
  function equalPrincipal(principal, annualRatePct, termYears, graceMonths) {
    const r = monthlyRate(annualRatePct);
    const n = Math.max(1, Math.round((termYears || 0) * 12));
    const g = Math.min(Math.max(graceMonths || 0, 0), n - 1);
    const repayMonths = n - g;

    const grace = graceOnlyPhase(principal, r, g);
    let balance = principal;
    let totalInterest = grace.totalInterest;
    const schedule = grace.rows.slice();

    const principalPerMonth = principal / repayMonths;
    for (let m = 1; m <= repayMonths; m++) {
      const interest = balance * r;
      const principalPart = (m === repayMonths) ? balance : principalPerMonth;
      balance = Math.max(0, balance - principalPart);
      totalInterest += interest;
      schedule.push({ month: g + m, principal: principalPart, interest, payment: principalPart + interest, balance });
    }

    return finalize(schedule, principal, totalInterest);
  }

  // 체증식(근사): 월납입액이 phaseYears 단위 구간마다 growthRatePct%씩 계단식으로 증가.
  // 단, 이자는 매월 잔액 기준으로 전액 납부되어야 하므로(음(-)의 상각 방지) 계산된
  // 구간 납입액이 그 달 이자보다 작으면 이자만큼으로 올려 받는다 — 초기 구간은 사실상
  // 이자위주 납입이다가 구간이 커질수록 원금 상환이 붙는 형태가 되어 "체증식"의 취지에 맞는다.
  // 만기에 잔액이 정확히 0이 되는 구간별 초회 납입액(base)을 이분탐색으로 역산한다.
  // 실제 은행 상품의 체증식 조건과는 다를 수 있는 참고용 모델.
  function stepUp(principal, annualRatePct, termYears, graceMonths, phaseYears, growthRatePct) {
    const r = monthlyRate(annualRatePct);
    const n = Math.max(1, Math.round((termYears || 0) * 12));
    const g = Math.min(Math.max(graceMonths || 0, 0), n - 1);
    const repayMonths = n - g;
    const phaseMonths = Math.max(1, Math.round((phaseYears || 3) * 12));
    const growth = 1 + (growthRatePct || 0) / 100;

    // 이분탐색 탐침용 — base가 주어졌을 때 만기 시점 잔액(자연 진행, 마지막 회차 보정 없음)
    function probeBalance(base) {
      let balance = principal;
      for (let m = 1; m <= repayMonths; m++) {
        const phaseIdx = Math.floor((m - 1) / phaseMonths);
        const interest = balance * r;
        const payment = Math.max(base * Math.pow(growth, phaseIdx), interest);
        const principalPart = Math.min(balance, payment - interest);
        balance -= principalPart;
      }
      return balance;
    }

    function buildSchedule(base) {
      const grace = graceOnlyPhase(principal, r, g);
      let balance = principal;
      let totalInterest = grace.totalInterest;
      const schedule = grace.rows.slice();

      for (let m = 1; m <= repayMonths; m++) {
        const phaseIdx = Math.floor((m - 1) / phaseMonths);
        const interest = balance * r;
        let payment = Math.max(base * Math.pow(growth, phaseIdx), interest);
        let principalPart = Math.min(balance, payment - interest);
        if (m === repayMonths) { principalPart = balance; payment = principalPart + interest; } // 잔여 반올림 보정
        balance -= principalPart;
        totalInterest += interest;
        schedule.push({ month: g + m, principal: principalPart, interest, payment, balance });
      }
      return { balance, schedule, totalInterest };
    }

    let lo = 0;
    let hi = (principal / repayMonths) + principal * r + 1;
    for (let i = 0; i < 60 && probeBalance(hi) > 0; i++) hi *= 1.5;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (probeBalance(mid) > 0) lo = mid; else hi = mid;
    }

    const result = buildSchedule(hi);
    return finalize(result.schedule, principal, result.totalInterest);
  }

  // DSR 추정치(참고용): (신규 대출 1년차 실제 상환액 + 기존 대출 연간 상환액) / 연소득 * 100
  function estimateDSR({ annualIncomeManwon, newLoanFirstYearPaymentManwon, existingDebtsAnnualManwon }) {
    if (!annualIncomeManwon || annualIncomeManwon <= 0) return null;
    return (newLoanFirstYearPaymentManwon + existingDebtsAnnualManwon) / annualIncomeManwon * 100;
  }

  // LTV 추정치(참고용): 대출원금 / 담보가액(감정가 우선, 없으면 매매/분양가) * 100
  function estimateLTV({ principalManwon, priceManwon, appraisedManwon }) {
    const base = appraisedManwon > 0 ? appraisedManwon : priceManwon;
    if (!base || base <= 0) return null;
    return principalManwon / base * 100;
  }

  window.MortgageCalc = { equalPayment, equalPrincipal, stepUp, estimateDSR, estimateLTV, monthlyRate };
})();
