/* ==========================================
   admin.js - 관리자 페이지 로직
   ========================================== */

const Admin = (function () {
  // === 콘텐츠 타입 정의 ===
  const CONTENT_TYPES = {
    greeting: {
      icon: '👋', name: '인사말', required: true,
      fields: [
        { key: 'name', label: '이름', type: 'text', placeholder: '홍길동' },
        { key: 'title', label: '직함 / 소속', type: 'text', placeholder: 'Frontend Developer @ Company' },
        { key: 'bio', label: '소개글', type: 'textarea', placeholder: '간단한 자기소개...' },
      ]
    },
    skills: {
      icon: '⚡', name: '기술스택', required: false,
      fields: [
        { key: 'items', label: '기술 목록', type: 'dynamic-list',
          subfields: [
            { key: 'category', label: '분류', type: 'text', placeholder: 'Frontend' },
            { key: 'name', label: '기술명', type: 'text', placeholder: 'JavaScript' },
          ]
        },
      ]
    },
    portfolio: {
      icon: '📁', name: '포트폴리오', required: false,
      fields: [
        { key: 'items', label: '프로젝트', type: 'dynamic-list',
          subfields: [
            { key: 'title', label: '프로젝트명', type: 'text', placeholder: '프로젝트 이름' },
            { key: 'desc', label: '설명', type: 'text', placeholder: '간단한 설명' },
            { key: 'url', label: '링크', type: 'text', placeholder: 'https://...' },
          ]
        },
      ]
    },
    contact: {
      icon: '📞', name: '연락처', required: false,
      fields: [
        { key: 'email', label: '이메일', type: 'text', placeholder: 'hello@email.com' },
        { key: 'phone', label: '전화번호', type: 'text', placeholder: '010-0000-0000' },
        { key: 'links', label: '링크', type: 'dynamic-list',
          subfields: [
            { key: 'label', label: '라벨', type: 'text', placeholder: 'GitHub' },
            { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
          ]
        },
      ]
    },
    freetext: {
      icon: '📝', name: '자유 텍스트', required: false,
      fields: [
        { key: 'heading', label: '제목', type: 'text', placeholder: '섹션 제목' },
        { key: 'body', label: '내용', type: 'textarea', placeholder: '자유롭게 작성...' },
      ]
    },
    project: {
      icon: '🗂️', name: '프로젝트', required: false,
      fields: [
        { key: 'items', label: '프로젝트 목록', type: 'dynamic-list',
          subfields: [
            { key: 'title', label: '프로젝트', type: 'text', placeholder: '프로젝트명' },
            { key: 'period', label: '수행기간', type: 'text', placeholder: '2024.01 ~ 2024.06' },
            { key: 'role', label: '투입역할', type: 'text', placeholder: 'Frontend 개발' },
            { key: 'outcome', label: '성과 및 기대효과', type: 'textarea', placeholder: '주요 성과 및 기대효과' },
          ]
        },
      ]
    },
  };

  let pages = [];
  let currentPage = null;

  // === Utility ===
  function esc(s) {
    const el = document.createElement('div');
    el.textContent = s || '';
    return el.innerHTML;
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    document.getElementById('toastMsg').textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  // === API ===
  function authHeaders(extra = {}) {
    return {
      ...extra,
      'x-auth-token': localStorage.getItem('portfolio_token') || '',
    };
  }

  async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  async function apiPost(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  async function apiPut(url, data) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  async function apiDelete(url) {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  // === Theme ===
  function setTheme(t) {
    document.querySelector('.app').setAttribute('data-theme', t);
    document.querySelectorAll('.theme-dot').forEach(d =>
      d.classList.toggle('active', d.dataset.t === t)
    );
    updatePreview();
  }

  // === Sidebar ===
  function renderSidebar() {
    const grouped = {};
    pages.forEach(p => {
      (grouped[p.person] = grouped[p.person] || []).push(p);
    });

    const tplNames = { profile: '프로필', portfolio: '포트폴리오', landing: '랜딩' };
    let html = '';

    Object.keys(grouped).sort().forEach(person => {
      html += `<div class="sidebar-section-title">${person.toUpperCase()}</div>`;
      grouped[person].sort((a, b) => a.num - b.num).forEach(p => {
        const act = currentPage?.id === p.id ? 'active' : '';
        html += `
          <div class="page-item ${act}" onclick="Admin.selectPage('${p.id}')">
            <div class="dot ${p.status}"></div>
            <div class="info">
              <div class="url">/${p.id}</div>
              <div class="meta">${tplNames[p.template] || p.template} · 콘텐츠 ${(p.contents || []).length}개</div>
            </div>
          </div>`;
      });
    });

    document.getElementById('pageList').innerHTML = html;
  }

  // === Select Page ===
  function selectPage(id) {
    currentPage = pages.find(p => p.id === id);
    if (!currentPage) return;
    if (!currentPage.contents) currentPage.contents = [];

    document.getElementById('emptyView').style.display = 'none';
    document.getElementById('editorView').style.display = 'flex';

    document.getElementById('editorTitle').textContent = `/${currentPage.id} 편집`;
    document.getElementById('personCode').value = currentPage.person;
    document.getElementById('pageNum').value = currentPage.num;
    document.getElementById('urlPreview').textContent = `접속 URL: /${currentPage.id}`;
    document.getElementById('previewUrl').textContent = `yoursite.com/${currentPage.id}`;

    const badge = document.getElementById('editorBadge');
    badge.textContent = currentPage.status === 'published' ? '공개중' : '초안';
    badge.className = `badge ${currentPage.status}`;
    document.getElementById('btnPublish').textContent =
      currentPage.status === 'published' ? '비공개로' : '공개하기';

    document.querySelectorAll('.tpl-card').forEach(c =>
      c.classList.toggle('selected', c.dataset.tpl === currentPage.template)
    );

    renderContentBlocks();
    renderSidebar();
  }

  // === Render Content Blocks ===
  function renderContentBlocks() {
    const container = document.getElementById('contentBlocks');
    container.innerHTML = '';

    (currentPage.contents || []).forEach((content, idx) => {
      const typeDef = CONTENT_TYPES[content.type];
      if (!typeDef) return;

      let fieldsHtml = '';
      typeDef.fields.forEach(f => {
        fieldsHtml += renderField(f, content.data, idx);
      });

      const reqBadge = typeDef.required
        ? '<span class="badge required" style="font-size:10px;">필수</span>'
        : '<span class="badge optional" style="font-size:10px;">선택</span>';

      const block = document.createElement('div');
      block.className = 'content-block';
      block.dataset.idx = idx;
      block.innerHTML = `
        <div class="cb-header" onclick="Admin.toggleBlock(this)">
          <span class="cb-drag">⠿</span>
          <span class="cb-chevron">▼</span>
          <span class="cb-title">${typeDef.icon} ${typeDef.name}</span>
          ${reqBadge}
          <div class="cb-actions">
            <button class="btn-icon" onclick="event.stopPropagation();Admin.moveContent(${idx},-1)" title="위로">↑</button>
            <button class="btn-icon" onclick="event.stopPropagation();Admin.moveContent(${idx},1)" title="아래로">↓</button>
            <button class="btn-icon" onclick="event.stopPropagation();Admin.removeContent(${idx})" title="삭제"
              ${typeDef.required ? 'disabled' : ''}>✕</button>
          </div>
        </div>
        <div class="cb-body">${fieldsHtml}</div>`;
      container.appendChild(block);
    });

    document.getElementById('contentCount').textContent =
      `${currentPage.contents.length}개 섹션`;
    updatePreview();
  }

  // === Render Field ===
  function renderField(fieldDef, data, blockIdx) {
    const val = data?.[fieldDef.key] || '';

    if (fieldDef.type === 'text') {
      return `<div class="form-group"><label>${fieldDef.label}</label>
        <input type="text" value="${esc(val)}" placeholder="${fieldDef.placeholder || ''}"
          onchange="Admin.updateField(${blockIdx},'${fieldDef.key}',this.value)"
          oninput="Admin.updatePreview()"></div>`;
    }
    if (fieldDef.type === 'textarea') {
      return `<div class="form-group"><label>${fieldDef.label}</label>
        <textarea placeholder="${fieldDef.placeholder || ''}"
          onchange="Admin.updateField(${blockIdx},'${fieldDef.key}',this.value)"
          oninput="Admin.updatePreview()">${esc(val)}</textarea></div>`;
    }
    if (fieldDef.type === 'dynamic-tags') {
      const tags = Array.isArray(val) ? val : [];
      const tagsHtml = tags.map((t, i) => `
        <div class="dyn-item" style="display:flex;align-items:center;gap:8px;padding:6px 10px;">
          <input type="text" value="${esc(t)}" style="flex:1;padding:5px 8px;font-size:12px;border:1px solid #ddd;border-radius:6px;"
            onchange="Admin.updateTag(${blockIdx},'${fieldDef.key}',${i},this.value)"
            oninput="Admin.updatePreview()">
          <button class="btn-icon" onclick="Admin.removeTag(${blockIdx},'${fieldDef.key}',${i})">✕</button>
        </div>`).join('');
      return `<div class="form-group"><label>${fieldDef.label}</label>
        <div>${tagsHtml}</div>
        <button class="btn-add-item" onclick="Admin.addTag(${blockIdx},'${fieldDef.key}')">+ 태그 추가</button></div>`;
    }
    if (fieldDef.type === 'dynamic-list') {
      const items = Array.isArray(val) ? val : [];
      const listHtml = items.map((item, i) => {
        const subHtml = fieldDef.subfields.map(sf => {
          const sfVal = item[sf.key] || '';
          const field = sf.type === 'textarea'
            ? `<textarea placeholder="${sf.placeholder || ''}"
                style="padding:7px 10px;font-size:12px;width:100%;resize:vertical;min-height:64px;border:1px solid #d1d5db;border-radius:8px;font-family:inherit;"
                onchange="Admin.updateListItem(${blockIdx},'${fieldDef.key}',${i},'${sf.key}',this.value)"
                oninput="Admin.updatePreview()">${esc(sfVal)}</textarea>`
            : `<input type="text" value="${esc(sfVal)}" placeholder="${sf.placeholder || ''}"
                style="padding:7px 10px;font-size:12px;"
                onchange="Admin.updateListItem(${blockIdx},'${fieldDef.key}',${i},'${sf.key}',this.value)"
                oninput="Admin.updatePreview()">`;
          return `<div class="form-group" style="margin-bottom:6px;"><label style="font-size:11px;">${sf.label}</label>${field}</div>`;
        }).join('');
        return `<div class="dyn-item"><div class="dyn-item-header"><span>#${i + 1}</span>
          <button class="btn-icon" onclick="Admin.removeListItem(${blockIdx},'${fieldDef.key}',${i})">✕</button>
          </div>${subHtml}</div>`;
      }).join('');
      return `<div class="form-group"><label>${fieldDef.label}</label>
        <div>${listHtml}</div>
        <button class="btn-add-item" onclick="Admin.addListItem(${blockIdx},'${fieldDef.key}')">+ 항목 추가</button></div>`;
    }
    return '';
  }

  // === Data Mutation ===
  function updateField(bIdx, key, val) {
    currentPage.contents[bIdx].data[key] = val;
  }

  function updateTag(bIdx, key, tIdx, val) {
    currentPage.contents[bIdx].data[key][tIdx] = val;
  }
  function addTag(bIdx, key) {
    if (!currentPage.contents[bIdx].data[key]) currentPage.contents[bIdx].data[key] = [];
    currentPage.contents[bIdx].data[key].push('');
    renderContentBlocks();
  }
  function removeTag(bIdx, key, tIdx) {
    currentPage.contents[bIdx].data[key].splice(tIdx, 1);
    renderContentBlocks();
  }

  function updateListItem(bIdx, key, iIdx, subKey, val) {
    currentPage.contents[bIdx].data[key][iIdx][subKey] = val;
  }
  function addListItem(bIdx, key) {
    if (!currentPage.contents[bIdx].data[key]) currentPage.contents[bIdx].data[key] = [];
    const typeDef = CONTENT_TYPES[currentPage.contents[bIdx].type];
    const fieldDef = typeDef.fields.find(f => f.key === key);
    const newItem = {};
    (fieldDef.subfields || []).forEach(sf => (newItem[sf.key] = ''));
    currentPage.contents[bIdx].data[key].push(newItem);
    renderContentBlocks();
  }
  function removeListItem(bIdx, key, iIdx) {
    currentPage.contents[bIdx].data[key].splice(iIdx, 1);
    renderContentBlocks();
  }

  // === Content Block Actions ===
  function addContent(type) {
    if (!currentPage) return;
    const typeDef = CONTENT_TYPES[type];
    const data = {};
    typeDef.fields.forEach(f => {
      if (f.type === 'dynamic-tags') data[f.key] = [];
      else if (f.type === 'dynamic-list') data[f.key] = [];
      else data[f.key] = '';
    });
    currentPage.contents.push({ type, data });
    closePicker();
    renderContentBlocks();
  }

  function removeContent(idx) {
    if (!confirm('이 콘텐츠를 삭제하시겠습니까?')) return;
    currentPage.contents.splice(idx, 1);
    renderContentBlocks();
  }

  function moveContent(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= currentPage.contents.length) return;
    const temp = currentPage.contents[idx];
    currentPage.contents[idx] = currentPage.contents[newIdx];
    currentPage.contents[newIdx] = temp;
    renderContentBlocks();
  }

  function toggleBlock(header) {
    header.parentElement.classList.toggle('collapsed');
  }

  function togglePicker() {
    document.getElementById('pickerMenu').classList.toggle('show');
  }
  function closePicker() {
    document.getElementById('pickerMenu').classList.remove('show');
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('.content-picker')) closePicker();
  });

  // === QR Code ===
  function openQRModal() {
    if (!currentPage) return;
    const container = document.getElementById('qrCanvas');
    const urlEl = document.getElementById('qrUrl');
    const url = `${window.location.origin}/portfolio/${currentPage.id}`;
    urlEl.textContent = url;
    container.innerHTML = '';
    new QRCode(container, {
      text: url,
      width: 200,
      height: 200,
      colorDark: '#1a1a2e',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
    document.getElementById('qrModal').classList.add('show');
  }

  function closeQRModal() {
    document.getElementById('qrModal').classList.remove('show');
  }

  function downloadQR() {
    const canvas = document.querySelector('#qrCanvas canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${currentPage?.id || 'qr'}_qrcode.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // === Preview ===
  function updatePreview() {
    if (!currentPage) return;
    const body = document.getElementById('previewBody');
    let html = '';

    (currentPage.contents || []).forEach(c => {
      const d = c.data || {};
      if (c.type === 'greeting') {
        const initial = (d.name || '?').charAt(0);
        html += `<div class="pv-section pv-greeting">
          <div class="pv-avatar">${esc(initial)}</div>
          <div class="pv-name">${esc(d.name) || '이름'}</div>
          <div class="pv-title">${esc(d.title) || '직함'}</div>
          ${d.bio ? `<div class="pv-bio">${esc(d.bio)}</div>` : ''}
        </div>`;
      } else if (c.type === 'skills') {
        const items = (d.items || []).filter(it => it.name);
        if (items.length) {
          const groups = {};
          items.forEach(it => {
            const cat = it.category || '기타';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(it.name);
          });
          const groupsHtml = Object.entries(groups).map(([cat, names]) => `
            <div style="margin-bottom:8px;">
              <div class="pv-section-label">${esc(cat)}</div>
              <div class="pv-skill-tags">${names.map(n => `<span class="pv-tag">${esc(n)}</span>`).join('')}</div>
            </div>`).join('');
          html += `<div class="pv-section">${groupsHtml}</div>`;
        }
      } else if (c.type === 'portfolio') {
        const items = (d.items || []).filter(it => it.title);
        if (items.length) {
          html += `<div class="pv-section"><div class="pv-section-label">포트폴리오</div>
            ${items.map(it => `<div class="pv-portfolio-item"><div class="pf-title">${esc(it.title)}</div>
              <div class="pf-desc">${esc(it.desc)}</div></div>`).join('')}</div>`;
        }
      } else if (c.type === 'contact') {
        let rows = '';
        if (d.email) rows += `<div class="pv-contact-row"><span class="label">이메일</span>${esc(d.email)}</div>`;
        if (d.phone) rows += `<div class="pv-contact-row"><span class="label">전화</span>${esc(d.phone)}</div>`;
        const links = (d.links || []).filter(l => l.label);
        const lHtml = links.length ? `<div class="pv-links">${links.map(l =>
          `<a class="pv-link" href="#">${esc(l.label)}</a>`).join('')}</div>` : '';
        if (rows || lHtml) {
          html += `<div class="pv-section"><div class="pv-section-label">연락처</div>${rows}${lHtml}</div>`;
        }
      } else if (c.type === 'freetext') {
        html += `<div class="pv-section">${d.heading ? `<div class="pv-section-label">${esc(d.heading)}</div>` : ''}
          <div style="font-size:12px;color:#374151;line-height:1.6;white-space:pre-wrap;">${esc(d.body)}</div></div>`;
      } else if (c.type === 'project') {
        const items = (d.items || []).filter(it => it.title);
        if (items.length) {
          html += `<div class="pv-section"><div class="pv-section-label">프로젝트</div>
            ${items.map(it => `
              <div style="background:#f3f4f6;border-radius:6px;padding:8px 10px;margin-bottom:6px;">
                <div style="font-size:12px;font-weight:700;">${esc(it.title)}</div>
                ${it.period ? `<div style="font-size:10px;color:#6b7280;">📅 ${esc(it.period)}</div>` : ''}
                ${it.role ? `<div style="font-size:10px;color:#6b7280;">👤 ${esc(it.role)}</div>` : ''}
                ${it.outcome ? `<div style="font-size:10px;color:#374151;margin-top:3px;">${esc(it.outcome)}</div>` : ''}
              </div>`).join('')}
          </div>`;
        }
      }
    });

    body.innerHTML = html || '<div style="color:#bbb;text-align:center;padding:40px;">콘텐츠를 추가하면 미리보기가 표시됩니다</div>';
  }

  // === Template ===
  function selectTemplate(tpl, el) {
    if (!currentPage) return;
    document.querySelectorAll('.tpl-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    currentPage.template = tpl;
  }

  // === Page CRUD ===
  async function savePage() {
    if (!currentPage) return;
    try {
      await apiPut(`/portfolio/api/pages/${currentPage.id}`, currentPage);
      showToast('저장되었습니다 ✓');
    } catch (err) {
      showToast('저장 실패: ' + err.message);
    }
  }

  async function togglePublish() {
    if (!currentPage) return;
    currentPage.status = currentPage.status === 'published' ? 'draft' : 'published';
    try {
      await apiPut(`/portfolio/api/pages/${currentPage.id}`, currentPage);
      selectPage(currentPage.id);
      showToast(currentPage.status === 'published' ? '공개 전환됨' : '비공개 전환됨');
    } catch (err) {
      showToast('변경 실패');
    }
  }

  async function deletePage() {
    if (!currentPage || !confirm(`/${currentPage.id} 삭제하시겠습니까?`)) return;
    try {
      await apiDelete(`/portfolio/api/pages/${currentPage.id}`);
      pages = pages.filter(p => p.id !== currentPage.id);
      currentPage = null;
      document.getElementById('editorView').style.display = 'none';
      document.getElementById('emptyView').style.display = 'flex';
      renderSidebar();
      showToast('삭제됨');
    } catch (err) {
      showToast('삭제 실패');
    }
  }

  // === New Page Modal ===
  function openNewModal() { document.getElementById('newModal').classList.add('show'); }
  function closeNewModal() { document.getElementById('newModal').classList.remove('show'); }

  function updateNewUrl() {
    const c = document.getElementById('newPersonCode').value.toLowerCase();
    const n = document.getElementById('newPageNum').value;
    document.getElementById('newUrlText').textContent = (c && n) ? `${c}${n}` : '---';
  }

  async function createPage() {
    const person = document.getElementById('newPersonCode').value.toLowerCase().trim();
    const num = parseInt(document.getElementById('newPageNum').value);
    const template = document.getElementById('newTemplate').value;

    if (!person || !num) { alert('코드와 번호를 입력하세요.'); return; }
    const id = `${person}${num}`;
    if (pages.find(p => p.id === id)) { alert(`/${id} 이미 존재`); return; }

    const newPage = {
      id, person, num, template, status: 'draft',
      contents: [{ type: 'greeting', data: { name: '', title: '', bio: '' } }]
    };

    try {
      await apiPost('/portfolio/api/pages', newPage);
      pages.push(newPage);
      closeNewModal();
      renderSidebar();
      selectPage(id);
      showToast(`/${id} 생성됨`);
    } catch (err) {
      showToast('생성 실패');
    }
  }

  // === Init ===
  async function init() {
    try {
      pages = await apiGet('/portfolio/api/pages');
      renderSidebar();
    } catch (err) {
      console.error('Failed to load pages:', err);
      showToast('데이터 로드 실패');
    }
  }

  init();

  // === Public API ===
  return {
    setTheme, selectPage, selectTemplate,
    addContent, removeContent, moveContent, toggleBlock,
    togglePicker,
    updateField, updateTag, addTag, removeTag,
    updateListItem, addListItem, removeListItem,
    updatePreview,
    savePage, togglePublish, deletePage,
    openNewModal, closeNewModal, updateNewUrl, createPage,
    openQRModal, closeQRModal, downloadQR,
  };
})();
