/**
 * pptxBuilder.js
 * 슬라이드 데이터 배열 → PptxGenJS PPTX 파일 생성 + 다운로드
 *
 * 의존성:
 *   <script src="https://cdn.jsdelivr.net/npm/pptxgenjs/dist/pptxgen.bundle.js"></script>
 *   (window.PptxGenJS 전역 노출)
 *
 * 사용:
 *   import { buildAndDownload } from './pptxBuilder.js';
 *   buildAndDownload(slides, { fileName: '교육자료', template: 'corporate' });
 */

// ─────────────────────────────────────────────────────────────────────────────
// 템플릿 정의 (필요에 따라 추가·수정)
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATES = {
  corporate: {
    // 색상 (# 없이 6자리 hex)
    accentColor:     '1F4E79',   // 헤더 바, 강조
    accentLight:     'D6E4F0',   // 표 헤더 배경
    bgColor:         'FFFFFF',
    textPrimary:     '1A1A1A',
    textSecondary:   '4A4A4A',
    textOnAccent:    'FFFFFF',
    codeBg:          'F4F6F8',
    codeBorder:      'D0D7DE',
    codeText:        '24292F',

    // 폰트 (시스템 폰트 또는 내장 폰트)
    fontTitle:       '맑은 고딕',
    fontBody:        '맑은 고딕',
    fontCode:        'Courier New',

    // 크기 (pt)
    titleSize:       28,
    subtitleSize:    18,
    bodySize:        16,
    codeSize:        13,
    footerSize:      10,

    // 레이아웃
    layout:          'LAYOUT_16x9',
    slideW:          10,   // inches
    slideH:          5.625,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 메인 진입점
// ─────────────────────────────────────────────────────────────────────────────
export async function buildAndDownload(slides, options = {}) {
  const {
    fileName    = '프레젠테이션',
    template    = 'corporate',
    docTitle    = '',
    footerText  = '',
  } = options;

  const T   = TEMPLATES[template] ?? TEMPLATES.corporate;
  const prs = new PptxGenJS();

  prs.layout  = T.layout;
  prs.title   = docTitle || fileName;
  prs.author  = '';

  for (const slide of slides) {
    const s = prs.addSlide();
    s.background = { color: T.bgColor };

    switch (slide.type) {
      case 'cover':   addCoverSlide(prs, s, slide, T, footerText);   break;
      case 'section': addSectionSlide(prs, s, slide, T, footerText); break;
      case 'bullets': addBulletsSlide(prs, s, slide, T, footerText); break;
      case 'code':    addCodeSlide(prs, s, slide, T, footerText);    break;
      case 'table':   addTableSlide(prs, s, slide, T, footerText);   break;
      default:        addTextSlide(prs, s, slide, T, footerText);    break;
    }
  }

  await prs.writeFile({ fileName: `${fileName}.pptx` });
}

// ─────────────────────────────────────────────────────────────────────────────
// 슬라이드 타입별 렌더러
// ─────────────────────────────────────────────────────────────────────────────

/** 표지 슬라이드 */
function addCoverSlide(prs, s, { title, subtitle }, T, footer) {
  // 상단 2/3 액센트 블록
  s.addShape(prs.shapes.RECTANGLE, {
    x: 0, y: 0, w: T.slideW, h: 3.5,
    fill: { color: T.accentColor },
    line: { color: T.accentColor },
  });

  // 제목
  s.addText(title || '', {
    x: 0.6, y: 0.9, w: 8.8, h: 1.6,
    fontSize: 36, fontFace: T.fontTitle,
    bold: true, color: T.textOnAccent,
    valign: 'middle', margin: 0,
  });

  // 부제목
  if (subtitle) {
    s.addText(subtitle, {
      x: 0.6, y: 2.5, w: 8.8, h: 0.7,
      fontSize: T.subtitleSize, fontFace: T.fontBody,
      color: T.accentLight, margin: 0,
    });
  }

  // 하단 액센트 라인
  s.addShape(prs.shapes.RECTANGLE, {
    x: 0, y: 3.5, w: T.slideW, h: 0.06,
    fill: { color: T.accentLight },
    line: { color: T.accentLight },
  });

  addFooter(s, footer, T);
}

/** 섹션 구분 슬라이드 */
function addSectionSlide(prs, s, { title }, T, footer) {
  // 왼쪽 액센트 바
  s.addShape(prs.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.18, h: T.slideH,
    fill: { color: T.accentColor },
    line: { color: T.accentColor },
  });

  s.addText(title || '', {
    x: 0.5, y: 1.8, w: 9, h: 1.2,
    fontSize: 30, fontFace: T.fontTitle,
    bold: true, color: T.accentColor,
    valign: 'middle', margin: 0,
  });

  addFooter(s, footer, T);
}

/** 불릿 목록 슬라이드 */
function addBulletsSlide(prs, s, { title, items }, T, footer) {
  addHeader(prs, s, title, T);

  const textArr = items.map(({ text, indent }, idx) => ({
    text,
    options: {
      bullet:      true,
      indentLevel: indent,
      breakLine:   idx < items.length - 1,
      color:       T.textPrimary,
      fontSize:    T.bodySize,
      fontFace:    T.fontBody,
      paraSpaceAfter: 4,
    },
  }));

  s.addText(textArr, {
    x: 0.5, y: 1.1, w: 9, h: 4.0,
    valign: 'top', margin: [0, 0, 0, 10],
  });

  addFooter(s, footer, T);
}

/** 코드 슬라이드 */
function addCodeSlide(prs, s, { title, code, language }, T, footer) {
  addHeader(prs, s, title, T);

  // 언어 뱃지
  if (language && language !== 'plaintext') {
    s.addText(language.toUpperCase(), {
      x: 0.5, y: 1.0, w: 1.2, h: 0.28,
      fontSize: 9, fontFace: T.fontCode,
      color: T.textOnAccent,
      fill: { color: T.accentColor },
      align: 'center', valign: 'middle', margin: 0,
    });
  }

  // 코드 배경 박스
  s.addShape(prs.shapes.RECTANGLE, {
    x: 0.4, y: 1.3, w: 9.2, h: 3.9,
    fill: { color: T.codeBg },
    line: { color: T.codeBorder, width: 0.5 },
  });

  s.addText(code || '', {
    x: 0.6, y: 1.4, w: 8.8, h: 3.7,
    fontSize: T.codeSize, fontFace: T.fontCode,
    color: T.codeText, valign: 'top', margin: 0,
    lineSpacingMultiple: 1.3,
    // 줄 바꿈 유지
    wrap: true,
  });

  addFooter(s, footer, T);
}

/** 표 슬라이드 */
function addTableSlide(prs, s, { title, tableData }, T, footer) {
  addHeader(prs, s, title, T);

  if (!tableData || tableData.length === 0) {
    addFooter(s, footer, T);
    return;
  }

  const [headerRow, ...bodyRows] = tableData;
  const colCount = headerRow.length;
  const colW     = Array(colCount).fill(9.0 / colCount);

  // 헤더 행
  const header = headerRow.map(cell => ({
    text: cell,
    options: {
      bold: true, color: T.textOnAccent,
      fill: { color: T.accentColor },
      fontSize: T.bodySize - 1, fontFace: T.fontBody,
      align: 'center', valign: 'middle',
      border: [
        { pt: 0.5, color: T.accentColor },
        { pt: 0.5, color: T.accentColor },
        { pt: 0.5, color: T.accentColor },
        { pt: 0.5, color: T.accentColor },
      ],
    },
  }));

  // 데이터 행
  const rows = bodyRows.map((row, ri) =>
    row.map(cell => ({
      text: cell,
      options: {
        fill: { color: ri % 2 === 0 ? 'FFFFFF' : T.accentLight },
        color: T.textPrimary,
        fontSize: T.bodySize - 2, fontFace: T.fontBody,
        valign: 'middle',
        border: [
          { pt: 0.3, color: 'D0D7DE' },
          { pt: 0.3, color: 'D0D7DE' },
          { pt: 0.3, color: 'D0D7DE' },
          { pt: 0.3, color: 'D0D7DE' },
        ],
      },
    }))
  );

  s.addTable([header, ...rows], {
    x: 0.5, y: 1.1, w: 9.0,
    colW,
    rowH: 0.38,
  });

  addFooter(s, footer, T);
}

/** 일반 텍스트 슬라이드 */
function addTextSlide(prs, s, { title, body }, T, footer) {
  addHeader(prs, s, title, T);

  s.addText(body || '', {
    x: 0.5, y: 1.1, w: 9, h: 4.0,
    fontSize: T.bodySize, fontFace: T.fontBody,
    color: T.textPrimary, valign: 'top',
    lineSpacingMultiple: 1.5, wrap: true, margin: 0,
  });

  addFooter(s, footer, T);
}

// ─────────────────────────────────────────────────────────────────────────────
// 공통 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 슬라이드 상단 제목 바 */
function addHeader(prs, s, title, T) {
  // 헤더 바
  s.addShape(prs.shapes.RECTANGLE, {
    x: 0, y: 0, w: T.slideW, h: 0.78,
    fill: { color: T.accentColor },
    line: { color: T.accentColor },
  });

  if (title) {
    s.addText(title, {
      x: 0.4, y: 0, w: 9.2, h: 0.78,
      fontSize: T.titleSize, fontFace: T.fontTitle,
      bold: true, color: T.textOnAccent,
      valign: 'middle', margin: 0,
    });
  }
}

/** 슬라이드 하단 푸터 */
function addFooter(s, text, T) {
  if (!text) return;
  s.addText(text, {
    x: 0.3, y: T.slideH - 0.28, w: T.slideW - 0.6, h: 0.24,
    fontSize: T.footerSize, fontFace: T.fontBody,
    color: 'AAAAAA', align: 'right', margin: 0,
  });
}
