/**
 * scripts/migrate.js
 * - 직접 실행: node scripts/migrate.js
 * - 모듈로 사용: require('./scripts/migrate').run(pool)
 * CREATE TABLE IF NOT EXISTS 이므로 반복 실행해도 데이터 보존
 */

const SQL = `
/* ── portfolio ─────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS portfolio_pages (
  id          VARCHAR(100) PRIMARY KEY,
  person      VARCHAR(100) NOT NULL,
  num         INTEGER      NOT NULL,
  template    VARCHAR(100) NOT NULL DEFAULT 'profile',
  status      VARCHAR(50)  NOT NULL DEFAULT 'draft',
  contents    JSONB        NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

/* ── campchecklist ─────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS camp_users (
  id          VARCHAR(100) PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  color       VARCHAR(20)  NOT NULL DEFAULT '#4a7c59',
  created_at  TIMESTAMPTZ,
  created_by  JSONB
);

CREATE TABLE IF NOT EXISTS camp_accounts (
  user_id       VARCHAR(100) PRIMARY KEY REFERENCES camp_users(id) ON DELETE CASCADE,
  login_id      VARCHAR(100) UNIQUE NOT NULL,
  pw_hash       VARCHAR(200) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'member',
  created_at    TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS camp_items (
  id          VARCHAR(100) PRIMARY KEY,
  user_id     VARCHAR(100) NOT NULL REFERENCES camp_users(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  category    VARCHAR(100) NOT NULL DEFAULT '기타',
  quantity    INTEGER      NOT NULL DEFAULT 1,
  unit        VARCHAR(50)  NOT NULL DEFAULT '개',
  note        TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ,
  created_by  JSONB,
  updated_by  JSONB
);

CREATE TABLE IF NOT EXISTS camp_trips (
  id           VARCHAR(100) PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  start_date   VARCHAR(20),
  end_date     VARCHAR(20),
  location     VARCHAR(200) NOT NULL DEFAULT '',
  note         TEXT         NOT NULL DEFAULT '',
  participants JSONB        NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ,
  created_by   JSONB,
  history      JSONB        NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS camp_checks (
  trip_id  VARCHAR(100) NOT NULL,
  user_id  VARCHAR(100) NOT NULL,
  item_id  VARCHAR(100) NOT NULL,
  planned  BOOLEAN      NOT NULL DEFAULT FALSE,
  packed   BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (trip_id, user_id, item_id)
);

CREATE TABLE IF NOT EXISTS camp_comments (
  id          VARCHAR(100) PRIMARY KEY,
  trip_id     VARCHAR(100) NOT NULL,
  parent_id   VARCHAR(100),
  depth       INTEGER      NOT NULL DEFAULT 0,
  author_id   VARCHAR(100) NOT NULL,
  author_name VARCHAR(200) NOT NULL,
  content     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ,
  edited      BOOLEAN      NOT NULL DEFAULT FALSE
);

/* ── floorplan ─────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS floorplan_templates (
  id           VARCHAR(200) PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  data         JSONB        NOT NULL,
  modified_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS floorplan_categories (
  id         VARCHAR(100) PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  items      JSONB        NOT NULL DEFAULT '[]',
  sort_order INTEGER      NOT NULL DEFAULT 0
);

/* ── travellog ─────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS travel_trips (
  id         VARCHAR(100) PRIMARY KEY,
  start_date VARCHAR(20),
  status     VARCHAR(50)  NOT NULL DEFAULT 'planned',
  data       JSONB        NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_schedules (
  id           VARCHAR(100) PRIMARY KEY,
  trip_id      VARCHAR(100) NOT NULL,
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  scheduled_at VARCHAR(30),
  data         JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_records (
  id          VARCHAR(100) PRIMARY KEY,
  trip_id     VARCHAR(100) NOT NULL,
  record_date VARCHAR(20),
  data        JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_photos (
  file_id     VARCHAR(200) PRIMARY KEY,
  trip_id     VARCHAR(100),
  data        JSONB        NOT NULL DEFAULT '{}',
  uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
`;

async function run(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SQL);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// 직접 실행 시
if (require.main === module) {
  require('dotenv').config();
  const pool = require('../shared/db');
  run(pool)
    .then(() => { console.log('Migration complete.'); process.exit(0); })
    .catch(e => { console.error('Migration failed:', e.message); process.exit(1); })
    .finally(() => pool.end());
}

module.exports = { run };
