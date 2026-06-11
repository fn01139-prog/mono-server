const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');
const config = require('../config');

let _drive = null;

function getDrive() {
  if (_drive) return _drive;
  try {
    const keyPath = path.resolve(config.googleServiceAccountKey);
    if (!fs.existsSync(keyPath)) {
      console.warn('[GDrive] 서비스 계정 키 파일 없음:', keyPath);
      return null;
    }
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    _drive = google.drive({ version: 'v3', auth });
    console.log('[GDrive] Google Drive 연결됨');
    return _drive;
  } catch (e) {
    console.warn('[GDrive] 초기화 실패:', e.message);
    return null;
  }
}

const FOLDER_ID = () => config.gdriveFolderId;

// ── 서브폴더 ID 캐시 ────────────────────────────────
const subFolderCache = {};

async function getOrCreateSubFolder(drive, name) {
  if (subFolderCache[name]) return subFolderCache[name];
  const res = await drive.files.list({
    q: `'${FOLDER_ID()}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });
  if (res.data.files.length > 0) {
    subFolderCache[name] = res.data.files[0].id;
    return subFolderCache[name];
  }
  const created = await drive.files.create({
    resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [FOLDER_ID()] },
    fields: 'id',
  });
  subFolderCache[name] = created.data.id;
  return subFolderCache[name];
}

// ── 파일 목록 ───────────────────────────────────────
async function listFiles(subFolder) {
  const drive = getDrive();
  if (!drive) throw new Error('GDrive 미연결');
  const folderId = await getOrCreateSubFolder(drive, subFolder);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
  });
  return res.data.files;
}

// ── 파일 읽기 ───────────────────────────────────────
async function readFile(fileId) {
  const drive = getDrive();
  if (!drive) throw new Error('GDrive 미연결');
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  return res.data;
}

// ── 파일 저장 (없으면 생성, 있으면 업데이트) ───────
async function saveFile(subFolder, fileName, content) {
  const drive = getDrive();
  if (!drive) throw new Error('GDrive 미연결');
  const folderId = await getOrCreateSubFolder(drive, subFolder);

  // 기존 파일 검색
  const existing = await drive.files.list({
    q: `'${folderId}' in parents and name='${fileName}' and trashed=false`,
    fields: 'files(id)',
  });

  const media = {
    mimeType: 'application/json',
    body: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  };

  if (existing.data.files.length > 0) {
    const fileId = existing.data.files[0].id;
    await drive.files.update({ fileId, media });
    return fileId;
  } else {
    const created = await drive.files.create({
      resource: { name: fileName, parents: [folderId] },
      media,
      fields: 'id',
    });
    return created.data.id;
  }
}

// ── 파일 삭제 ───────────────────────────────────────
async function deleteFile(fileId) {
  const drive = getDrive();
  if (!drive) throw new Error('GDrive 미연결');
  await drive.files.delete({ fileId });
}

module.exports = { getDrive, listFiles, readFile, saveFile, deleteFile };
