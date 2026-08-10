/**
 * projects/mortgage/public/js/app.js
 * 렌더링 + 이벤트 바인딩. 데이터는 항상 MortgageStorage(localStorage)를 통해서만 오간다.
 */
(function () {
  const Storage = window.MortgageStorage;
  const Calc = window.MortgageCalc;

  const state = {
    currentCaseId: null,
    compareMode: false,
    compareIds: new Set(),
    saveTimer: null,
  };

  const charts = {}; // caseId -> Chart.js instance (재렌더 시 destroy)

  // ── 포맷/유틸 ─────────────────────────────────────────────
  const fmt = v => Math.round(v || 0).toLocaleString();
  const fmt1 = v => (Math.round((v || 0) * 10) / 10).toLocaleString();
  const fmtW = v => fmt(v) + '만원';
  const fmtW1 = v => fmt1(v) + '만원';
  const fmtPct = v => (v == null ? '—' : (Math.round(v * 10) / 10) + '%');

  function escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
    cur[keys[keys.length - 1]] = value;
  }

  const EMPLOYMENT_TYPES = [
    ['employee', '근로소득자'], ['semifree', '반프리랜서'], ['freelancer', '프리랜서·N잡'],
    ['soleproprietor', '개인사업자'], ['corp', '법인사업자'], ['other', '무직·기타'],
  ];
  const CREDIT_BANDS = [
    ['', '모름'], ['900+', '900점 이상'], ['800-899', '800~899'], ['700-799', '700~799'],
    ['600-699', '600~699'], ['<600', '600 미만'],
  ];
  const PROPERTY_TYPES = [['apartment', '아파트'], ['officetel', '오피스텔'], ['villa', '빌라·다세대'], ['house', '단독주택']];
  const REGULATION_ZONES = [['none', '비규제지역'], ['adjustment', '조정대상지역'], ['overheated', '투기과열지구']];
  const OWNERSHIP_STATUS = [
    ['none', '무주택'], ['first', '무주택(생애최초)'], ['one', '1주택'], ['temp2', '일시적 2주택'], ['multi', '다주택'],
  ];
  const LOAN_CATEGORY = [['individual', '개별(일반) 담보대출'], ['group', '집단대출(중도금·잔금)'], ['policy', '정책모기지(디딤돌·보금자리론 등)']];
  const LOAN_PURPOSE = [['purchase', '주택구입자금'], ['living', '생활안정자금'], ['business', '사업자금'], ['jeonse', '전세자금']];
  const BASE_RATE_TYPES = [['cofix', '코픽스'], ['financial-bond', '금융채'], ['boy-base', '한국은행 기준금리'], ['other', '기타']];
  const RATE_TYPES = [['fixed', '고정금리'], ['variable', '변동금리'], ['mixed', '혼합형']];
  const DEBT_TYPES = [
    ['mortgage', '주택담보대출'], ['credit', '신용대출'], ['jeonse', '전세자금대출'],
    ['cardloan', '카드론·현금서비스'], ['auto', '자동차할부'], ['other', '기타'],
  ];
  const DEBT_METHODS = [['installment', '분할상환'], ['bullet', '만기일시상환'], ['interest-only', '이자만납부']];

  function opt(list, current) {
    return list.map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`).join('');
  }

  // ── 초기화 ────────────────────────────────────────────────
  function init() {
    const cases = Storage.getAll();
    if (cases.length) state.currentCaseId = cases[0].id;
    renderTabs();
    renderMain();
    bindGlobalEvents();
  }

  function bindGlobalEvents() {
    document.getElementById('btnCompareToggle').addEventListener('click', () => {
      state.compareMode = !state.compareMode;
      document.getElementById('btnCompareToggle').classList.toggle('active', state.compareMode);
      renderTabs();
      renderMain();
    });
    document.getElementById('btnExport').addEventListener('click', () => Storage.exportJSON());
    document.getElementById('btnPrint').addEventListener('click', () => window.print());
    document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
    document.getElementById('fileImport').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const text = await file.text();
      const merge = confirm('기존 케이스에 새 케이스를 "추가"하려면 확인, 전체를 "교체"하려면 취소를 누르세요.');
      try {
        const result = Storage.importJSON(text, merge ? 'merge' : 'replace');
        alert(merge ? `${result.added}건을 추가했습니다.` : `전체를 ${result.added}건으로 교체했습니다.`);
        const cases = Storage.getAll();
        state.currentCaseId = cases.length ? cases[0].id : null;
        renderTabs();
        renderMain();
      } catch (err) {
        alert('불러오기 실패: ' + err.message);
      }
    });
  }

  // ── 탭 렌더 ───────────────────────────────────────────────
  function renderTabs() {
    const cases = Storage.getAll();
    const wrap = document.getElementById('caseTabs');
    const parts = cases.map(c => {
      const active = c.id === state.currentCaseId;
      const checkbox = state.compareMode
        ? `<input type="checkbox" class="cmp-check" data-id="${c.id}" ${state.compareIds.has(c.id) ? 'checked' : ''}>`
        : '';
      return `
        <div class="case-tab ${active ? 'active' : ''}" data-id="${c.id}">
          ${checkbox}
          <span data-role="select">${escapeAttr(c.name)}</span>
          <span class="case-tab-actions">
            <button data-action="rename" title="이름변경">✎</button>
            <button data-action="duplicate" title="복제">⧉</button>
            <button data-action="delete" title="삭제">✕</button>
          </span>
        </div>`;
    }).join('');
    wrap.innerHTML = parts + `<button class="btn-add-case" id="btnAddCase">+ 새 케이스</button>`;

    document.getElementById('btnAddCase').addEventListener('click', () => {
      const item = Storage.create('새 케이스 ' + (Storage.getAll().length));
      state.currentCaseId = item.id;
      renderTabs();
      renderMain();
    });

    wrap.querySelectorAll('.case-tab').forEach(tabEl => {
      const id = tabEl.dataset.id;
      tabEl.querySelector('[data-role=select]').addEventListener('click', () => {
        state.currentCaseId = id;
        renderTabs();
        renderMain();
      });
      const cmp = tabEl.querySelector('.cmp-check');
      if (cmp) {
        cmp.addEventListener('click', (e) => {
          e.stopPropagation();
          if (cmp.checked) state.compareIds.add(id); else state.compareIds.delete(id);
          renderCompareView();
        });
      }
      tabEl.querySelector('[data-action=rename]').addEventListener('click', (e) => {
        e.stopPropagation();
        const c = Storage.getById(id);
        const name = prompt('케이스 이름', c.name);
        if (name && name.trim()) {
          c.name = name.trim();
          Storage.update(c);
          renderTabs();
        }
      });
      tabEl.querySelector('[data-action=duplicate]').addEventListener('click', (e) => {
        e.stopPropagation();
        const copy = Storage.duplicate(id);
        if (copy) { state.currentCaseId = copy.id; renderTabs(); renderMain(); }
      });
      tabEl.querySelector('[data-action=delete]').addEventListener('click', (e) => {
        e.stopPropagation();
        const c = Storage.getById(id);
        if (!confirm(`"${c.name}" 케이스를 삭제할까요? 되돌릴 수 없습니다.`)) return;
        Storage.remove(id);
        state.compareIds.delete(id);
        if (state.currentCaseId === id) {
          const rest = Storage.getAll();
          state.currentCaseId = rest.length ? rest[0].id : null;
        }
        renderTabs();
        renderMain();
      });
    });
  }

  // ── 메인 영역 ─────────────────────────────────────────────
  function renderMain() {
    const empty = document.getElementById('emptyState');
    const detail = document.getElementById('caseDetail');
    const compareView = document.getElementById('compareView');

    compareView.style.display = state.compareMode ? '' : 'none';
    if (state.compareMode) renderCompareView();

    const cases = Storage.getAll();
    if (!cases.length) {
      empty.style.display = '';
      detail.style.display = 'none';
      detail.innerHTML = '';
      return;
    }
    empty.style.display = 'none';
    detail.style.display = state.compareMode ? 'none' : '';
    if (!state.compareMode) {
      const c = Storage.getById(state.currentCaseId) || cases[0];
      state.currentCaseId = c.id;
      renderCaseDetail(c);
    }
  }

  // ── 케이스 상세 폼 ────────────────────────────────────────
  function renderCaseDetail(c) {
    const detail = document.getElementById('caseDetail');
    detail.innerHTML = `
      <div class="info-box">🔒 이 케이스는 이 브라우저에만 저장됩니다. 다른 기기에서 보려면 "내보내기"로 백업 후 해당 기기에서 "불러오기" 하세요.</div>

      <details class="acc" open>
        <summary>👤 신청인 소득 · 근무 <span class="chev">▸</span></summary>
        <div class="acc-body">${sectionApplicant(c)}</div>
      </details>

      <details class="acc" open>
        <summary>🏠 담보 물건 정보 <span class="chev">▸</span></summary>
        <div class="acc-body">${sectionProperty(c)}</div>
      </details>

      <details class="acc" open>
        <summary>💰 대출 조건 <span class="chev">▸</span></summary>
        <div class="acc-body">${sectionLoan(c)}</div>
      </details>

      <details class="acc">
        <summary>📋 기존 대출 (DSR 산정용) <span class="chev">▸</span></summary>
        <div class="acc-body"><div id="debtsList">${debtsListHtml(c)}</div></div>
      </details>

      <details class="acc">
        <summary>🏷 우대금리 체크리스트 <span class="chev">▸</span></summary>
        <div class="acc-body"><div id="prefList">${prefListHtml(c)}</div></div>
      </details>

      <details class="acc">
        <summary>📅 정책·규제 기준일 <span class="chev">▸</span></summary>
        <div class="acc-body">${sectionPolicy(c)}</div>
      </details>

      <details class="acc">
        <summary>📞 상담 관리 · 준비서류 <span class="chev">▸</span></summary>
        <div class="acc-body">
          ${sectionConsult(c)}
          <div class="section-label">준비서류 체크리스트</div>
          <div id="docsList">${docsListHtml(c)}</div>
        </div>
      </details>

      <div id="resultsPanel"></div>
    `;

    bindFormEvents(c);
    renderResults(c);
  }

  function sectionApplicant(c) {
    return `
      <div class="section-label">본인</div>
      <div class="form-grid">
        <div class="field"><label>연소득</label>
          <div class="field-row"><input type="number" min="0" data-path="applicant.income" value="${c.applicant.income}"><span class="unit">만원</span></div>
        </div>
        <div class="field"><label>근무유형</label>
          <select data-path="applicant.employmentType">${opt(EMPLOYMENT_TYPES, c.applicant.employmentType)}</select>
        </div>
        <div class="field"><label>재직/사업기간 등</label>
          <input type="text" placeholder="예) 재직 3년, 사업 5년차" data-path="applicant.employmentDetail" value="${escapeAttr(c.applicant.employmentDetail)}">
        </div>
        <div class="field"><label>신용점수 구간</label>
          <select data-path="applicant.creditScoreBand">${opt(CREDIT_BANDS, c.applicant.creditScoreBand)}</select>
        </div>
      </div>
      <div class="section-label">
        <label class="field-row" style="gap:8px;">
          <input type="checkbox" data-path="spouse.included" ${c.spouse.included ? 'checked' : ''}> 배우자 소득 합산
        </label>
      </div>
      <div class="form-grid" style="${c.spouse.included ? '' : 'opacity:.45;pointer-events:none;'}">
        <div class="field"><label>배우자 연소득</label>
          <div class="field-row"><input type="number" min="0" data-path="spouse.income" value="${c.spouse.income}"><span class="unit">만원</span></div>
        </div>
        <div class="field"><label>배우자 근무유형</label>
          <select data-path="spouse.employmentType">${opt(EMPLOYMENT_TYPES, c.spouse.employmentType)}</select>
        </div>
        <div class="field"><label>배우자 재직/사업기간 등</label>
          <input type="text" data-path="spouse.employmentDetail" value="${escapeAttr(c.spouse.employmentDetail)}">
        </div>
        <div class="field"><label>배우자 신용점수 구간</label>
          <select data-path="spouse.creditScoreBand">${opt(CREDIT_BANDS, c.spouse.creditScoreBand)}</select>
        </div>
      </div>
      <p class="note">※ "배우자 소득 합산"을 체크해야 아래 DSR 추정치에 배우자 소득이 반영됩니다.</p>
    `;
  }

  function sectionProperty(c) {
    const p = c.property;
    return `
      <div class="form-grid form-grid-2">
        <div class="field"><label>주택 유형</label><select data-path="property.type">${opt(PROPERTY_TYPES, p.type)}</select></div>
        <div class="field"><label>매매가 / 분양가</label>
          <div class="field-row"><input type="number" min="0" data-path="property.price" value="${p.price}"><span class="unit">만원</span></div>
        </div>
        <div class="field"><label>KB시세 · 감정가 (선택)</label>
          <div class="field-row"><input type="number" min="0" data-path="property.appraisedPrice" value="${p.appraisedPrice}"><span class="unit">만원</span></div>
        </div>
        <div class="field"><label>규제지역 여부</label><select data-path="property.regulationZone">${opt(REGULATION_ZONES, p.regulationZone)}</select></div>
        <div class="field"><label>보유주택 상태</label><select data-path="property.ownershipStatus">${opt(OWNERSHIP_STATUS, p.ownershipStatus)}</select></div>
        <div class="field"><label>세대주 여부</label>
          <select data-path="property.isHouseholdHead">
            <option value="true" ${p.isHouseholdHead ? 'selected' : ''}>세대주</option>
            <option value="false" ${!p.isHouseholdHead ? 'selected' : ''}>세대원</option>
          </select>
        </div>
      </div>
    `;
  }

  function sectionLoan(c) {
    const l = c.loan;
    return `
      <div class="form-grid form-grid-2">
        <div class="field"><label>대출종류</label><select data-path="loan.category">${opt(LOAN_CATEGORY, l.category)}</select></div>
        <div class="field"><label>대출 목적</label><select data-path="loan.purpose">${opt(LOAN_PURPOSE, l.purpose)}</select></div>
        <div class="field"><label>대출 은행</label><input type="text" placeholder="예) OO은행" data-path="loan.bank" value="${escapeAttr(l.bank)}"></div>
        <div class="field"><label>희망 대출원금</label>
          <div class="field-row"><input type="number" min="0" data-path="loan.principal" value="${l.principal}"><span class="unit">만원</span></div>
        </div>
      </div>
      <div class="section-label">금리</div>
      <div class="form-grid form-grid-2">
        <div class="field"><label>기준금리 종류</label><select data-path="loan.baseRateType">${opt(BASE_RATE_TYPES, l.baseRateType)}</select></div>
        <div class="field"><label>기준금리</label>
          <div class="field-row"><input type="number" min="0" step="0.01" data-path="loan.baseRate" value="${l.baseRate}"><span class="unit">%</span></div>
        </div>
        <div class="field"><label>가산금리</label>
          <div class="field-row"><input type="number" min="0" step="0.01" data-path="loan.spreadRate" value="${l.spreadRate}"><span class="unit">%</span></div>
        </div>
        <div class="field"><label>금리유형</label><select data-path="loan.rateType">${opt(RATE_TYPES, l.rateType)}</select></div>
        <div class="field"><label>금리조정주기(변동형)</label>
          <div class="field-row"><input type="number" min="1" data-path="loan.rateAdjustCycle" value="${l.rateAdjustCycle}"><span class="unit">개월</span></div>
        </div>
        <div class="field"><label>중도상환수수료율</label>
          <div class="field-row"><input type="number" min="0" step="0.01" data-path="loan.prepaymentFeeRate" value="${l.prepaymentFeeRate}"><span class="unit">%</span></div>
        </div>
      </div>
      <div class="field" style="margin-top:10px;"><label>중도상환수수료 면제조건 메모</label>
        <input type="text" placeholder="예) 3년 경과 후 면제" data-path="loan.prepaymentFeeNote" value="${escapeAttr(l.prepaymentFeeNote)}">
      </div>
      <div class="section-label">기간</div>
      <div class="form-grid form-grid-2">
        <div class="field"><label>대출기간: <span id="termYearsLabel">${l.termYears}</span>년</label>
          <input type="range" min="10" max="50" step="1" data-path="loan.termYears" data-role="term-slider" value="${l.termYears}">
        </div>
        <div class="field"><label>거치기간</label>
          <div class="field-row"><input type="number" min="0" data-path="loan.graceMonths" value="${l.graceMonths}"><span class="unit">개월</span></div>
        </div>
        <div class="field"><label>체증식 — 체증 주기</label>
          <div class="field-row"><input type="number" min="1" data-path="loan.stepUpCycleYears" value="${l.stepUpCycleYears}"><span class="unit">년</span></div>
        </div>
        <div class="field"><label>체증식 — 구간별 체증률</label>
          <div class="field-row"><input type="number" min="0" step="1" data-path="loan.stepUpGrowthRate" value="${l.stepUpGrowthRate}"><span class="unit">%</span></div>
        </div>
      </div>
    `;
  }

  function debtsListHtml(c) {
    const rows = c.existingDebts.map((d, i) => `
      <div class="debt-row">
        <div class="field"><label>종류</label><select data-path="existingDebts.${i}.type">${opt(DEBT_TYPES, d.type)}</select></div>
        <div class="field"><label>잔액(만원)</label><input type="number" min="0" data-path="existingDebts.${i}.balance" value="${d.balance}"></div>
        <div class="field"><label>월 상환액(만원)</label><input type="number" min="0" data-path="existingDebts.${i}.monthlyPayment" value="${d.monthlyPayment}"></div>
        <div class="field"><label>상환방식</label><select data-path="existingDebts.${i}.method">${opt(DEBT_METHODS, d.method)}</select></div>
        <button class="btn btn-danger btn-icon" data-action="removeDebt" data-index="${i}" title="삭제">✕</button>
      </div>
    `).join('');
    return `
      ${c.existingDebts.length ? rows : '<p class="note">등록된 기존 대출이 없습니다.</p>'}
      <button class="btn btn-ghost btn-sm" data-action="addDebt" style="margin-top:10px;">+ 기존 대출 추가</button>
    `;
  }

  function prefListHtml(c) {
    const rows = c.preferentialItems.map((p, i) => `
      <div class="check-item">
        <input type="checkbox" data-path="preferentialItems.${i}.checked" ${p.checked ? 'checked' : ''}>
        <label>${escapeAttr(p.label)}</label>
        <div class="rate-input field-row"><input type="number" min="0" step="0.01" data-path="preferentialItems.${i}.rate" value="${p.rate}"><span class="unit">%</span></div>
        <button class="btn btn-danger btn-icon" data-action="removePref" data-index="${i}" title="삭제">✕</button>
      </div>
    `).join('');
    return `
      <div class="check-list">${rows}</div>
      <button class="btn btn-ghost btn-sm" data-action="addPref" style="margin-top:10px;">+ 우대항목 추가</button>
    `;
  }

  function docsListHtml(c) {
    const rows = c.requiredDocs.map((d, i) => `
      <div class="check-item">
        <input type="checkbox" data-path="requiredDocs.${i}.checked" ${d.checked ? 'checked' : ''}>
        <label>${escapeAttr(d.label)}</label>
        <button class="btn btn-danger btn-icon" data-action="removeDoc" data-index="${i}" title="삭제">✕</button>
      </div>
    `).join('');
    return `
      <div class="check-list">${rows}</div>
      <button class="btn btn-ghost btn-sm" data-action="addDoc" style="margin-top:10px;">+ 서류 추가</button>
    `;
  }

  function sectionPolicy(c) {
    return `
      <div class="form-grid form-grid-2">
        <div class="field"><label>분양(매매) 계약일</label><input type="date" data-path="contractDate" value="${c.contractDate || ''}"></div>
      </div>
      <div class="field" style="margin-top:10px;"><label>규제 적용 관련 메모</label>
        <textarea placeholder="예) 6.27 대책 발표 이전 계약분, 담당자 안내 내용 등" data-path="policyNote">${escapeAttr(c.policyNote)}</textarea>
      </div>
    `;
  }

  function sectionConsult(c) {
    const cons = c.consult;
    return `
      <div class="form-grid form-grid-2">
        <div class="field"><label>지점명</label><input type="text" data-path="consult.branch" value="${escapeAttr(cons.branch)}"></div>
        <div class="field"><label>담당자 연락처</label><input type="tel" data-path="consult.contactPhone" value="${escapeAttr(cons.contactPhone)}"></div>
        <div class="field"><label>상담 예정일시</label><input type="datetime-local" data-path="consult.scheduledAt" value="${cons.scheduledAt || ''}"></div>
      </div>
      <div class="field" style="margin-top:10px;"><label>메모</label><textarea data-path="consult.memo">${escapeAttr(cons.memo)}</textarea></div>
    `;
  }

  // ── 폼 이벤트 바인딩 ──────────────────────────────────────
  function bindFormEvents(c) {
    const detail = document.getElementById('caseDetail');

    detail.addEventListener('input', (e) => {
      const t = e.target;
      if (!t.dataset.path) return;
      applyFieldChange(c, t);
      if (t.dataset.role === 'term-slider') {
        document.getElementById('termYearsLabel').textContent = t.value;
      }
      scheduleSave(c);
      renderResults(c);
    });

    detail.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.dataset.path) return;
      applyFieldChange(c, t);
      scheduleSave(c);
      if (t.dataset.path === 'spouse.included') renderCaseDetail(c);
      else renderResults(c);
    });

    detail.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const idx = btn.dataset.index != null ? Number(btn.dataset.index) : null;

      if (action === 'addDebt') {
        c.existingDebts.push({ type: 'mortgage', balance: 0, monthlyPayment: 0, method: 'installment' });
        document.getElementById('debtsList').innerHTML = debtsListHtml(c);
      } else if (action === 'removeDebt') {
        c.existingDebts.splice(idx, 1);
        document.getElementById('debtsList').innerHTML = debtsListHtml(c);
      } else if (action === 'addPref') {
        const label = prompt('우대항목 이름');
        if (label && label.trim()) {
          c.preferentialItems.push({ id: window.MortgageDefaults.uid(), label: label.trim(), rate: 0, checked: false });
          document.getElementById('prefList').innerHTML = prefListHtml(c);
        }
      } else if (action === 'removePref') {
        c.preferentialItems.splice(idx, 1);
        document.getElementById('prefList').innerHTML = prefListHtml(c);
      } else if (action === 'addDoc') {
        const label = prompt('준비서류 이름');
        if (label && label.trim()) {
          c.requiredDocs.push({ id: window.MortgageDefaults.uid(), label: label.trim(), checked: false });
          document.getElementById('docsList').innerHTML = docsListHtml(c);
        }
      } else if (action === 'removeDoc') {
        c.requiredDocs.splice(idx, 1);
        document.getElementById('docsList').innerHTML = docsListHtml(c);
      } else {
        return;
      }
      scheduleSave(c);
      renderResults(c);
    });
  }

  function applyFieldChange(c, el) {
    const path = el.dataset.path;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'number' || el.type === 'range') value = el.value === '' ? 0 : parseFloat(el.value);
    else if (el.tagName === 'SELECT' && (el.value === 'true' || el.value === 'false')) value = el.value === 'true';
    else value = el.value;
    setPath(c, path, value);
  }

  function scheduleSave(c) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => Storage.update(c), 250);
  }

  // ── 계산 + 결과 렌더 ──────────────────────────────────────
  function computeCase(c) {
    const rate = Math.max(0, (c.loan.baseRate || 0) + (c.loan.spreadRate || 0)
      - c.preferentialItems.filter(p => p.checked).reduce((s, p) => s + (p.rate || 0), 0));
    const principal = c.loan.principal || 0;
    const eq = Calc.equalPayment(principal, rate, c.loan.termYears, c.loan.graceMonths);
    const ep = Calc.equalPrincipal(principal, rate, c.loan.termYears, c.loan.graceMonths);
    const su = Calc.stepUp(principal, rate, c.loan.termYears, c.loan.graceMonths, c.loan.stepUpCycleYears, c.loan.stepUpGrowthRate);

    const annualIncome = (c.applicant.income || 0) + (c.spouse.included ? (c.spouse.income || 0) : 0);
    const existingAnnual = c.existingDebts.reduce((s, d) => s + (d.monthlyPayment || 0), 0) * 12;
    const dsr = Calc.estimateDSR({
      annualIncomeManwon: annualIncome,
      newLoanFirstYearPaymentManwon: eq.firstYearPayment,
      existingDebtsAnnualManwon: existingAnnual,
    });
    const ltv = Calc.estimateLTV({
      principalManwon: principal,
      priceManwon: c.property.price,
      appraisedManwon: c.property.appraisedPrice,
    });

    return { rate, principal, eq, ep, su, dsr, ltv, annualIncome };
  }

  function renderResults(c) {
    const panel = document.getElementById('resultsPanel');
    const r = computeCase(c);

    const dsrClass = r.dsr == null ? '' : r.dsr <= 40 ? 'ok' : r.dsr <= 70 ? 'warn' : 'danger';
    const ltvClass = r.ltv == null ? '' : r.ltv <= 60 ? 'ok' : r.ltv <= 80 ? 'warn' : 'danger';

    panel.innerHTML = `
      <div class="section-label">계산 결과 (최종금리 ${fmtPct(r.rate)} 적용)</div>
      <div class="badge-row">
        <div class="stat-pill ${dsrClass}"><span class="stat-label">DSR 추정</span><span class="stat-value">${r.dsr == null ? '소득 입력 필요' : fmtPct(r.dsr)}</span></div>
        <div class="stat-pill ${ltvClass}"><span class="stat-label">LTV 추정</span><span class="stat-value">${r.ltv == null ? '가액 입력 필요' : fmtPct(r.ltv)}</span></div>
        <div class="stat-pill"><span class="stat-label">대출원금</span><span class="stat-value">${fmtW(r.principal)}</span></div>
      </div>

      <div class="result-grid">
        ${metricCard('원리금균등', r.eq, '매월 동일 금액 납부')}
        ${metricCard('원금균등', r.ep, '1회차 최대, 이후 점감')}
        ${metricCard('체증식 (참고용 근사치)', r.su, `${c.loan.stepUpCycleYears}년마다 ${c.loan.stepUpGrowthRate}%씩 증가`)}
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="card-title"><span class="icon">📊</span>총이자 비교</div>
        <div class="chart-wrap"><canvas id="chartCase"></canvas></div>
      </div>

      <div class="card">
        <div class="card-title"><span class="icon">📋</span>상환방식 요약 비교</div>
        <div class="tbl-wrap">
          <table class="comp-table">
            <thead><tr><th>상환방식</th><th class="r">첫달 납입액</th><th class="r">마지막달 납입액</th><th class="r">총이자</th><th class="r">총상환액</th></tr></thead>
            <tbody>
              <tr><td class="label">원리금균등</td><td class="r mono">${fmtW1(r.eq.firstMonthPayment)}</td><td class="r mono">${fmtW1(r.eq.lastMonthPayment)}</td><td class="r mono num-amber">${fmtW1(r.eq.totalInterest)}</td><td class="r mono num-blue">${fmtW1(r.eq.totalPayment)}</td></tr>
              <tr><td class="label">원금균등</td><td class="r mono">${fmtW1(r.ep.firstMonthPayment)}</td><td class="r mono">${fmtW1(r.ep.lastMonthPayment)}</td><td class="r mono num-amber">${fmtW1(r.ep.totalInterest)}</td><td class="r mono num-blue">${fmtW1(r.ep.totalPayment)}</td></tr>
              <tr><td class="label">체증식</td><td class="r mono">${fmtW1(r.su.firstMonthPayment)}</td><td class="r mono">${fmtW1(r.su.lastMonthPayment)}</td><td class="r mono num-amber">${fmtW1(r.su.totalInterest)}</td><td class="r mono num-blue">${fmtW1(r.su.totalPayment)}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="note">※ DSR·LTV·체증식 결과는 실제 은행 산정 방식과 다를 수 있는 참고용 추정치입니다. 최종 한도·금리는 상담 은행의 심사 결과를 따르세요.</p>
      </div>
    `;

    renderChart(c.id, r);
  }

  function metricCard(title, res, sub) {
    return `
      <div class="metric-card">
        <div class="metric-card-title">${title}</div>
        <div class="metric-value num-blue">${fmtW1(res.firstMonthPayment)}<span style="font-size:12px;color:var(--text3);"> /월(1회차)</span></div>
        <div class="metric-sub">${sub}</div>
        <div class="divider"></div>
        <div class="metric-row"><span>총이자</span><span class="v num-amber">${fmtW1(res.totalInterest)}</span></div>
        <div class="metric-row"><span>총상환액</span><span class="v num-blue">${fmtW1(res.totalPayment)}</span></div>
      </div>
    `;
  }

  function renderChart(caseId, r) {
    const canvas = document.getElementById('chartCase');
    if (!canvas || typeof Chart === 'undefined') return;
    if (charts[caseId]) charts[caseId].destroy();
    charts[caseId] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['원리금균등', '원금균등', '체증식'],
        datasets: [
          { label: '원금', data: [r.eq.totalPayment - r.eq.totalInterest, r.ep.totalPayment - r.ep.totalInterest, r.su.totalPayment - r.su.totalInterest], backgroundColor: 'rgba(88,166,255,.75)', borderRadius: 4 },
          { label: '총이자', data: [r.eq.totalInterest, r.ep.totalInterest, r.su.totalInterest], backgroundColor: 'rgba(210,153,34,.75)', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: '#8B949E' } },
          y: { stacked: true, grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#8B949E', callback: v => v.toLocaleString() + '만' } },
        },
        plugins: {
          legend: { labels: { color: '#E6EDF3' } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toLocaleString()}만원` } },
        },
      },
    });
  }

  // ── 비교 모드 ─────────────────────────────────────────────
  function renderCompareView() {
    const view = document.getElementById('compareView');
    const cases = Storage.getAll().filter(c => state.compareIds.has(c.id));
    if (!cases.length) {
      view.innerHTML = `<div class="card compare-empty">위 탭에서 비교할 케이스를 체크하세요.</div>`;
      return;
    }
    const rows = cases.map(c => {
      const r = computeCase(c);
      return `
        <tr>
          <td class="label">${escapeAttr(c.name)}</td>
          <td class="label">${escapeAttr(c.loan.bank) || '—'}</td>
          <td class="r mono">${fmtPct(r.rate)}</td>
          <td class="r mono">${c.loan.termYears}년 / 거치 ${c.loan.graceMonths}개월</td>
          <td class="r mono num-blue">${fmtW1(r.eq.firstMonthPayment)}</td>
          <td class="r mono">${fmtW1(r.ep.firstMonthPayment)}</td>
          <td class="r mono">${fmtW1(r.su.firstMonthPayment)}</td>
          <td class="r mono num-amber">${fmtW1(r.eq.totalInterest)}</td>
          <td class="r mono">${r.dsr == null ? '—' : fmtPct(r.dsr)}</td>
          <td class="r mono">${r.ltv == null ? '—' : fmtPct(r.ltv)}</td>
        </tr>`;
    }).join('');

    view.innerHTML = `
      <div class="compare-toolbar">비교 중인 케이스 ${cases.length}건 — 상단 탭 체크박스로 추가/제거하세요.</div>
      <div class="card">
        <div class="tbl-wrap">
          <table class="comp-table">
            <thead><tr>
              <th>케이스</th><th>은행</th><th class="r">최종금리</th><th class="r">기간/거치</th>
              <th class="r">원리금균등 월납입</th><th class="r">원금균등 1회차</th><th class="r">체증식 1회차</th>
              <th class="r">총이자(원리금균등)</th><th class="r">DSR</th><th class="r">LTV</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="note">※ 월납입액 기준은 원리금균등 방식, 원금균등·체증식은 1회차(최대) 납입액입니다.</p>
      </div>
    `;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
