/**
 * projects/mortgage/public/js/storage.js
 * 케이스 데이터의 유일한 저장소는 브라우저 localStorage — 서버로는 절대 전송하지 않는다.
 */
(function () {
  const STORAGE_KEY = 'mortgage:cases:v1';

  function uid() {
    return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultPreferentialItems() {
    return [
      { id: 'salary',       label: '급여이체',            rate: 0, checked: false },
      { id: 'card',         label: '카드실적',            rate: 0, checked: false },
      { id: 'autopay',      label: '자동이체(공과금 등)',  rate: 0, checked: false },
      { id: 'subscription', label: '주택청약종합저축',      rate: 0, checked: false },
      { id: 'econtract',    label: '부동산 전자계약',       rate: 0, checked: false },
      { id: 'newlywed',     label: '신혼부부',             rate: 0, checked: false },
      { id: 'multichild',   label: '다자녀',               rate: 0, checked: false },
      { id: 'firstjob',     label: '사회초년생',           rate: 0, checked: false },
      { id: 'newcustomer',  label: '최초거래고객',          rate: 0, checked: false },
      { id: 'mydata',       label: '마이데이터 연결',       rate: 0, checked: false },
    ];
  }

  function defaultRequiredDocs() {
    return [
      '재직증명서', '원천징수영수증(또는 소득금액증명원)', '사업자등록증', '등기부등본',
      '매매(분양)계약서', '인감증명서', '주민등록등본', '가족관계증명서',
    ].map((label, i) => ({ id: 'doc' + i, label, checked: false }));
  }

  function defaultCase(name) {
    const now = Date.now();
    return {
      id: uid(),
      name: name || '새 케이스',
      createdAt: now,
      updatedAt: now,
      applicant: { income: 0, employmentType: 'employee', employmentDetail: '', creditScoreBand: '' },
      spouse: { included: false, income: 0, employmentType: 'employee', employmentDetail: '', creditScoreBand: '' },
      property: {
        type: 'apartment', price: 0, appraisedPrice: 0,
        regulationZone: 'none', ownershipStatus: 'none', isHouseholdHead: true,
      },
      loan: {
        category: 'individual', purpose: 'purchase', bank: '',
        baseRateType: 'cofix', baseRate: 0, spreadRate: 0,
        principal: 0,
        termYears: 30, graceMonths: 0,
        rateType: 'variable', rateAdjustCycle: 6,
        prepaymentFeeRate: 0, prepaymentFeeNote: '',
        stepUpCycleYears: 3, stepUpGrowthRate: 10,
      },
      preferentialItems: defaultPreferentialItems(),
      existingDebts: [],
      contractDate: '', policyNote: '',
      consult: { branch: '', contactPhone: '', scheduledAt: '', memo: '' },
      requiredDocs: defaultRequiredDocs(),
    };
  }

  const Storage = {
    getAll() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        console.error('[mortgage] localStorage 파싱 실패', e);
        return [];
      }
    },
    saveAll(list) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    },
    getById(id) {
      return this.getAll().find(c => c.id === id) || null;
    },
    create(name) {
      const list = this.getAll();
      const item = defaultCase(name);
      list.push(item);
      this.saveAll(list);
      return item;
    },
    update(caseObj) {
      const list = this.getAll();
      const idx = list.findIndex(c => c.id === caseObj.id);
      caseObj.updatedAt = Date.now();
      if (idx >= 0) list[idx] = caseObj; else list.push(caseObj);
      this.saveAll(list);
    },
    remove(id) {
      this.saveAll(this.getAll().filter(c => c.id !== id));
    },
    duplicate(id) {
      const src = this.getById(id);
      if (!src) return null;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = uid();
      copy.name = src.name + ' 사본';
      copy.createdAt = copy.updatedAt = Date.now();
      const list = this.getAll();
      list.push(copy);
      this.saveAll(list);
      return copy;
    },
    exportJSON() {
      const payload = { version: 1, exportedAt: new Date().toISOString(), cases: this.getAll() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mortgage-cases-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    importJSON(fileText, mode) {
      let parsed;
      try {
        parsed = JSON.parse(fileText);
      } catch (e) {
        throw new Error('올바른 JSON 파일이 아닙니다.');
      }
      const incoming = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cases) ? parsed.cases : null);
      if (!incoming) throw new Error('케이스 데이터를 찾을 수 없습니다.');
      if (mode === 'replace') {
        this.saveAll(incoming);
        return { added: incoming.length, mode };
      }
      const list = this.getAll();
      const ids = new Set(list.map(c => c.id));
      let added = 0;
      incoming.forEach(c => {
        if (c && c.id && !ids.has(c.id)) { list.push(c); added++; }
      });
      this.saveAll(list);
      return { added, mode };
    },
  };

  window.MortgageStorage = Storage;
  window.MortgageDefaults = { defaultCase, defaultPreferentialItems, defaultRequiredDocs, uid };
})();
