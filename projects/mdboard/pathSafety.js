/**
 * projects/mdboard/pathSafety.js
 * 콘텐츠 경로 검증 헬퍼 — index.js와 publish-routes.js가 공용으로 사용한다.
 * (동일 로직이 두 곳에서 따로 구현되면 한쪽만 고쳤을 때 경로 탈출 검증이
 * 어긋날 수 있어 단일 정의로 유지한다.)
 */
'use strict';

const path = require('path');
const { CONTENTS_DIR } = require('./paths');

// relPath: 'file.md' 또는 'folder/file.md' (최대 2단계)
function safePath(relPath) {
  if (!relPath) return null;
  const parts = relPath.replace(/\\/g, '/').split('/').filter(p => p && p !== '..' && p !== '.');
  if (parts.length === 0 || parts.length > 2) return null;
  if (parts.length === 2 && parts[0] === 'img') return null;
  const resolved = path.resolve(CONTENTS_DIR, ...parts);
  const base = CONTENTS_DIR.endsWith(path.sep) ? CONTENTS_DIR : CONTENTS_DIR + path.sep;
  return resolved.startsWith(base) ? resolved : null;
}

// HTML 파일명 검증 (루트 레벨만 허용)
function safeHtmlPath(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const base = path.basename(filename);
  if (!/\.html?$/i.test(base)) return null;
  const resolved = path.resolve(CONTENTS_DIR, base);
  const contentsBase = CONTENTS_DIR.endsWith(path.sep) ? CONTENTS_DIR : CONTENTS_DIR + path.sep;
  return resolved.startsWith(contentsBase) ? resolved : null;
}

// 폴더명 검증 (슬래시, '..' 등 불허)
function safeFolderPath(name) {
  if (!name || typeof name !== 'string') return null;
  const cleaned = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  if (!cleaned || cleaned === 'img' || cleaned === '.' || cleaned === '..') return null;
  const resolved = path.resolve(CONTENTS_DIR, cleaned);
  const base = CONTENTS_DIR.endsWith(path.sep) ? CONTENTS_DIR : CONTENTS_DIR + path.sep;
  return resolved.startsWith(base) ? resolved : null;
}

module.exports = { safePath, safeHtmlPath, safeFolderPath };
