/**
 * mdParser.js
 * Markdown 텍스트 → 슬라이드 데이터 배열 변환
 *
 * 슬라이드 분할 기준:
 *   # H1  → 표지(cover) 또는 섹션 구분 슬라이드
 *   ## H2 → 콘텐츠 슬라이드 (본문 포함)
 *   --- (수평선) → 강제 슬라이드 구분
 *
 * 반환 타입:
 *   Array<{
 *     type: 'cover' | 'section' | 'bullets' | 'code' | 'table' | 'text',
 *     title: string,
 *     subtitle?: string,       // cover 슬라이드 전용
 *     items?: string[],        // bullets
 *     code?: string,           // code
 *     language?: string,       // code
 *     tableData?: string[][],  // table
 *     body?: string,           // text
 *   }>
 */

export function parseMd(mdText) {
  const slides = [];

  // \r\n 정규화
  const text = mdText.replace(/\r\n/g, '\n').trim();

  // --- 또는 *** 구분자로 섹션 분리 후, 각 섹션을 헤딩 기준으로 다시 분리
  const rawSections = text.split(/\n---+\n|\n\*\*\*+\n/);

  for (const section of rawSections) {
    if (!section.trim()) continue;

    // H1 / H2 기준으로 청크 분리
    // H1 → cover or section, H2 → content slide
    const chunks = splitByHeadings(section.trim());
    for (const chunk of chunks) {
      const slide = parseChunk(chunk);
      if (slide) slides.push(slide);
    }
  }

  return slides;
}

/** 헤딩(#, ##) 기준으로 텍스트를 청크 배열로 분리 */
function splitByHeadings(text) {
  const lines = text.split('\n');
  const chunks = [];
  let current = [];

  for (const line of lines) {
    if (/^#{1,2} /.test(line) && current.length > 0) {
      chunks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks.filter(c => c.trim());
}

/** 하나의 청크(헤딩 + 본문)를 슬라이드 객체로 변환 */
function parseChunk(chunk) {
  const lines = chunk.split('\n');
  const firstLine = lines[0];
  const bodyLines = lines.slice(1).filter(l => l !== undefined);

  // ── H1: cover / section ──────────────────────────────
  if (/^# /.test(firstLine)) {
    const title = firstLine.replace(/^# /, '').trim();
    const subtitle = bodyLines
      .find(l => l.trim() && !/^#+/.test(l))
      ?.trim() ?? '';
    return { type: 'cover', title, subtitle };
  }

  // ── H2 이하: content slide ───────────────────────────
  if (/^#{2,} /.test(firstLine)) {
    const title = firstLine.replace(/^#{2,} /, '').trim();
    const body  = bodyLines.join('\n').trim();
    return buildContentSlide(title, body);
  }

  // ── 헤딩 없는 본문(맨 앞 섹션) ───────────────────────
  const body = chunk.trim();
  if (!body) return null;
  return buildContentSlide('', body);
}

/** 본문 타입을 감지해서 적절한 슬라이드 객체 반환 */
function buildContentSlide(title, body) {
  if (!body) return { type: 'section', title };

  // 코드 블록
  const codeMatch = body.match(/^```(\w*)\n([\s\S]*?)```/m);
  if (codeMatch) {
    return {
      type: 'code',
      title,
      language: codeMatch[1] || 'plaintext',
      code: codeMatch[2].trimEnd(),
    };
  }

  // 표 (|로 시작하는 줄이 있는 경우)
  if (/^\|.+\|/m.test(body)) {
    return { type: 'table', title, tableData: parseTable(body) };
  }

  // 불릿 목록
  const bulletLines = body.match(/^[ \t]*[-*+] .+/gm);
  if (bulletLines && bulletLines.length >= 2) {
    return {
      type: 'bullets',
      title,
      items: parseBullets(body),
    };
  }

  // 일반 텍스트
  return { type: 'text', title, body };
}

/** Markdown 표 → 2차원 배열 */
function parseTable(body) {
  const rows = body
    .split('\n')
    .filter(l => /^\|/.test(l) && !/^\|[-: |]+\|$/.test(l)); // 구분선 제외
  return rows.map(row =>
    row
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim())
  );
}

/** 불릿 목록 파싱 (중첩 인덴트 포함) */
function parseBullets(body) {
  return body
    .split('\n')
    .filter(l => /^[ \t]*[-*+] /.test(l))
    .map(l => {
      const indent = l.match(/^([ \t]*)/)[1].length;
      const text   = l.replace(/^[ \t]*[-*+] /, '').trim();
      // 인덴트 레벨을 앞의 공백으로 보존 (pptxBuilder에서 활용)
      return { text, indent: Math.floor(indent / 2) };
    });
}
