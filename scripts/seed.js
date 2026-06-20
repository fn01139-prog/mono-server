/**
 * scripts/seed.js
 * 기존 JSON 파일 데이터를 PostgreSQL로 이관
 * Run: node scripts/seed.js
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('../shared/db');

function readJson(filePath, fallback = []) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

async function seedPortfolio(client) {
  const pagesFile = path.join(__dirname, '../projects/portfolio/data/pages.json');
  const pages = readJson(pagesFile);
  console.log(`[portfolio] ${pages.length}개 페이지 이관 중...`);
  for (const p of pages) {
    await client.query(
      `INSERT INTO portfolio_pages (id, person, num, template, status, contents)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.person, p.num, p.template || 'profile', p.status || 'draft', JSON.stringify(p.contents || [])]
    );
  }
  console.log(`[portfolio] 완료`);
}

async function seedCampchecklist(client) {
  const dir = path.join(__dirname, '../projects/campchecklist/data');

  const users    = readJson(path.join(dir, 'users.json'));
  const accounts = readJson(path.join(dir, 'accounts.json'));
  const items    = readJson(path.join(dir, 'items.json'));
  const trips    = readJson(path.join(dir, 'trips.json'));
  const checks   = readJson(path.join(dir, 'checks.json'), {});
  const comments = readJson(path.join(dir, 'comments.json'));

  console.log(`[campchecklist] users:${users.length} accounts:${accounts.length} items:${items.length} trips:${trips.length} comments:${comments.length}`);

  for (const u of users) {
    await client.query(
      `INSERT INTO camp_users (id, name, color, created_at, created_by)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name, u.color || '#4a7c59', u.createdAt || new Date().toISOString(),
       u.createdBy ? JSON.stringify(u.createdBy) : null]
    );
  }

  for (const a of accounts) {
    await client.query(
      `INSERT INTO camp_accounts (user_id, login_id, pw_hash, role, created_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO NOTHING`,
      [a.userId, a.loginId, a.pwHash, a.role || 'member', a.createdAt, a.lastLoginAt || null]
    );
  }

  for (const i of items) {
    await client.query(
      `INSERT INTO camp_items (id, user_id, name, category, quantity, unit, note, created_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [i.id, i.userId, i.name, i.category || '기타', i.quantity || 1, i.unit || '개', i.note || '',
       i.createdAt, i.createdBy ? JSON.stringify(i.createdBy) : null, i.updatedBy ? JSON.stringify(i.updatedBy) : null]
    );
  }

  for (const t of trips) {
    await client.query(
      `INSERT INTO camp_trips (id, name, start_date, end_date, location, note, participants, created_at, created_by, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.name, t.startDate, t.endDate || t.startDate, t.location || '', t.note || '',
       JSON.stringify(t.participants || []), t.createdAt, JSON.stringify(t.createdBy || null), JSON.stringify(t.history || [])]
    );
  }

  // checks: { tripId: { userId: { itemId: { planned, packed } } } }
  for (const [tripId, userMap] of Object.entries(checks)) {
    for (const [userId, itemMap] of Object.entries(userMap)) {
      for (const [itemId, val] of Object.entries(itemMap)) {
        await client.query(
          `INSERT INTO camp_checks (trip_id, user_id, item_id, planned, packed)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (trip_id, user_id, item_id) DO NOTHING`,
          [tripId, userId, itemId, Boolean(val.planned), Boolean(val.packed)]
        );
      }
    }
  }

  for (const c of comments) {
    await client.query(
      `INSERT INTO camp_comments (id, trip_id, parent_id, depth, author_id, author_name, content, created_at, updated_at, edited)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.tripId, c.parentId || null, c.depth || 0, c.authorId, c.authorName, c.content,
       c.createdAt, c.updatedAt, c.edited || false]
    );
  }

  console.log(`[campchecklist] 완료`);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedPortfolio(client);
    await seedCampchecklist(client);
    await client.query('COMMIT');
    console.log('\n시딩 완료!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('시딩 실패:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
