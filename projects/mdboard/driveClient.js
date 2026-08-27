/**
 * projects/mdboard/driveClient.js
 * Google Drive 저장소 접근 — mdboard 콘텐츠 백업/마이그레이션 전용 저수준 클라이언트.
 *
 * mdboard 자체 요청 흐름(index.js)에서는 더 이상 사용하지 않는다 — 콘텐츠는 이제
 * Railway 볼륨(/data/contents/mdboard, paths.js 참고)에 상시 저장되고, Drive는
 * (1) scripts/mdboard-drive-migrate.js 로 기존 Drive 백업분을 볼륨으로 1회 이관,
 * (2) core/jobs/mdboard-drive-backup.js 로 볼륨 → Drive 월 1회 백업
 * 용도로만 쓰인다.
 *
 * 폴더 인코딩: Drive 파일명에 '/'를 그대로 사용해 하위 폴더 경로를 표현한다
 * (예: 'folder/file.md'). Google Drive는 파일명에 슬래시를 허용하며, 이 방식은
 * 기존(레거시) 연동이 이미 이 스킴으로 데이터를 저장해뒀기 때문에 그대로 유지한다.
 *
 * 환경변수:
 *   GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN  (campchecklist와 공유)
 *   MDBOARD_FOLDER_ID   mdboard 전용 Drive 폴더 ID
 */
'use strict';

const FOLDER_ID = process.env.MDBOARD_FOLDER_ID;

const _oauthReady = !!(
  process.env.GDRIVE_CLIENT_ID &&
  process.env.GDRIVE_CLIENT_SECRET &&
  process.env.GDRIVE_REFRESH_TOKEN &&
  FOLDER_ID
);

let _drive = null;
let _initPromise = null;

function isConfigured() {
  return _oauthReady;
}

async function getClient() {
  if (!_oauthReady) throw new Error('Google Drive 연동 환경변수가 설정되지 않았습니다.');
  if (_drive) return _drive;
  if (!_initPromise) {
    _initPromise = (async () => {
      const { google } = require('googleapis');
      const oauth2 = new google.auth.OAuth2(
        process.env.GDRIVE_CLIENT_ID,
        process.env.GDRIVE_CLIENT_SECRET,
        'http://localhost'
      );
      oauth2.setCredentials({ refresh_token: process.env.GDRIVE_REFRESH_TOKEN });
      _drive = google.drive({ version: 'v3', auth: oauth2 });
    })();
  }
  await _initPromise;
  return _drive;
}

/** 폴더 내 전체 파일 목록 (페이지네이션 포함) */
async function listAllFiles() {
  const drive = await getClient();
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      spaces: 'drive',
      pageSize: 1000,
      pageToken,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/** 파일 내용을 Buffer로 다운로드 (텍스트/바이너리 공용) */
async function downloadFile(fileId) {
  const drive = await getClient();
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

/** 이름으로 생성 또는 갱신 (같은 이름 파일이 이미 있으면 update) */
async function uploadOrUpdateFile(name, buffer, mimeType) {
  const drive = await getClient();
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  });
  const existingId = res.data.files[0]?.id ?? null;
  const media = { mimeType, body: require('stream').Readable.from(buffer) };
  if (existingId) {
    await drive.files.update({ fileId: existingId, media });
    return existingId;
  }
  const created = await drive.files.create({
    requestBody: { name, parents: [FOLDER_ID] },
    media,
    fields: 'id',
  });
  return created.data.id;
}

module.exports = { isConfigured, listAllFiles, downloadFile, uploadOrUpdateFile };
