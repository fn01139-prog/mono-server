/**
 * scripts/migrate-auth.js
 * 플랫폼 인증 데이터 부트스트랩 + 마이그레이션 (멱등 — 반복 실행 안전)
 *
 * - 직접 실행: node scripts/migrate-auth.js
 * - 모듈로 사용: require('./scripts/migrate-auth').run(pool)
 *
 * 하는 일:
 *  1. platform_accounts가 비어 있으면 PLATFORM_ADMIN_ID/PLATFORM_ADMIN_PW로 admin 계정 자동 생성
 *  2. camp_users/camp_accounts → platform_users/platform_accounts 데이터 복사 (미복사분만)
 *  3. 복사된 사용자 전원에게 /campchecklist 권한 부여
 *  4. camp_trips.owner_id NULL인 행을 created_by JSONB에서 추출해 백필
 *  5. owner_id가 NULL인 기존 데이터(portfolio/floorplan/travellog/mindmap)를 admin 소유로 백필
 *  6. mdboard 레거시 파일(파일시스템에는 있으나 mdboard_files 레지스트리에 없는 파일)을 admin 소유로 등록
 *  7. camp_items.user_id FK를 camp_users(id) → platform_users(id)로 재지정
 *     (campchecklist 로그인이 platform 계정을 쓰게 되면서, camp_users에 없는 신규 platform
 *     사용자가 품목을 등록하면 기존 FK가 위반됨 — id가 1:1로 보존되므로 안전하게 재지정 가능)
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PLATFORM_ADMIN_ID = process.env.PLATFORM_ADMIN_ID || process.env.CAMP_ADMIN_ID || 'admin';
const PLATFORM_ADMIN_PW = process.env.PLATFORM_ADMIN_PW || 'admin1234';

async function ensureAdmin(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS c FROM platform_accounts');
  if (rows[0].c > 0) return;

  const userId = crypto.randomUUID();
  const pwHash = await bcrypt.hash(PLATFORM_ADMIN_PW, 10);
  await client.query(
    'INSERT INTO platform_users (id, name, color) VALUES ($1, $2, $3)',
    [userId, 'Admin', '#4a9eff']
  );
  await client.query(
    `INSERT INTO platform_accounts (user_id, login_id, pw_hash, role)
     VALUES ($1, $2, $3, 'admin')`,
    [userId, PLATFORM_ADMIN_ID, pwHash]
  );
  console.log(`[migrate-auth] ⚠ admin 계정 자동 생성됨 — loginId: ${PLATFORM_ADMIN_ID} / pw: ${PLATFORM_ADMIN_PW} (반드시 로그인 후 비밀번호를 변경하세요)`);
}

async function getAdminUserId(client) {
  const { rows } = await client.query(
    "SELECT user_id FROM platform_accounts WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
  );
  return rows[0]?.user_id || null;
}

async function migrateCampAccounts(client) {
  const { rows: campTablesExist } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'camp_accounts'"
  );
  if (!campTablesExist.length) return;

  const { rows: campUsers } = await client.query('SELECT * FROM camp_users');
  const { rows: campAccounts } = await client.query('SELECT * FROM camp_accounts');

  for (const acc of campAccounts) {
    const { rows: exists } = await client.query(
      'SELECT 1 FROM platform_accounts WHERE user_id = $1 OR login_id = $2',
      [acc.user_id, acc.login_id]
    );
    if (exists.length) continue;

    const user = campUsers.find(u => u.id === acc.user_id);
    if (!user) continue;

    const { rows: userExists } = await client.query('SELECT 1 FROM platform_users WHERE id = $1', [user.id]);
    if (!userExists.length) {
      await client.query(
        'INSERT INTO platform_users (id, name, color, created_at) VALUES ($1, $2, $3, COALESCE($4, NOW()))',
        [user.id, user.name, user.color, user.created_at]
      );
    }

    await client.query(
      `INSERT INTO platform_accounts (user_id, login_id, pw_hash, role, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), $6)`,
      [acc.user_id, acc.login_id, acc.pw_hash, acc.role, acc.created_at, acc.last_login_at]
    );

    await client.query(
      `INSERT INTO platform_app_grants (user_id, app_prefix)
       VALUES ($1, '/campchecklist') ON CONFLICT DO NOTHING`,
      [acc.user_id]
    );

    console.log(`[migrate-auth] camp 계정 이관: ${acc.login_id}`);
  }
}

async function backfillCampTripOwners(client) {
  const { rows: tables } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'camp_trips'"
  );
  if (!tables.length) return;

  const { rows: trips } = await client.query(
    'SELECT id, created_by FROM camp_trips WHERE owner_id IS NULL'
  );
  const adminId = await getAdminUserId(client);
  for (const trip of trips) {
    const ownerId = trip.created_by?.userId || adminId;
    if (!ownerId) continue;
    await client.query('UPDATE camp_trips SET owner_id = $1 WHERE id = $2', [ownerId, trip.id]);
  }
  if (trips.length) console.log(`[migrate-auth] camp_trips.owner_id 백필: ${trips.length}건`);
}

async function backfillOwner(client, table) {
  const { rows: tables } = await client.query(
    'SELECT 1 FROM information_schema.tables WHERE table_name = $1', [table]
  );
  if (!tables.length) return;

  const adminId = await getAdminUserId(client);
  if (!adminId) return;

  const { rowCount } = await client.query(
    `UPDATE ${table} SET owner_id = $1 WHERE owner_id IS NULL`, [adminId]
  );
  if (rowCount) console.log(`[migrate-auth] ${table}.owner_id 백필 (admin 귀속): ${rowCount}건`);
}

function collectMdFiles(dir, baseDir, results) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'img') continue;
      collectMdFiles(full, baseDir, results);
    } else if (entry.isFile() && /\.(md|html?|htm)$/i.test(entry.name)) {
      const rel = path.relative(baseDir, full).split(path.sep).join('/');
      results.push({
        filePath: rel,
        fileType: /\.md$/i.test(entry.name) ? 'md' : 'html',
      });
    }
  }
}

async function backfillMdboardFiles(client) {
  const contentsDir = path.join(__dirname, '../projects/mdboard/public/contents');
  if (!fs.existsSync(contentsDir)) return;

  const adminId = await getAdminUserId(client);
  if (!adminId) return;

  const files = [];
  collectMdFiles(contentsDir, contentsDir, files);

  let inserted = 0;
  for (const f of files) {
    const { rows } = await client.query(
      'SELECT 1 FROM mdboard_files WHERE file_path = $1', [f.filePath]
    );
    if (rows.length) continue;
    await client.query(
      'INSERT INTO mdboard_files (file_path, file_type, owner_id) VALUES ($1, $2, $3)',
      [f.filePath, f.fileType, adminId]
    );
    inserted++;
  }
  if (inserted) console.log(`[migrate-auth] mdboard 레거시 파일 등록 (admin 소유): ${inserted}건`);
}

async function repointCampItemsFK(client) {
  const { rows } = await client.query(`
    SELECT 1 FROM pg_constraint
    WHERE conname = 'camp_items_user_id_fkey'
      AND confrelid = 'camp_users'::regclass
  `);
  if (!rows.length) return; // 이미 재지정되었거나 camp_users가 없음

  await client.query('ALTER TABLE camp_items DROP CONSTRAINT camp_items_user_id_fkey');
  await client.query(`
    ALTER TABLE camp_items
    ADD CONSTRAINT camp_items_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES platform_users(id) ON DELETE CASCADE
  `);
  console.log('[migrate-auth] camp_items.user_id FK를 platform_users로 재지정함');
}

/** notify_recipients가 비어있으면 relation='self' 수신자 1명을 자동 생성 (알림 채널을 여기 연결) */
async function ensureSelfRecipient(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS c FROM notify_recipients');
  if (rows[0].c > 0) return;

  await client.query(
    `INSERT INTO notify_recipients (name, relation) VALUES ($1, 'self')`,
    [PLATFORM_ADMIN_ID]
  );
  console.log(`[migrate-auth] notify_recipients 'self' 수신자 자동 생성됨 (name: ${PLATFORM_ADMIN_ID}) — admin 콘솔 알림 탭에서 텔레그램/디스코드 등 채널을 연결하세요`);
}

async function run(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureAdmin(client);
    await ensureSelfRecipient(client);
    await migrateCampAccounts(client);
    await repointCampItemsFK(client);
    await backfillCampTripOwners(client);
    await backfillOwner(client, 'portfolio_pages');
    await backfillOwner(client, 'floorplan_templates');
    await backfillOwner(client, 'floorplan_categories');
    await backfillOwner(client, 'travel_trips');
    await backfillOwner(client, 'mindmap_boards');
    await client.query('COMMIT');

    // 파일시스템 스캔은 트랜잭션 밖에서 (오래 걸릴 수 있음)
    await backfillMdboardFiles(client);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  require('dotenv').config();
  const pool = require('../shared/db');
  run(pool)
    .then(() => { console.log('[migrate-auth] complete.'); process.exit(0); })
    .catch(e => { console.error('[migrate-auth] failed:', e); process.exit(1); })
    .finally(() => pool.end());
}

module.exports = { run };
