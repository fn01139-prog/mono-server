/**
 * drive.js - Google Drive API 래퍼
 * 서비스 계정 인증 방식 사용
 * 환경변수: GOOGLE_SERVICE_ACCOUNT (base64 인코딩된 서비스 계정 JSON)
 *           DRIVE_FOLDER_ID (monoserver 폴더 ID: 1j_7SsCgqfwA6WQZBpw-LzExXWDoJwRpb)
 */
const { google } = require('googleapis');
const { Readable } = require('stream');

const FOLDER_ID = process.env.DRIVE_FOLDER_ID;

// Drive 클라이언트 싱글턴
let _drive = null;

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT 환경변수가 없습니다');
  const credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

async function getDrive() {
  if (_drive) return _drive;
  const auth = getAuth();
  _drive = google.drive({ version: 'v3', auth });
  return _drive;
}

/** Drive 폴더에서 파일 검색 */
async function findFile(fileName, folderId) {
  const drive = await getDrive();
  const parentId = folderId || FOLDER_ID;
  const res = await drive.files.list({
    q: `name='${fileName}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  return res.data.files[0] || null;
}

/** Drive에서 JSON 파일 읽기 */
async function readJson(fileName) {
  try {
    const drive = await getDrive();
    const file = await findFile(fileName);
    if (!file) return [];
    const res = await drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'text' }
    );
    return JSON.parse(res.data);
  } catch (e) {
    console.error(`Drive readJson 오류 (${fileName}):`, e.message);
    return [];
  }
}

/** Drive에 JSON 파일 쓰기 (없으면 생성, 있으면 업데이트) */
async function writeJson(fileName, data) {
  const drive = await getDrive();
  const content = JSON.stringify(data, null, 2);
  const media = {
    mimeType: 'application/json',
    body: Readable.from([content]),
  };
  const file = await findFile(fileName);
  if (file) {
    await drive.files.update({ fileId: file.id, media });
  } else {
    await drive.files.create({
      requestBody: { name: fileName, parents: [FOLDER_ID] },
      media,
      fields: 'id',
    });
  }
}

/** Drive에 사진 업로드 */
async function uploadPhoto(fileName, buffer, mimeType, folderId) {
  const drive = await getDrive();
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId || FOLDER_ID] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name',
  });
  // 썸네일 접근을 위해 공개 권한 부여
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  return {
    fileId: res.data.id,
    fileName: res.data.name,
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${res.data.id}&sz=w300`,
    viewUrl: `https://drive.google.com/file/d/${res.data.id}/view`,
  };
}

/** 폴더 생성 (이미 있으면 기존 ID 반환) */
async function getOrCreateFolder(name, parentId) {
  const drive = await getDrive();
  const pid = parentId || FOLDER_ID;
  const res = await drive.files.list({
    q: `name='${name}' and '${pid}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [pid],
    },
    fields: 'id',
  });
  return folder.data.id;
}

module.exports = { readJson, writeJson, uploadPhoto, getOrCreateFolder };
