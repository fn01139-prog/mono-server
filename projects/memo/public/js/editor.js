(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const docId = params.get('docId');
  const queryMajorId = params.get('majorId');
  const queryMidId = params.get('midId');

  const titleInput = document.getElementById('doc-title');
  const statusEl = document.getElementById('editor-status');
  const btnSave = document.getElementById('btn-save');
  const btnCancel = document.getElementById('btn-cancel');
  const btnSource = document.getElementById('btn-source');
  const sourceEl = document.getElementById('html-source');

  let editorInstance = null;
  let majorId = queryMajorId;
  let midId = queryMidId;
  let sourceMode = false;

  class UploadAdapter {
    constructor(loader) { this.loader = loader; }
    upload() {
      return this.loader.file.then(
        (file) =>
          new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('image', file);
            // <base href="/memo/"> 덕분에 상대경로가 항상 /memo/api/... 로 해석됨
            fetch(`api/upload-image?midId=${encodeURIComponent(midId)}`, { method: 'POST', body: formData, credentials: 'same-origin' })
              .then(async (r) => {
                const data = await r.json().catch(() => ({}));
                if (!r.ok) return reject(data.error || '이미지 업로드에 실패했습니다.');
                resolve({ default: data.default });
              })
              .catch(() => reject('이미지 업로드에 실패했습니다.'));
          })
      );
    }
    abort() {}
  }

  function uploadAdapterPlugin(editor) {
    editor.plugins.get('FileRepository').createUploadAdapter = (loader) => new UploadAdapter(loader);
  }

  async function initEditor(initialHtml) {
    editorInstance = await ClassicEditor.create(document.getElementById('editor'), {
      extraPlugins: [uploadAdapterPlugin],
    });
    editorInstance.setData(initialHtml || '');
  }

  async function boot() {
    if (docId) {
      try {
        const res = await fetch(`api/docs/${docId}`, { credentials: 'same-origin' });
        const doc = await res.json();
        if (!res.ok) throw new Error(doc.error || '문서를 불러오지 못했습니다.');
        majorId = doc.majorId;
        midId = doc.midId;
        titleInput.value = doc.title;
        await initEditor(doc.html);
      } catch (e) {
        statusEl.textContent = e.message;
      }
    } else {
      if (!majorId || !midId) {
        statusEl.textContent = '잘못된 접근입니다 (majorId/midId 없음).';
        return;
      }
      await initEditor('');
    }
  }

  // ---------- HTML 소스 편집 토글 ----------
  // CKEditor의 기본(prebuilt classic) 빌드에는 공식 Source Editing 플러그인이 포함되어 있지
  // 않아서, 같은 역할을 하는 간단한 textarea 토글을 직접 구현함. 이미지 width/height/style 같은
  // 속성은 CKEditor가 인식하는 값이라 왕복해도 유지되지만, 에디터가 모르는 임의의 태그/속성은
  // 미리보기(WYSIWYG)로 돌아가는 순간 사라질 수 있음 — 마지막에 "저장"을 누르면 그 시점에
  // textarea에 있는 내용이 그대로(가공 없이) 저장됨.

  function enterSourceMode() {
    if (!editorInstance) return;
    sourceEl.value = editorInstance.getData();
    document.querySelector('.ck-editor').style.display = 'none';
    sourceEl.style.display = 'block';
    sourceMode = true;
    btnSource.classList.add('active');
    btnSource.textContent = '미리보기로 전환';
  }

  function exitSourceMode() {
    editorInstance.setData(sourceEl.value);
    sourceEl.style.display = 'none';
    document.querySelector('.ck-editor').style.display = '';
    sourceMode = false;
    btnSource.classList.remove('active');
    btnSource.textContent = 'HTML 편집';
  }

  btnSource.addEventListener('click', () => {
    if (sourceMode) exitSourceMode();
    else enterSourceMode();
  });

  btnSave.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { statusEl.textContent = '문서 제목을 입력하세요.'; return; }
    if (!editorInstance) return;
    statusEl.textContent = '';
    const html = sourceMode ? sourceEl.value : editorInstance.getData();
    try {
      let result;
      if (docId) {
        const res = await fetch(`api/docs/${docId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, html }),
          credentials: 'same-origin',
        });
        result = await res.json();
        if (!res.ok) throw new Error(result.error || '저장에 실패했습니다.');
      } else {
        const res = await fetch('api/docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ majorId, midId, title, html }),
          credentials: 'same-origin',
        });
        result = await res.json();
        if (!res.ok) throw new Error(result.error || '저장에 실패했습니다.');
      }
      window.parent.postMessage({ type: 'memo:saved', docId: result.id }, '*');
    } catch (e) {
      statusEl.textContent = e.message;
    }
  });

  btnCancel.addEventListener('click', () => {
    window.parent.postMessage({ type: 'memo:cancelled' }, '*');
  });

  boot();
})();
