/**
 * editor.js  ─  마크다운 에디터 페이지 전용 스크립트
 * mdBoard
 */

/* ── 상태 ──────────────────────────────────────────────────────────────── */
let currentFile   = null;   // 파일명만 (예: 'doc.md')
let currentFolder = null;   // 폴더명 (예: 'SAP') 또는 null
let isModified    = false;
let viewMode      = 'split';
let previewTimer  = null;
let imgPanelOpen  = false;

/* ── DOM 준비 ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const file   = params.get('file'); // 'folder/file.md' or 'file.md'

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
async function loadFile(filePath) {
  try {
    const urlPath = filePath.split('/').map(encodeURIComponent).join('/');
    const data = await API.get(`/mdboard/api/file/${urlPath}`);
    if (!data.success) throw new Error(data.error);

    currentFile   = data.name;
    currentFolder = data.folder || null;
    document.getElementById('titleInput').value = data.name.replace(/\.md$/i, '');
    document.getElementById('mdTextarea').value = data.content;
    isModified = false;
    updateStatusBar();
    schedulePreview();
    updateFolderBadge();

    notifyParent({ type: 'editor-loaded', path: data.path || filePath, name: data.name });
  } catch (e) {
    showToast('파일 로드 실패: ' + e.message, 'error');
  }
}

/* ── 폴더 뱃지 표시 ────────────────────────────────────────────────────── */
function updateFolderBadge() {
  const badge = document.getElementById('folderBadge');
  if (!badge) return;
  if (currentFolder) {
    badge.textContent = '📁 ' + currentFolder;
    badge.style.display = 'inline-block';
  } else {
    badge.textContent = '📁 기본';
    badge.style.display = 'inline-block';
  }
}

/* ── 저장 ──────────────────────────────────────────────────────────────── */
function saveFile() {
  const title   = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('mdTextarea').value;
  if (!title) {
    openSaveDialog(content);
    return;
  }
  doSave(title, content);
}

function openSaveDialog(content) {
  const overlay  = document.getElementById('saveDialogOverlay');
  const input    = document.getElementById('saveNameInput');
  const suggested = content.match(/^#\s+(.+)/m)?.[1] || '';
  input.value = suggested;
  overlay.classList.add('open');
  input.focus();
  input.select();

  // 폴더 셀렉트 갱신
  refreshFolderSelect();
}

function closeSaveDialog() {
  document.getElementById('saveDialogOverlay').classList.remove('open');
}

function confirmSave() {
  const name    = document.getElementById('saveNameInput').value.trim();
  const content = document.getElementById('mdTextarea').value;
  if (!name) { showToast('파일명을 입력하세요.', 'error'); return; }

  const folderSelect = document.getElementById('saveFolderSelect');
  if (folderSelect) {
    const selectedFolder = folderSelect.value || null;
    currentFolder = selectedFolder;
  }

  document.getElementById('titleInput').value = name;
  closeSaveDialog();
  doSave(name, content);
}

async function refreshFolderSelect() {
  const sel = document.getElementById('saveFolderSelect');
  if (!sel) return;
  try {
    const data = await API.get('/mdboard/api/folders');
    const folders = data.folders || [];
    sel.innerHTML = `<option value="">기본</option>` +
      folders.map(f => `<option value="${escHtmlAttr(f)}" ${currentFolder === f ? 'selected' : ''}>${escHtmlAttr(f)}</option>`).join('');
  } catch {}
}

function escHtmlAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function doSave(name, content) {
  try {
    const safeName_ = safeName(name);
    const body = {
      name:    safeName_,
      folder:  currentFolder || null,
      content
    };

    // 이름 또는 폴더가 바뀐 경우 구 파일 경로 전달
    if (currentFile) {
      const currentBaseName = currentFile.replace(/\.md$/i, '');
      const newBaseName     = safeName_;
      if (currentBaseName !== newBaseName || true) {
        // 항상 originalName 전달 (백엔드에서 동일하면 무시)
        body.originalName   = currentFile;
        body.originalFolder = currentFolder || null;
      }
    }

    const data = await API.post('/mdboard/api/save', body);
    if (!data.success) throw new Error(data.error);

    currentFile   = data.name;
    currentFolder = data.folder || null;
    document.getElementById('titleInput').value = data.name.replace(/\.md$/i, '');
    isModified = false;
    updateStatusBar();
    updateFolderBadge();

    showToast('저장 완료: ' + data.name, 'success');
    notifyParent({ type: 'file-saved', path: data.path, name: data.name, folder: data.folder });
  } catch (e) {
    showToast('저장 실패: ' + e.message, 'error');
  }
}

/* ── 뷰 모드 토글 ──────────────────────────────────────────────────────── */
function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('editorBody').className = 'editor-body mode-' + mode;
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
    html = html.replace(/<pre><code class="language-(\w+)">/g,
      (_, lang) => `<pre data-lang="${lang}"><code class="language-${lang}">`);
    preview.innerHTML = html;
  } else {
    preview.textContent = content;
  }
  preview.querySelectorAll('img').forEach(img => { img.onerror = () => { img.style.opacity = '0.4'; }; });
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
    btn.addEventListener('click', () => { const cmd = commands[btn.dataset.cmd]; if (cmd) { cmd(); ta.focus(); } });
  });
  ta.addEventListener('input', schedulePreview);
}

