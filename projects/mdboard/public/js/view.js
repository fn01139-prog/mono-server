/**
 * view.js  ─  마크다운 뷰어 페이지 전용 스크립트
 * mdBoard
 */

/* ── 상태 ──────────────────────────────────────────────────────────────── */
let currentFile = null;
let currentTheme = Store.get('view-theme', 'ivory');

/* ── DOM 준비 ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  initThemeSwitcher();

  const params = new URLSearchParams(location.search);
  const file   = params.get('file');

  if (file) {
    loadFile(file);
  } else {
    showEmpty();
  }

  // 부모 프레임에 로드 완료 알림
  notifyParent({ type: 'view-ready' });

  // 편집 버튼 초기 상태: 부모로부터 auth-changed 메시지 수신 전까지 숨김
  setEditBtnVisible(Auth.isAuthenticated());
});

function setEditBtnVisible(show) {
  const btn = document.querySelector('.view-action-btn[onclick="editFile()"]');
  if (btn) btn.style.display = show ? '' : 'none';
}

/* ── 파일 로드 & 렌더 ──────────────────────────────────────────────────── */
async function loadFile(name) {
  currentFile = name;
  showLoading();

  try {
    const data = await API.get(`/mdboard/api/file/${encodeURIComponent(name)}`);
    if (!data.success) throw new Error(data.error || '파일 로드 실패');
    renderMarkdown(data);
  } catch (e) {
    showError(e.message);
  }
}

function renderMarkdown(data) {
  const root    = document.getElementById('viewRoot');
  const toolbar = document.getElementById('viewToolbar');
  const wrap    = document.getElementById('viewWrap');
  const meta    = document.getElementById('docMeta');
  const body    = document.getElementById('mdBody');

  // 메타 정보
  if (meta) {
    const displayName = data.name.replace(/\.md$/i, '');
    meta.innerHTML = `
      <span class="doc-tag-bar"></span>
      <span>${displayName}</span>
      <span>·</span>
      <span>수정: ${formatDate(data.modified, true)}</span>
      <span>·</span>
      <span>${formatSize(data.size)}</span>
    `;
  }

  // Markdown → HTML 변환
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
    let html = marked.parse(data.content);

    // 코드 블록에 언어 속성 추가 (data-lang)
    html = html.replace(
      /<pre><code class="language-(\w+)">/g,
      (_, lang) => `<pre data-lang="${lang}"><code class="language-${lang}">`
    );

    body.innerHTML = html;
  } else {
    // marked 없으면 텍스트로 표시
    body.textContent = data.content;
  }

  // 체크박스 처리
  body.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.disabled = false; // 클릭 허용
  });

  // 이미지 오류 처리
  body.querySelectorAll('img').forEach(img => {
    img.onerror = () => {
      img.style.border = '1px dashed #ccc';
      img.style.padding = '8px';
      img.alt = '이미지를 불러올 수 없습니다: ' + img.src;
    };
  });

  // 외부 링크 새탭 열기
  body.querySelectorAll('a[href]').forEach(a => {
    if (a.href.startsWith('http')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  });

  // 툴바 파일명 업데이트
  const breadcrumb = document.getElementById('viewBreadcrumb');
  if (breadcrumb) {
    const title = data.content.match(/^#\s+(.+)/m)?.[1] || data.name;
    breadcrumb.innerHTML = `
      <span>📄</span>
      <span>${title}</span>
    `;
  }

  // PowerPoint Download에 파일명 전달
  const downPowerPoint = document.getElementById('downPowerPoint');
  if (downPowerPoint) {
    downPowerPoint.dataset.mdFile = data.name;
  }

  // 부모에 제목 전달
  const titleMatch = data.content.match(/^#\s+(.+)/m);
  notifyParent({ type: 'file-loaded', name: data.name, title: titleMatch?.[1] || data.name });
}

/* ── 테마 ──────────────────────────────────────────────────────────────── */
function applyTheme(theme) {
  const root = document.getElementById('viewRoot');
  if (!root) return;
  root.className = 'view-root theme-' + theme;
  currentTheme = theme;
  Store.set('view-theme', theme);

  // 테마 버튼 active 처리
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

  // 부모에 테마 변경 알림
  notifyParent({ type: 'theme-change', theme });
}

function initThemeSwitcher() {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
}

/* ── 편집 버튼 ─────────────────────────────────────────────────────────── */
function editFile() {
  if (!currentFile) return;
  notifyParent({ type: 'open-editor', name: currentFile });
}

/* ── 상태 표시 ─────────────────────────────────────────────────────────── */
function showLoading() {
  const body = document.getElementById('mdBody');
  const meta = document.getElementById('docMeta');
  if (meta) meta.innerHTML = '';
  if (body) body.innerHTML = `
    <div class="view-loading">
      <div class="view-loading-icon">📄</div>
      <div>문서를 불러오는 중...</div>
    </div>
  `;
}

function showEmpty() {
  const body = document.getElementById('mdBody');
  const meta = document.getElementById('docMeta');
  if (meta) meta.innerHTML = '';
  if (body) body.innerHTML = `
    <div class="view-empty">
      <div class="view-loading-icon">📭</div>
      <div>표시할 문서가 없습니다.<br>왼쪽 사이드바에서 문서를 선택하세요.</div>
    </div>
  `;
}

function showError(msg) {
  const body = document.getElementById('mdBody');
  if (body) body.innerHTML = `
    <div class="view-empty">
      <div class="view-loading-icon">⚠️</div>
      <div style="color:#e05555">${msg}</div>
    </div>
  `;
}

/* ── 부모 프레임 통신 ──────────────────────────────────────────────────── */
function notifyParent(msg) {
  if (window.parent !== window) {
    window.parent.postMessage(msg, '*');
  }
}

/* ── postMessage 수신 (부모로부터 명령) ───────────────────────────────── */
window.addEventListener('message', (e) => {
  const { type, data, authed } = e.data || {};
  if (type === 'load-file' && data?.name) {
    loadFile(data.name);
  }
  if (type === 'auth-changed') {
    setEditBtnVisible(authed);
  }
});

/* ── Marp 내보내기 ─────────────────────────────────────────────────────── */
function exportMarp(format) {
  if (!currentFile) {
    showToast('먼저 문서를 선택하세요.', 'error');
    return;
  }
  const url = `/mdboard/api/export/${format}/${encodeURIComponent(currentFile)}`;
  if (format === 'html') {
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile.replace(/\.md$/i, '.html');
    a.click();
  } else {
    window.open(url, '_blank');
  }
}

/* 전역 노출 */
window.editFile   = editFile;
window.applyTheme = applyTheme;
window.exportMarp = exportMarp;
