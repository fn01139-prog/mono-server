/* ==========================================
   viewer.js - 뷰어 페이지 렌더링 로직
   portfolio.html 디자인 기반 동적 렌더링
   ========================================== */

(function () {
  const THEMES = ['blue', 'green', 'brown', 'pink'];
  const THEME_EMOJI = { blue: '💎', green: '🌱', brown: '🌰', pink: '🌸' };
  const app = document.getElementById('app');
  let currentTheme = 'brown';

  // === 랜덤 테마 ===
  function applyRandomTheme() {
    currentTheme = THEMES[Math.floor(Math.random() * THEMES.length)];
    document.documentElement.setAttribute('data-theme', currentTheme);
  }

  // === URL에서 페이지 ID 추출 ===
  function getPageId() {
    const path = window.location.pathname.replace(/^\/portfolio\/?/, '').replace(/\/$/, '');
    return path || null;
  }

  function esc(s) {
    const el = document.createElement('div');
    el.textContent = s || '';
    return el.innerHTML;
  }

  async function fetchPage(id) {
    const res = await fetch(`/portfolio/api/pages/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  // === 에러 페이지 ===
  function renderError(code, msg) {
    app.innerHTML = `
      <div class="error-page">
        <div class="error-code">${code}</div>
        <h2>${esc(msg)}</h2>
        <p>요청하신 페이지를 찾을 수 없습니다.</p>
      </div>`;
  }

  // === 콘텐츠에서 특정 타입 데이터 가져오기 ===
  function getContent(contents, type) {
    const block = contents.find(c => c.type === type);
    return block ? block.data : null;
  }

  // === 네비게이션 생성 ===
  function buildNav(contents, greeting) {
    const name = greeting?.name || 'Portfolio';
    const emoji = THEME_EMOJI[currentTheme];
    const sections = [];

    if (greeting) sections.push({ id: 'about', label: '소개' });
    if (contents.find(c => c.type === 'skills')) sections.push({ id: 'skills', label: '기술' });
    if (contents.find(c => c.type === 'portfolio')) sections.push({ id: 'projects', label: '프로젝트' });
    if (contents.find(c => c.type === 'contact')) sections.push({ id: 'contact', label: '연락' });

    const links = sections.map(s =>
      `<li><a href="#${s.id}" onclick="closeNav()">${s.label}</a></li>`
    ).join('');

    return `
      <nav>
        <div class="nav-inner">
          <span class="logo">${emoji} ${esc(name)}</span>
          <button class="nav-toggle" onclick="toggleNav()" aria-label="메뉴">☰</button>
          <ul class="nav-links" id="navLinks">${links}</ul>
        </div>
      </nav>`;
  }

  // === Hero 섹션 ===
  function buildHero(greeting) {
    if (!greeting) return '';
    const emoji = THEME_EMOJI[currentTheme];
    const nameHtml = greeting.title
      ? `<span>${esc(greeting.title)}</span><br>${esc(greeting.name)}입니다.`
      : `저는 <span>${esc(greeting.name)}</span>입니다.`;

    return `
      <section id="hero">
        <div class="hero-inner">
          <span class="hero-tag">${emoji} 안녕하세요, 반갑습니다</span>
          <h1>${nameHtml}</h1>
          ${greeting.bio ? greeting.bio.split('%%').map(p => p.trim()).filter(p => p).map(p => `<p>${esc(p)}</p>`).join('') : ''}
          <div class="hero-btns">
            <a href="#projects" class="btn-primary">프로젝트 보기</a>
            <a href="#contact" class="btn-outline">연락하기</a>
          </div>
        </div>
      </section>`;
  }

  // === About 섹션 ===
  function buildAbout(greeting) {
    if (!greeting) return '';
    const initial = (greeting.name || '?').charAt(0);

    return `
      <section id="about">
        <div class="container">
          <h2 class="section-title">소개</h2>
          <div class="about-grid fade-up">
            <div class="about-avatar">${initial}</div>
            <div class="about-text">
              ${greeting.bio ? `<p>${esc(greeting.bio)}</p>` : ''}
              ${greeting.title ? `
              <div class="about-badges">
                <span class="badge">💼 ${esc(greeting.title)}</span>
              </div>` : ''}
            </div>
          </div>
        </div>
      </section>`;
  }

  // === Skills 섹션 ===
  function buildSkills(skills) {
    if (!skills) return '';
    const items = (skills.items || []).filter(it => it.name);
    if (!items.length) return '';

    // 분류별 그룹핑
    const groups = {};
    items.forEach(it => {
      const cat = it.category || '기타';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(it.name);
    });

    const cardsHtml = Object.keys(groups).map((cat, i) => `
      <div class="skill-card">
        <h3>${esc(cat)}</h3>
        <canvas id="skillChart-${i}"></canvas>
      </div>`
    ).join('');

    return `
      <section id="skills" class="skills-section">
        <div class="container">
          <h2 class="section-title">기술 스택</h2>
          <div class="skills-grid fade-up">${cardsHtml}</div>
        </div>
      </section>`;
  }

  // === Portfolio/Projects 섹션 ===
  function buildPortfolio(portfolio) {
    if (!portfolio) return '';
    const items = (portfolio.items || []).filter(it => it.title);
    if (!items.length) return '';

    const icons = ['📁', '🚀', '🛒', '🤖', '📊', '🎨', '⚡', '🔧', '🌐', '💡'];
    const cardsHtml = items.map((it, i) => `
      <div class="project-card fade-up">
        <div class="project-icon">${icons[i % icons.length]}</div>
        <h3>${esc(it.title)}</h3>
        ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
        ${it.url ? `<a class="project-link" href="${esc(it.url)}" target="_blank" rel="noopener">바로가기 →</a>` : ''}
      </div>`
    ).join('');

    return `
      <section id="projects">
        <div class="container">
          <h2 class="section-title">프로젝트</h2>
          <div class="projects-grid">${cardsHtml}</div>
        </div>
      </section>`;
  }

  // === Contact 섹션 ===
  function buildContact(contact) {
    if (!contact) return '';

    let linksHtml = '';
    if (contact.email) {
      linksHtml += `<a href="mailto:${esc(contact.email)}" class="contact-link"><span class="icon">📧</span> ${esc(contact.email)}</a>`;
    }
    if (contact.phone) {
      linksHtml += `<a href="tel:${esc(contact.phone)}" class="contact-link"><span class="icon">📱</span> ${esc(contact.phone)}</a>`;
    }
    (contact.links || []).filter(l => l.label).forEach(l => {
      linksHtml += `<a href="${esc(l.url)}" target="_blank" rel="noopener" class="contact-link"><span class="icon">🔗</span> ${esc(l.label)}</a>`;
    });

    if (!linksHtml) return '';

    return `
      <section id="contact" class="contact-section">
        <div class="container">
          <h2 class="section-title">연락하기</h2>
          <div class="contact-wrap fade-up">
            <div>
              <div class="contact-info">
                <p>새로운 기회나 협업 제안은 언제든지 환영합니다. 아래 연락처를 통해 연락해 주세요!</p>
              </div>
              <div class="contact-links">${linksHtml}</div>
            </div>
            <div>
              <div class="form-group"><label>이름</label><input type="text" id="f-name" placeholder="홍길동"></div>
              <div class="form-group"><label>이메일</label><input type="email" id="f-email" placeholder="email@example.com"></div>
              <div class="form-group"><label>메시지</label><textarea id="f-msg" placeholder="안녕하세요! 협업 제안이 있어서 연락드립니다..."></textarea></div>
              <button class="btn-primary" style="width:100%;" onclick="submitForm()">메시지 보내기 →</button>
              <div id="form-success" style="display:none;background:var(--green-light);border:1px solid var(--accent-soft);color:var(--green);padding:12px 16px;border-radius:8px;font-size:.88rem;margin-top:12px;">
                ${THEME_EMOJI[currentTheme]} 메시지가 전송되었습니다! 빠른 시일 내에 답변 드리겠습니다.
              </div>
            </div>
          </div>
        </div>
      </section>`;
  }

  // === Project 섹션 ===
  function buildProject(data) {
    if (!data) return '';
    const items = (data.items || []).filter(it => it.title);
    if (!items.length) return '';

    const cardsHtml = items.map(it => `
      <div class="project-card fade-up">
        <h1>${esc(it.title)}</h1>
        <div class="project-meta">
          ${it.period ? `<div class="project-meta-item">📅 ${esc(it.period)}</div>` : ''}
          ${it.role ? `<div class="project-meta-item">👤 ${esc(it.role)}</div>` : ''}
        </div>
        ${it.outcome ? `<p style="white-space:pre-wrap;">${esc(it.outcome)}</p>` : ''}
      </div>`
    ).join('');

    return `
      <section id="project">
        <div class="container">
          <h2 class="section-title">프로젝트</h2>
          <div class="projects-grid project-grid-2">${cardsHtml}</div>
        </div>
      </section>`;
  }

  // === Freetext 섹션 ===
  function buildFreetext(data, idx) {
    if (!data || (!data.heading && !data.body)) return '';
    return `
      <section id="freetext-${idx}" class="freetext-section">
        <div class="container">
          ${data.heading ? `<h2 class="section-title">${esc(data.heading)}</h2>` : ''}
          <div class="fade-up freetext-body">${esc(data.body)}</div>
        </div>
      </section>`;
  }

  // === Chat ===
  function buildChat(greeting) {
    const name = greeting?.name || '어시스턴트';
    const emoji = THEME_EMOJI[currentTheme];

    return `
      <div class="chat-fab">
        <div class="chat-window" id="chatWindow">
          <div class="chat-header">
            <div class="chat-avatar">${emoji}</div>
            <div class="chat-header-info">
              <h4>AI 어시스턴트</h4>
              <p>${esc(name)}에 대해 무엇이든 물어보세요</p>
            </div>
            <button class="chat-close" onclick="toggleChat()">✕</button>
          </div>
          <div class="chat-messages" id="chatMessages">
            <div class="msg bot">안녕하세요! ${emoji} 저는 ${esc(name)}의 AI 어시스턴트입니다. 기술 스택, 프로젝트, 경력 등 무엇이든 물어보세요!</div>
          </div>
          <div class="chat-input-row">
            <input class="chat-input" id="chatInput" placeholder="질문을 입력하세요..." onkeydown="if(event.key==='Enter')sendMsg()">
            <button class="chat-send" onclick="sendMsg()">➤</button>
          </div>
        </div>
        <button class="chat-btn" onclick="toggleChat()" title="AI에게 물어보기">${emoji}</button>
      </div>`;
  }

  // === 전체 페이지 렌더링 ===
  function renderPage(page) {
    const contents = page.contents || [];
    const greeting = getContent(contents, 'greeting');
    const skills = getContent(contents, 'skills');
    const portfolio = getContent(contents, 'portfolio');
    const contact = getContent(contents, 'contact');

    // 페이지 타이틀 설정
    document.title = greeting
      ? `${greeting.name}${greeting.title ? ' - ' + greeting.title : ''}`
      : `/${page.id}`;

    let html = '';
    html += buildNav(contents, greeting);
    html += buildHero(greeting);

    // 콘텐츠 블록 순서대로 렌더링
    let freetextIdx = 0;
    contents.forEach(c => {
      switch (c.type) {
        case 'greeting':
          html += buildAbout(c.data);
          break;
        case 'skills':
          html += buildSkills(c.data);
          break;
        case 'portfolio':
          html += buildPortfolio(c.data);
          break;
        case 'contact':
          html += buildContact(c.data);
          break;
        case 'freetext':
          html += buildFreetext(c.data, freetextIdx++);
          break;
        case 'project':
          html += buildProject(c.data);
          break;
      }
    });

    html += `<footer>© ${new Date().getFullYear()} ${esc(greeting?.name || '')} · ${THEME_EMOJI[currentTheme]} Made with care</footer>`;
    html += buildChat(greeting);

    app.innerHTML = html;

    // 후처리
    initCharts(skills);
    initScrollAnimations();
    initChatPersona(page);
  }

  // === Chart.js 초기화 ===
  function initCharts(skills) {
    if (!skills) return;
    const items = (skills.items || []).filter(it => it.name);
    if (!items.length) return;

    // 분류별 그룹핑
    const groups = {};
    items.forEach(it => {
      const cat = it.category || '기타';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(it.name);
    });

    // 테마별 차트 색상
    const palettes = {
      blue:  ['#2e5c9e', '#4e7cc0', '#6a96d4', '#3a7a5a', '#5a9a7a', '#7ab0e8'],
      green: ['#2e7c3e', '#4ea65e', '#6ac47a', '#3a6a5a', '#5a8a7a', '#8ac49a'],
      brown: ['#7c5c2e', '#a67c4e', '#c4996a', '#5a7a3a', '#8aab5e', '#d4b896'],
      pink:  ['#9e2e5c', '#c04e7c', '#d46a96', '#7a3a5a', '#9a5a7a', '#e896b8'],
    };
    const palette = palettes[currentTheme] || palettes.brown;

    // 랜덤 스킬 수치 생성 (65~98 범위)
    const genScores = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 33) + 65);

    Object.keys(groups).forEach((cat, i) => {
      const el = document.getElementById(`skillChart-${i}`);
      if (!el) return;
      const labels = groups[cat];
      const colors = labels.map((_, j) => palette[j % palette.length]);

      new Chart(el, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ data: genScores(labels.length), backgroundColor: colors, borderRadius: 6, barThickness: 16 }]
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => v + '%', font: { size: 11 } } },
            y: { grid: { display: false }, ticks: { font: { size: 12 } } }
          },
          animation: { duration: 1000 }
        }
      });
    });
  }

  // === 스크롤 애니메이션 ===
  function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.15 });

    document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
  }

  // === Chat 페르소나 설정 ===
  let chatPersona = '';
  let chatHistory = [];

  function initChatPersona(page) {
    const contents = page.contents || [];
    const g = getContent(contents, 'greeting');
    const s = getContent(contents, 'skills');
    const p = getContent(contents, 'portfolio');
    const c = getContent(contents, 'contact');

    let info = `당신은 ${g?.name || '포트폴리오 주인'}의 AI 어시스턴트입니다.\n`;
    if (g?.name) info += `이름: ${g.name}\n`;
    if (g?.title) info += `직함: ${g.title}\n`;
    if (g?.bio) info += `소개: ${g.bio}\n`;
    if (s?.tags?.length) info += `기술스택: ${s.tags.join(', ')}\n`;
    if (p?.items?.length) {
      info += `프로젝트:\n`;
      p.items.forEach(it => { info += `- ${it.title}: ${it.desc || ''}\n`; });
    }
    if (c?.email) info += `이메일: ${c.email}\n`;
    if (c?.phone) info += `전화: ${c.phone}\n`;
    info += `친절하고 간결하게 한국어로 2-3문장 이내로 답하세요.`;

    chatPersona = info;
    chatHistory = [];
  }

  // === 글로벌 함수 등록 ===
  window.toggleNav = function () {
    document.getElementById('navLinks').classList.toggle('open');
  };
  window.closeNav = function () {
    document.getElementById('navLinks').classList.remove('open');
  };
  window.toggleChat = function () {
    const w = document.getElementById('chatWindow');
    w.classList.toggle('open');
    if (w.classList.contains('open')) document.getElementById('chatInput').focus();
  };
  window.submitForm = function () {
    const n = document.getElementById('f-name')?.value;
    const e = document.getElementById('f-email')?.value;
    const m = document.getElementById('f-msg')?.value;
    if (!n || !e || !m) { alert('모든 항목을 입력해 주세요.'); return; }
    document.getElementById('form-success').style.display = 'block';
    document.getElementById('f-name').value = '';
    document.getElementById('f-email').value = '';
    document.getElementById('f-msg').value = '';
  };
  window.sendMsg = async function () {
    const inp = document.getElementById('chatInput');
    const msgs = document.getElementById('chatMessages');
    const txt = inp.value.trim();
    if (!txt) return;
    inp.value = '';

    const uDiv = document.createElement('div');
    uDiv.className = 'msg user'; uDiv.textContent = txt;
    msgs.appendChild(uDiv);

    const tDiv = document.createElement('div');
    tDiv.className = 'msg bot typing'; tDiv.textContent = '입력 중...';
    msgs.appendChild(tDiv);
    msgs.scrollTop = msgs.scrollHeight;

    chatHistory.push({ role: 'user', content: txt });
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: chatPersona,
          messages: chatHistory
        })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || '죄송해요, 잠시 후 다시 시도해 주세요.';
      chatHistory.push({ role: 'assistant', content: reply });
      tDiv.className = 'msg bot'; tDiv.textContent = reply;
    } catch (e) {
      tDiv.className = 'msg bot'; tDiv.textContent = '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    }
    msgs.scrollTop = msgs.scrollHeight;
  };

  // === 초기화 ===
  async function init() {
    applyRandomTheme();

    const pageId = getPageId();
    if (!pageId || pageId === 'admin') return;

    try {
      const page = await fetchPage(pageId);
      if (page.status !== 'published') {
        renderError('🔒', '비공개 페이지입니다');
        return;
      }
      renderPage(page);
    } catch (err) {
      if (err.message === '404') {
        renderError('404', '페이지를 찾을 수 없습니다');
      } else {
        renderError('⚠️', '오류가 발생했습니다');
        console.error(err);
      }
    }
  }

  init();
})();
