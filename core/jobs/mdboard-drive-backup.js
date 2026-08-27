/**
 * core/jobs/mdboard-drive-backup.js
 * mdboard 콘텐츠(Railway 볼륨, projects/mdboard/paths.js)를 월 1회 Google Drive로 백업.
 *
 * 볼륨이 상시 저장소가 된 이후 Drive는 재해복구용 백업 사본 용도로만 쓰인다.
 * 매 실행마다 볼륨의 현재 상태를 Drive에 생성/갱신(overwrite)한다 — 로컬에서
 * 삭제된 파일을 Drive에서도 지우는 동작(destructive)은 하지 않는다(안전한 누적 백업).
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const driveClient = require('../../projects/mdboard/driveClient');
const { CONTENTS_DIR } = require('../../projects/mdboard/paths');

const MIME_BY_EXT = {
  '.md':   'text/markdown',
  '.html': 'text/html',
  '.htm':  'text/html',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
};

function mimeFor(relPath) {
  return MIME_BY_EXT[path.extname(relPath).toLowerCase()] || 'application/octet-stream';
}

/** 볼륨 내 백업 대상 파일의 상대경로 목록 (mdboard 폴더 구조 규칙: 최대 2단계 + img/) */
function collectFiles(contentsDir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(contentsDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    if (e.isFile()) {
      if (/\.(md|html?)$/i.test(e.name)) results.push(e.name);
    } else if (e.isDirectory()) {
      if (e.name === 'img') {
        fs.readdirSync(path.join(contentsDir, 'img'))
          .filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f))
          .forEach(f => results.push(`img/${f}`));
      } else {
        fs.readdirSync(path.join(contentsDir, e.name))
          .filter(f => f.endsWith('.md'))
          .forEach(f => results.push(`${e.name}/${f}`));
      }
    }
  }
  return results;
}

async function run() {
  if (!driveClient.isConfigured()) {
    return 'Google Drive 연동 미설정 — 백업 건너뜀';
  }

  const relPaths = collectFiles(CONTENTS_DIR);
  let uploaded = 0, failed = 0, totalBytes = 0;

  for (const relPath of relPaths) {
    try {
      const buffer = fs.readFileSync(path.join(CONTENTS_DIR, relPath));
      await driveClient.uploadOrUpdateFile(relPath, buffer, mimeFor(relPath));
      totalBytes += buffer.length;
      uploaded++;
    } catch (e) {
      console.error(`[mdboard-drive-backup] ✗ ${relPath}: ${e.message}`);
      failed++;
    }
  }

  const summary = `백업 완료: ${uploaded}개 파일 (${Math.round(totalBytes / 1024)}KB)${failed ? `, 실패 ${failed}개` : ''}`;
  if (failed > 0 && uploaded === 0) throw new Error(summary);
  return summary;
}

module.exports = {
  id: 'mdboard-drive-backup',
  name: 'mdboard → Google Drive 백업',
  schedule: '0 3 1 * *', // 매월 1일 03:00
  description: 'Railway 볼륨에 저장된 mdboard 콘텐츠(md/html/이미지)를 Google Drive로 월 1회 백업합니다.',
  run,
};