/* ── 텍스트 조작 헬퍼 ──────────────────────────────────────────────────── */
function wrapText(ta, before, after, placeholder) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const selected = v.slice(s, e) || placeholder;
  replaceSelection(ta, s, e, before + selected + after);
  if (!v.slice(s, e)) ta.setSelectionRange(s + before.length, s + before.length + placeholder.length);
}
function insertPrefix(ta, prefix) {
  const { selectionStart: s, value: v } = ta;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  const lineEnd   = v.indexOf('\n', s);
  const end       = lineEnd === -1 ? v.length : lineEnd;
  const line      = v.slice(lineStart, end);
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
  replaceSelection(ta, s, e, before + (v.slice(s, e) || '코드 입력') + after);
}
function insertTable(ta) {
  const tbl = `| 컬럼1 | 컬럼2 | 컬럼3 |\n|-------|-------|-------|\n| 값1   | 값2   | 값3   |\n| 값4   | 값5   | 값6   |\n`;
  insertText(ta, tbl);
}
function insertLink(ta) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const selected = v.slice(s, e);
  const text     = selected || '링크 텍스트';
  const newText  = `[${text}](URL)`;
  replaceSelection(ta, s, e, newText);
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
      const ta  = document.getElementById('mdTextarea');
      const alt = file.name.replace(/\.[^.]+$/, '');
      const s   = ta.selectionStart;
      replaceSelection(ta, s, ta.selectionEnd, '\n' + `![${alt}](${data.url})` + '\n');
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
  pane.addEventListener('dragover',  e => { e.preventDefault(); pane.classList.add('dragging'); });
  pane.addEventListener('dragleave', () => pane.classList.remove('dragging'));
  pane.addEventListener('drop', e => {
    e.preventDefault(); pane.classList.remove('dragging');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) handleImageUpload(files);
  });
  const fileInput = document.getElementById('imgFileInput');
  if (fileInput) fileInput.addEventListener('change', () => handleImageUpload(Array.from(fileInput.files)));
}

/* ── 자동 저장 ─────────────────────────────────────────────────────────── */
function initAutoSave() {
  setInterval(() => {
    if (!isModified) return;
    const title   = document.getElementById('titleInput').value.trim();
    const content = document.getElementById('mdTextarea').value;
    if (title && content) doSave(title, content).catch(() => {});
  }, 60000);
}

/* ── 키보드 단축키 ─────────────────────────────────────────────────────── */
function initKeyBindings() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
    if (e.key === 'Tab' && document.activeElement.id === 'mdTextarea') {
      e.preventDefault();
      insertText(document.getElementById('mdTextarea'), '  ');
    }
    if (e.key === 'Escape') closeSaveDialog();
  });
}

/* ── 상태바 갱신 ───────────────────────────────────────────────────────── */
function updateStatusBar() {
  const content = document.getElementById('mdTextarea')?.value || '';
  const { lines, words, chars } = countText(content);
  const dot  = document.querySelector('.statusbar-dot');
  const info = document.getElementById('statusInfo');
  if (dot)  dot.className  = 'statusbar-dot' + (isModified ? ' modified' : '');
  if (info) info.textContent = `${lines}줄 · ${words}단어 · ${chars}자`;
}

/* ── 새 문서 ───────────────────────────────────────────────────────────── */
function newDocument() {
  if (isModified && !confirm('저장하지 않은 내용이 있습니다. 새 문서를 작성하시겠습니까?')) return;
  currentFile   = null;
  currentFolder = null;
  isModified    = false;
  document.getElementById('titleInput').value  = '';
  document.getElementById('mdTextarea').value  = '';
  updateStatusBar();
  schedulePreview();
  updateFolderBadge();
  document.getElementById('titleInput').focus();
}

/* ── 삭제 ──────────────────────────────────────────────────────────────── */
async function deleteFile() {
  if (!currentFile) { showToast('저장된 파일이 없습니다.', 'error'); return; }
  const displayName = currentFile.replace(/\.md$/i, '');
  if (!confirm(`"${displayName}" 파일을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    const relPath = currentFolder ? `${currentFolder}/${currentFile}` : currentFile;
    const urlPath = relPath.split('/').map(encodeURIComponent).join('/');
    const data = await API.delete(`/mdboard/api/file/${urlPath}`);
    if (!data.success) throw new Error(data.error);
    showToast('삭제 완료', 'success');
    notifyParent({ type: 'file-deleted', path: relPath, name: currentFile });
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
window.saveFile        = saveFile;
window.newDocument     = newDocument;
window.deleteFile      = deleteFile;
window.toggleImgPanel  = toggleImgPanel;
window.closeImgPanel   = closeImgPanel;
window.confirmSave     = confirmSave;
window.closeSaveDialog = closeSaveDialog;
window.setViewMode     = setViewMode;
