/**
 * editor.js  ─  마크다운 에디터 페이지 전용 스크립트
 * mdBoard
 */

/* ── 상태 ──────────────────────────────────────────────────────────────── */
let currentFile   = null;   // 편집 중인 파일명 (null = 신규)
let isModified    = false;
let viewMode      = 'split'; // 'split' | 'edit' | 'preview'
let previewTimer  = null;
let imgPanelOpen  = false;

/* ── DOM 준비 ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const file   = params.get('file');

  if (file) {
    loadFile(file);
  } else {
    updateStatusBar();
    schedulePreview();
  }

  initToolbar();
  initViewToggle();
  initDragDrop();
  initAutoSave();
  initKeyBindings();
  setViewMode(viewMode);
  notifyParent({ type: 'editor-ready' });
});

/* ── 파일 로드 ─────────────────────────────────────────────────────────── */
async function loadFile(name) {
  try {
    const data = await API.get(`/mdboard/api/file/${encodeURIComponent(name)}`);
    if (!data.success) throw new Error(data.error);

    currentFile = data.name;
    document.getElementById('titleInput').value = data.name;
    document.getElementById('mdTextarea').value  = data.content;
    isModified = false;
    updateStatusBar();
    schedulePreview();

    notifyParent({ type: 'editor-loaded', name: data.name });
  } catch (e) {
    showToast('파일 로드 실패: ' + e.message, 'error');
  }
}

/* ── 저장 ──────────────────────────────────────────────────────────────── */
function saveFile() {
  const title   = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('mdTextarea').value;

  if (!title) {
    // 제목 없을 경우 다이얼로그
    openSaveDialog(content);
    return;
  }
  doSave(title, content);
}

function openSaveDialog(content) {
  const overlay = document.getElementById('saveDialogOverlay');
  const input   = document.getElementById('saveNameInput');

  // 첫 제목 줄에서 자동 제안
  const suggested = content.match(/^#\s+(.+)/m)?.[1] || '';
  input.value = suggested;
  overlay.classList.add('open');
  input.focus();
  input.select();
}

function closeSaveDialog() {
  document.getElementById('saveDialogOverlay').classList.remove('open');
}

function confirmSave() {
  const name    = document.getElementById('saveNameInput').value.trim();
  const content = document.getElementById('mdTextarea').value;
  if (!name) { showToast('파일명을 입력하세요.', 'error'); return; }
  document.getElementById('titleInput').value = name;
  closeSaveDialog();
  doSave(name, content);
}

async function doSave(name, content) {
  try {
    const body = { name: safeName(name), content };
    // 파일명 변경 시 구 파일 삭제를 위해 originalName 전달
    if (currentFile && currentFile !== safeName(name) && !currentFile.endsWith(safeName(name))) {
      body.originalName = currentFile;
    }
    const data = await API.post('/mdboard/api/save', body);
    if (!data.success) throw new Error(data.error);

    currentFile = data.name;
    document.getElementById('titleInput').value = data.name;
    isModified = false;
    updateStatusBar();
    showToast('저장 완료: ' + data.name + '.md', 'success');
    notifyParent({ type: 'file-saved', name: data.name });
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

/* ── 뷰 모드 토글 ──────────────────────────────────────────────────────── */
function setViewMode(mode) {
  viewMode = mode;
  const body = document.getElementById('editorBody');
  body.className = 'editor-body mode-' + mode;

  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode !== 'edit') updatePreview();
}

function initViewToggle() {
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
  });
}

/* ── 라이브 프리뷰 ─────────────────────────────────────────────────────── */
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 300);
  isModified = true;
  updateStatusBar();
}

function updatePreview() {
  const content = document.getElementById('mdTextarea').value;
  const preview = document.getElementById('previewBody');
  if (!preview || viewMode === 'edit') return;

  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
    let html = marked.parse(content);
    html = html.replace(
      /<pre><code class="language-(\w+)">/g,
      (_, lang) => `<pre data-lang="${lang}"><code class="language-${lang}">`
    );
    preview.innerHTML = html;
  } else {
    preview.textContent = content;
  }

  // 이미지 경로 확인
  preview.querySelectorAll('img').forEach(img => {
    img.onerror = () => { img.style.opacity = '0.4'; };
  });
}

