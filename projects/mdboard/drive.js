/**
 * projects/mdboard/drive.js
 * Google Drive 연동 — mdboard 콘텐츠 백업
 *
 * 환경변수:
 *   GDRIVE_CLIENT_ID       (CampChecklist와 공유)
 *   GDRIVE_CLIENT_SECRET   (CampChecklist와 공유)
 *   GDRIVE_REFRESH_TOKEN   (CampChecklist와 공유)
 *   MDBOARD_FOLDER_ID      mdboard 전용 Drive 폴더 ID
 *
 * Lazy Init 패턴:
 *   require() 시점에는 OAuth 클라이언트만 준비.
 *   실제 Drive 연결(pullAll)은 ensureInit() 호출 시 실행.
 *   → 서버 기동 즉시 healthcheck 응답 가능, Drive 지연이 전체 서버에 영향 없음.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CONTENTS_DIR = path.join(__dirname, 'public', 'contents');
const FOLDER_ID    = process.env.MDBOARD_FOLDER_ID;

let drive         = null;
const fileIdCache = {};

// ── OAuth2 클라이언트 초기화 ─────────────────────────────────────────
// 환경변수 4개가 모두 있을 때만 활성화
const _oauthReady = !!(
  process.env.GDRIVE_CLIENT_ID &&
  process.env.GDRIVE_CLIENT_SECRET &&
  process.env.GDRIVE_REFRESH_TOKEN &&
  FOLDER_ID
);

// top-level await 금지(CJS) → IIFE Promise로 감싸서 저장
let _driveReady = null;
if (_oauthReady) {
  _driveReady = (async () => {
    const { google } = require('googleapis');
    const oauth2 = new google.auth.OAuth2(
      process.env.GDRIVE_CLIENT_ID,
      process.env.GDRIVE_CLIENT_SECRET,
      'http://localhost'
    );
    oauth2.setCredentials({ refresh_token: process.env.GDRIVE_REFRESH_TOKEN });
    oauth2.on('tokens', () => console.log('[mdboard] 🔑 Drive 토큰 갱신됨'));
    drive = google.drive({ version: 'v3', auth: oauth2 });
    console.log('[mdboard] ✅ Google Drive 연동 활성화 (OAuth2)');
  })().catch(e => console.error('[mdboard] ❌ Drive 초기화 실패:', e.message));
}

// ── Drive 헬퍼 ───────────────────────────────────────────────────────
async function getFileId(filename) {
  if (fileIdCache[filename]) return fileIdCache[filename];
  const res = await drive.files.list({
    q: `name='${filename}' and '${FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  });
  const id = res.data.files[0]?.id ?? null;
  if (id) fileIdCache[filename] = id;
  return id;
}

// ── 저장/수정 시 즉시 Push ────────────────────────────────────────────
async function pushFile(filename, content) {
  if (!drive) return;
  try {
    const media  = { mimeType: 'text/markdown', body: content };
    const fileId = await getFileId(filename);
    if (fileId) {
      await drive.files.update({ fileId, media });
      console.log(`[mdboard] ☁️  업데이트: ${filename}`);
    } else {
      const res = await drive.files.create({
        requestBody: { name: filename, parents: [FOLDER_ID] },
        media,
        fields: 'id',
      });
      fileIdCache[filename] = res.data.id;
      console.log(`[mdboard] ☁️  생성: ${filename}`);
    }
  } catch (e) {
    console.error(`[mdboard] ☁️  Push 실패 (${filename}):`, e.message);
  }
}

// ── 삭제 시 Drive에서도 제거 ──────────────────────────────────────────
async function deleteFile(filename) {
  if (!drive) return;
  try {
    const fileId = await getFileId(filename);
    if (!fileId) return;
    await drive.files.delete({ fileId });
    delete fileIdCache[filename];
    console.log(`[mdboard] 🗑️  Drive 삭제: ${filename}`);
  } catch (e) {
    console.error(`[mdboard] 🗑️  Drive 삭제 실패 (${filename}):`, e.message);
  }
}

// ── 서버 재기동 시 Drive → 로컬 전체 복원 ────────────────────────────
async function pullAll() {
  if (!drive) return;
  console.log('[mdboard] 📥 Drive 복원 중...');
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });
    const files = (res.data.files || []).filter(f => /\.(md|html?)$/i.test(f.name));
    if (files.length === 0) {
      console.log('[mdboard] 📥 Drive에 복원할 파일 없음 (신규 시작)');
      return;
    }
    for (const file of files) {
      try {
        const dl = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'text' }
        );
        const content  = typeof dl.data === 'string' ? dl.data : JSON.stringify(dl.data);
        const localPath = path.join(CONTENTS_DIR, file.name);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, content, 'utf8');
        fileIdCache[file.name] = file.id;
        console.log(`[mdboard]   ✓ ${file.name}`);
      } catch (e) {
        console.error(`[mdboard]   ✗ ${file.name}:`, e.message);
      }
    }
    console.log(`[mdboard] 📥 복원 완료 (${files.length}개)`);
  } catch (e) {
    console.error('[mdboard] 📥 Drive 복원 실패:', e.message);
  }
}

// ── Lazy Init ─────────────────────────────────────────────────────────
// _initPromise:
//   null    → 아직 초기화 안 됨 (첫 파일 요청에서 시작)
//   Promise → 초기화 진행 중 또는 완료 (이후 요청은 즉시 통과)
let _initPromise = null;

function ensureInit() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (_driveReady) await _driveReady;
    await pullAll();
    console.log('[mdboard] 🏁 Drive 초기화 완료');
  })().catch(e => {
    console.error('[mdboard] 초기화 오류:', e.message);
    _initPromise = null; // 실패 시 다음 요청에서 재시도
  });
  return _initPromise;
}

module.exports = { ensureInit, pushFile, deleteFile, isEnabled: () => !!drive };
