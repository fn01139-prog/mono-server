/**
 * pptDownload.js
 * PPT 다운로드 버튼에 연결하는 컨트롤러
 *
 * 역할:
 *   1. 서버 API(/api/md?file=...)로 MD 텍스트를 가져옴
 *   2. mdParser로 슬라이드 데이터 생성
 *   3. pptxBuilder로 PPTX 빌드 후 자동 다운로드
 *
 * 사용 예시 (HTML):
 *   <button data-md-file="guide/intro.md" class="ppt-btn">PPT 다운로드</button>
 *
 *   <script type="module">
 *     import { initPptButtons } from './pptDownload.js';
 *     initPptButtons();
 *   </script>
 *
 * 또는 수동 호출:
 *   import { downloadPpt } from './pptDownload.js';
 *   downloadPpt('guide/intro.md', { fileName: '입문 가이드' });
 */

import { parseMd }          from './mdParser.js';
import { buildAndDownload } from './pptxBuilder.js';

// ─────────────────────────────────────────────────────────────────────────────
// 버튼 자동 초기화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * data-md-file 속성을 가진 .ppt-btn 요소를 찾아 클릭 이벤트 등록
 * DOMContentLoaded 이후 한 번 호출하면 됩니다.
 */
export function initPptButtons() {
  document.querySelectorAll('.ppt-btn[data-md-file]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mdFile   = btn.dataset.mdFile;
      const fileName = btn.dataset.fileName || stripExt(mdFile);
      const footer   = btn.dataset.footer   || '';
      await downloadPpt(mdFile, { fileName, footer });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 핵심 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} mdFile  - 서버 기준 상대 경로 (예: "guide/intro.md")
 * @param {object} options
 *   @param {string} [options.fileName]   - 다운로드 파일명 (확장자 제외)
 *   @param {string} [options.template]  - 템플릿 키 ('corporate' 등)
 *   @param {string} [options.footer]    - 슬라이드 하단 텍스트
 *   @param {string} [options.apiBase]   - API 기본 경로 (기본: '/api')
 */
export async function downloadPpt(mdFile, options = {}) {
  const {
    fileName  = stripExt(mdFile),
    template  = 'corporate',
    footer    = '',
    apiBase   = '/api',
  } = options;

  // ── 버튼 로딩 상태 처리 ─────────────────────────────
  const btn = document.querySelector(`[data-md-file="${mdFile}"]`);
  const originalText = btn?.textContent;
  if (btn) {
    btn.disabled     = true;
    btn.textContent  = '변환 중…';
  }

  try {
    // 1. 서버에서 MD 원문 가져오기
    const mdText = await fetchMarkdown(mdFile, apiBase);

    // 2. MD → 슬라이드 데이터
    const slides = parseMd(mdText);

    if (slides.length === 0) {
      alert('슬라이드로 변환할 내용이 없습니다. Markdown 구조를 확인해 주세요.');
      return;
    }

    // 3. PPTX 빌드 + 다운로드
    await buildAndDownload(slides, { fileName, template, footer, docTitle: fileName });

  } catch (err) {
    console.error('[pptDownload] 오류:', err);
    alert(`PPT 생성 중 오류가 발생했습니다.\n${err.message}`);
  } finally {
    if (btn) {
      btn.disabled    = false;
      btn.textContent = originalText;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

async function fetchMarkdown(mdFile, apiBase) {
  const url = `${apiBase}/file/${encodeURIComponent(mdFile)}`;
  const res = await fetch(url);

//  if (!res.ok) {
//    const body = await res.json().catch(() => ({}));
//    throw new Error(body.error || `HTTP ${res.status}`);
//  }

  const { content } = await res.json();
  return content;
}

function stripExt(filePath) {
  return filePath.replace(/\.[^.]+$/, '').split('/').pop();
}