/* ── 툴바 ──────────────────────────────────────────────────────────────── */
function initToolbar() {
  const ta = document.getElementById('mdTextarea');

  const commands = {
    bold:       () => wrapText(ta, '**', '**', '굵게'),
    italic:     () => wrapText(ta, '_', '_', '기울임'),
    strike:     () => wrapText(ta, '~~', '~~', '취소선'),
    code:       () => wrapText(ta, '`', '`', '코드'),
    h1:         () => insertPrefix(ta, '# '),
    h2:         () => insertPrefix(ta, '## '),
    h3:         () => insertPrefix(ta, '### '),
    ul:         () => insertPrefix(ta, '- '),
    ol:         () => insertOrderedList(ta),
    check:      () => insertPrefix(ta, '- [ ] '),
    blockquote: () => insertPrefix(ta, '> '),
    codeblock:  () => wrapBlock(ta, '```\n', '\n```'),
    table:      () => insertTable(ta),
    hr:         () => insertText(ta, '\n---\n'),
    link:       () => insertLink(ta),
    image:      () => toggleImgPanel()
  };

  document.querySelectorAll('.toolbar-btn[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = commands[btn.dataset.cmd];
      if (cmd) { cmd(); ta.focus(); }
    });
  });

  ta.addEventListener('input', schedulePreview);
}

/* ── 텍스트 조작 헬퍼 ──────────────────────────────────────────────────── */
function wrapText(ta, before, after, placeholder) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const selected = v.slice(s, e) || placeholder;
  const newText  = before + selected + after;
  replaceSelection(ta, s, e, newText);
  // 커서: placeholder인 경우 placeholder 선택
  if (!v.slice(s, e)) {
    ta.setSelectionRange(s + before.length, s + before.length + placeholder.length);
  }
}

function insertPrefix(ta, prefix) {
  const { selectionStart: s, value: v } = ta;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  const lineEnd   = v.indexOf('\n', s);
  const end       = lineEnd === -1 ? v.length : lineEnd;
  const line      = v.slice(lineStart, end);

  // 이미 prefix가 있으면 제거, 없으면 추가
  if (line.startsWith(prefix)) {
    replaceSelection(ta, lineStart, end, line.slice(prefix.length));
    ta.setSelectionRange(s - prefix.length, s - prefix.length);
  } else {
    replaceSelection(ta, lineStart, end, prefix + line);
    ta.setSelectionRange(s + prefix.length, s + prefix.length);
  }
}

function insertOrderedList(ta) {
  const { selectionStart: s, value: v } = ta;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  replaceSelection(ta, lineStart, lineStart, '1. ');
  ta.setSelectionRange(s + 3, s + 3);
}

function wrapBlock(ta, before, after) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const selected = v.slice(s, e) || '코드 입력';
  replaceSelection(ta, s, e, before + selected + after);
}

function insertTable(ta) {
  const tbl = `
| 컬럼1 | 컬럼2 | 컬럼3 |
|-------|-------|-------|
| 값1   | 값2   | 값3   |
| 값4   | 값5   | 값6   |
`.trimStart();
  insertText(ta, tbl);
}

function insertLink(ta) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const selected = v.slice(s, e);
  const text     = selected || '링크 텍스트';
  const newText  = `[${text}](URL)`;
  replaceSelection(ta, s, e, newText);
  // URL 부분 선택
  ta.setSelectionRange(s + text.length + 3, s + newText.length - 1);
}

function insertText(ta, text) {
  const { selectionStart: s, selectionEnd: e } = ta;
  replaceSelection(ta, s, e, text);
  ta.setSelectionRange(s + text.length, s + text.length);
}

function replaceSelection(ta, start, end, text) {
  const v = ta.value;
  ta.value = v.slice(0, start) + text + v.slice(end);
  schedulePreview();
}

/* ── 이미지 업로드 패널 ────────────────────────────────────────────────── */
function toggleImgPanel() {
  imgPanelOpen = !imgPanelOpen;
  const panel = document.getElementById('imgPanel');
  if (imgPanelOpen) {
    panel.classList.add('open');
    document.getElementById('imgFileInput').click();
  } else {
    panel.classList.remove('open');
  }
}

function closeImgPanel() {
  imgPanelOpen = false;
  document.getElementById('imgPanel').classList.remove('open');
}

