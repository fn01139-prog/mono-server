/**
 * projects/mdboard/permissions.js
 * 파일별 소유/공유 권한 관리 (mdboard_files, mdboard_file_grants)
 *
 * 파일 자체는 파일시스템에 그대로 유지하고, 어떤 로그인 사용자가 그 파일을
 * 조회/수정할 수 있는지만 DB로 관리한다. 레지스트리에 없는 파일(수동 배치 등)은
 * 발견 시 admin 소유로 자동 등록한다(self-healing).
 */
const pool = require('../../shared/db');

const isAdmin = (req) => req.user?.role === 'admin';

let adminIdCache = null;
async function getAdminUserId() {
  if (adminIdCache) return adminIdCache;
  const { rows } = await pool.query(
    "SELECT user_id FROM platform_accounts WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
  );
  adminIdCache = rows[0]?.user_id || null;
  return adminIdCache;
}

/** filePath 레지스트리 행을 가져오고, 없으면 admin 소유로 자동 등록 */
async function ensureRegistered(filePath, fileType) {
  const { rows } = await pool.query('SELECT * FROM mdboard_files WHERE file_path = $1', [filePath]);
  if (rows.length) return rows[0];

  const adminId = await getAdminUserId();
  if (!adminId) return null; // admin 부트스트랩 전이면 등록 보류

  const { rows: inserted } = await pool.query(
    `INSERT INTO mdboard_files (file_path, file_type, owner_id) VALUES ($1, $2, $3)
     ON CONFLICT (file_path) DO UPDATE SET file_path = EXCLUDED.file_path
     RETURNING *`,
    [filePath, fileType, adminId]
  );
  return inserted[0];
}

/** 신규 파일 등록 (저장/업로드 시 owner = 요청자) */
async function registerNew(filePath, fileType, ownerId) {
  await pool.query(
    `INSERT INTO mdboard_files (file_path, file_type, owner_id) VALUES ($1, $2, $3)
     ON CONFLICT (file_path) DO NOTHING`,
    [filePath, fileType, ownerId]
  );
}

/** read 이상 권한 여부 (소유자, admin, 또는 grants에 본인/'*' 존재) */
async function canRead(req, filePath) {
  if (isAdmin(req)) return true;
  const row = await ensureRegistered(filePath, filePath.endsWith('.md') ? 'md' : 'html');
  if (!row) return false;
  if (row.owner_id === req.user.userId) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM mdboard_file_grants WHERE file_id = $1 AND user_id IN ($2, '*') LIMIT 1`,
    [row.id, req.user.userId]
  );
  return rows.length > 0;
}

/** write 권한 여부 (소유자, admin, 또는 write grant) */
async function canWrite(req, filePath) {
  if (isAdmin(req)) return true;
  const row = await ensureRegistered(filePath, filePath.endsWith('.md') ? 'md' : 'html');
  if (!row) return false;
  if (row.owner_id === req.user.userId) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM mdboard_file_grants WHERE file_id = $1 AND user_id IN ($2, '*') AND permission = 'write' LIMIT 1`,
    [row.id, req.user.userId]
  );
  return rows.length > 0;
}

/** 이 사용자가 조회 가능한 file_path 전체 집합 (admin이면 null = 전체 허용) */
async function readableFilePaths(req) {
  if (isAdmin(req)) return null;
  const { rows } = await pool.query(
    `SELECT f.file_path FROM mdboard_files f
     WHERE f.owner_id = $1
        OR EXISTS (
          SELECT 1 FROM mdboard_file_grants g
          WHERE g.file_id = f.id AND g.user_id IN ($1, '*')
        )`,
    [req.user.userId]
  );
  return new Set(rows.map(r => r.file_path));
}

async function renamePath(oldPath, newPath) {
  await pool.query('UPDATE mdboard_files SET file_path = $2, updated_at = NOW() WHERE file_path = $1', [oldPath, newPath]);
}

async function deletePath(filePath) {
  await pool.query('DELETE FROM mdboard_files WHERE file_path = $1', [filePath]);
}

/** 파일 공유 설정 — 소유자/admin만 호출 가능 (라우트에서 canWrite 등으로 사전 검사) */
async function setGrants(filePath, grants, grantedBy) {
  const row = await ensureRegistered(filePath, filePath.endsWith('.md') ? 'md' : 'html');
  if (!row) throw new Error('파일이 등록되어 있지 않습니다');
  await pool.query('DELETE FROM mdboard_file_grants WHERE file_id = $1', [row.id]);
  for (const g of grants) {
    await pool.query(
      `INSERT INTO mdboard_file_grants (file_id, user_id, permission, granted_by) VALUES ($1, $2, $3, $4)`,
      [row.id, g.userId, g.permission === 'write' ? 'write' : 'read', grantedBy]
    );
  }
}

async function getGrants(filePath) {
  const { rows: fileRows } = await pool.query('SELECT id, owner_id FROM mdboard_files WHERE file_path = $1', [filePath]);
  if (!fileRows.length) return { ownerId: null, grants: [] };
  const { rows } = await pool.query(
    `SELECT g.user_id, g.permission, u.name FROM mdboard_file_grants g
     LEFT JOIN platform_users u ON u.id = g.user_id
     WHERE g.file_id = $1`,
    [fileRows[0].id]
  );
  return { ownerId: fileRows[0].owner_id, grants: rows.map(r => ({ userId: r.user_id, name: r.name || (r.user_id === '*' ? '전체' : r.user_id), permission: r.permission })) };
}

module.exports = {
  ensureRegistered, registerNew, canRead, canWrite, readableFilePaths,
  renamePath, deletePath, setGrants, getGrants, getAdminUserId,
};
