/**
 * scripts/mdboard-drive-migrate.js
 * mdboard가 예전에 Google Drive에 백업해둔 콘텐츠를 Railway 볼륨 경로
 * (paths.js → /data/contents/mdboard 또는 MDBOARD_CONTENTS_DIR)로 1회 이관한다.
 *
 * 실행 후에는 볼륨이 콘텐츠의 상시 저장소가 되고, Drive는
 * core/jobs/mdboard-drive-backup.js(월 1회)가 다시 채워나간다.
 *
 * Run: node scripts/mdboard-drive-migrate.js
 *
 * 필요 환경변수: GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, MDBOARD_FOLDER_ID
 * (배포 서버에서 실행할 땐 볼륨이 마운트된 그 컨테이너에서 실행해야 한다 — 로컬에서 돌리면
 *  로컬 디스크의 MDBOARD_CONTENTS_DIR로 받게 되므로 필요 시 그 값을 별도로 지정할 것)
 */
'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const driveClient = require('../projects/mdboard/driveClient');
const { CONTENTS_DIR } = require('../projects/mdboard/paths');

// 레거시 drive.js가 백업하던 대상 확장자 (md/html) — 이미지 등은 애초에 Drive에 없었음
const TEXT_EXT = /\.(md|html?)$/i;

function decodeRelPath(driveName) {
  // 레거시 인코딩: 'folder/file.md' 형태로 Drive 파일명에 '/'를 그대로 사용
  const parts = driveName.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null; // mdboard는 최대 2단계까지만 허용
  if (parts.length === 2 && parts[0] === 'img') return null; // img/ 서브경로는 취급하지 않음
  return parts;
}

async function main() {
  if (!driveClient.isConfigured()) {
    console.error('Google Drive 연동 환경변수(GDRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN, MDBOARD_FOLDER_ID)가 설정되지 않았습니다.');
    process.exit(1);
  }

  console.log(`[mdboard-migrate] 대상 경로: ${CONTENTS_DIR}`);
  fs.mkdirSync(CONTENTS_DIR, { recursive: true });

  console.log('[mdboard-migrate] Drive 파일 목록 조회 중...');
  const files = await driveClient.listAllFiles();
  const targets = files.filter(f => TEXT_EXT.test(f.name));
  console.log(`[mdboard-migrate] 대상 파일 ${targets.length}개 / 전체 ${files.length}개`);

  let migrated = 0, skipped = 0, failed = 0;
  for (const file of targets) {
    const parts = decodeRelPath(file.name);
    if (!parts) {
      console.warn(`  ⚠️  건너뜀 (경로 형식 불일치): ${file.name}`);
      skipped++;
      continue;
    }
    const localPath = path.join(CONTENTS_DIR, ...parts);
    try {
      const buffer = await driveClient.downloadFile(file.id);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, buffer);
      console.log(`  ✓ ${file.name} → ${path.relative(CONTENTS_DIR, localPath)}`);
      migrated++;
    } catch (e) {
      console.error(`  ✗ ${file.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n[mdboard-migrate] 완료 — 이관 ${migrated}개, 건너뜀 ${skipped}개, 실패 ${failed}개`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => {
  console.error('[mdboard-migrate] 실패:', e.message);
  process.exit(1);
});