async function handleImageUpload(files) {
  if (!files.length) return;
  for (const file of files) {
    try {
      showToast('업로드 중: ' + file.name, 'info');
      const data = await API.uploadImage(file);
      if (!data.success) throw new Error(data.error);

      const ta   = document.getElementById('mdTextarea');
      const alt  = file.name.replace(/\.[^.]+$/, '');
      const md   = `![${alt}](${data.url})`;
      const s    = ta.selectionStart;
      replaceSelection(ta, s, ta.selectionEnd, '\n' + md + '\n');
      showToast('이미지 삽입 완료', 'success');
    } catch (e) {
      showToast('업로드 실패: ' + e.message, 'error');
    }
  }
  closeImgPanel();
}

/* ── 드래그앤드롭 ──────────────────────────────────────────────────────── */
function initDragDrop() {
  const pane = document.querySelector('.editor-pane');
  if (!pane) return;

  pane.addEventListener('dragover', e => {
    e.preventDefault();
    pane.classList.add('dragging');
  });
  pane.addEventListener('dragleave', () => pane.classList.remove('dragging'));
  pane.addEventListener('drop', e => {
    e.preventDefault();
    pane.classList.remove('dragging');
    const files = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith('image/'));
    if (files.length) handleImageUpload(files);
  });

  // 파일 input 연결
  const fileInput = document.getElementById('imgFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', () => handleImageUpload(Array.from(fileInput.files)));
  }
}

/* ── 자동 저장 (1분마다) ───────────────────────────────────────────────── */
function initAutoSave() {
  setInterval(() => {
    if (!isModified) return;
    const title   = document.getElementById('titleInput').value.trim();
    const content = document.getElementById('mdTextarea').value;
    if (title && content) {
      doSave(title, content).catch(() => {});
    }
  }, 60000);
}

/* ── 키보드 단축키 ─────────────────────────────────────────────────────── */
function initKeyBindings() {
  document.addEventListener('keydown', e => {
    // Ctrl+S = 저장
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
    // Tab 들여쓰기 (textarea 안에서)
    if (e.key === 'Tab' && document.activeElement.id === 'mdTextarea') {
      e.preventDefault();
      const ta = document.getElementById('mdTextarea');
      insertText(ta, '  ');
    }
    // Esc = 다이얼로그 닫기
    if (e.key === 'Escape') {
      closeSaveDialog();
    }
  });
}

/* ── 상태바 갱신 ───────────────────────────────────────────────────────── */
function updateStatusBar() {
  const content = document.getElementById('mdTextarea')?.value || '';
  const { lines, words, chars } = countText(content);
  const dot = document.querySelector('.statusbar-dot');
  const info = document.getElementById('statusInfo');

  if (dot) dot.className = 'statusbar-dot' + (isModified ? ' modified' : '');
  if (info) info.textContent = `${lines}줄 · ${words}단어 · ${chars}자`;
}

/* ── 새 문서 ───────────────────────────────────────────────────────────── */
function newDocument() {
  if (isModified) {
    if (!confirm('저장하지 않은 내용이 있습니다. 새 문서를 작성하시겠습니까?')) return;
  }
  currentFile = null;
  isModified  = false;
  document.getElementById('titleInput').value  = '';
  document.getElementById('mdTextarea').value   = '';
  updateStatusBar();
  schedulePreview();
  document.getElementById('titleInput').focus();
}

/* ── 삭제 ──────────────────────────────────────────────────────────────── */
async function deleteFile() {
  if (!currentFile) { showToast('저장된 파일이 없습니다.', 'error'); return; }
  if (!confirm(`"${currentFile}" 파일을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    const data = await API.delete(`/mdboard/api/file/${encodeURIComponent(currentFile)}`);
    if (!data.success) throw new Error(data.error);
    showToast('삭제 완료', 'success');
    notifyParent({ type: 'file-deleted', name: currentFile });
    newDocument();
  } catch (e) {
    showToast('삭제 실패: ' + e.message, 'error');
  }
}

/* ── 부모 프레임 통신 ──────────────────────────────────────────────────── */
function notifyParent(msg) {
  if (window.parent !== window) window.parent.postMessage(msg, '*');
}

window.addEventListener('message', (e) => {
  const { type, data } = e.data || {};
  if (type === 'load-file' && data?.name) loadFile(data.name);
  if (type === 'new-file') newDocument();
});

/* ── 전역 노출 ─────────────────────────────────────────────────────────── */
window.saveFile       = saveFile;
window.newDocument    = newDocument;
window.deleteFile     = deleteFile;
window.toggleImgPanel = toggleImgPanel;
window.closeImgPanel  = closeImgPanel;
window.confirmSave    = confirmSave;
window.closeSaveDialog= closeSaveDialog;
window.setViewMode    = setViewMode;
