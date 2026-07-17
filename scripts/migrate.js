/**
 * scripts/migrate.js
 * - 직접 실행: node scripts/migrate.js
 * - 모듈로 사용: require('./scripts/migrate').run(pool)
 * CREATE TABLE IF NOT EXISTS 이므로 반복 실행해도 데이터 보존
 */

const SQL = `
/* ── platform (통합 인증) ──────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS platform_users (
  id          VARCHAR(100) PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  color       VARCHAR(20)  NOT NULL DEFAULT '#4a9eff',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_accounts (
  user_id       VARCHAR(100) PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  login_id      VARCHAR(100) UNIQUE NOT NULL,
  pw_hash       VARCHAR(200) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'member',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform_app_grants (
  user_id     VARCHAR(100) NOT NULL,
  app_prefix  VARCHAR(100) NOT NULL,
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  granted_by  VARCHAR(100),
  PRIMARY KEY (user_id, app_prefix)
);

/* ── portfolio ─────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS portfolio_pages (
  id          VARCHAR(100) PRIMARY KEY,
  person      VARCHAR(100) NOT NULL,
  num         INTEGER      NOT NULL,
  template    VARCHAR(100) NOT NULL DEFAULT 'profile',
  status      VARCHAR(50)  NOT NULL DEFAULT 'draft',
  contents    JSONB        NOT NULL DEFAULT '[]',
  owner_id    VARCHAR(100) REFERENCES platform_users(id),
  is_public   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE portfolio_pages ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
ALTER TABLE portfolio_pages ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_portfolio_owner ON portfolio_pages(owner_id);

/* ── mdboard (파일별 소유/공유 권한) ──────────────────────────────────── */
CREATE TABLE IF NOT EXISTS mdboard_files (
  id          SERIAL       PRIMARY KEY,
  file_path   VARCHAR(500) UNIQUE NOT NULL,
  file_type   VARCHAR(10)  NOT NULL DEFAULT 'md',
  owner_id    VARCHAR(100) NOT NULL REFERENCES platform_users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mdboard_files_owner ON mdboard_files(owner_id);

CREATE TABLE IF NOT EXISTS mdboard_file_grants (
  file_id     INTEGER      NOT NULL REFERENCES mdboard_files(id) ON DELETE CASCADE,
  user_id     VARCHAR(100) NOT NULL,
  permission  VARCHAR(10)  NOT NULL DEFAULT 'read',
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  granted_by  VARCHAR(100),
  PRIMARY KEY (file_id, user_id)
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
  owner_id     VARCHAR(100),
  created_at   TIMESTAMPTZ,
  created_by   JSONB,
  history      JSONB        NOT NULL DEFAULT '[]'
);
ALTER TABLE camp_trips ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);

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
  owner_id     VARCHAR(100),
  modified_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE floorplan_templates ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);

CREATE TABLE IF NOT EXISTS floorplan_categories (
  id         VARCHAR(100) PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  items      JSONB        NOT NULL DEFAULT '[]',
  sort_order INTEGER      NOT NULL DEFAULT 0,
  owner_id   VARCHAR(100)
);
ALTER TABLE floorplan_categories ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_floorplan_templates_owner  ON floorplan_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_floorplan_categories_owner ON floorplan_categories(owner_id);

/* ── travellog ─────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS travel_trips (
  id         VARCHAR(100) PRIMARY KEY,
  start_date VARCHAR(20),
  status     VARCHAR(50)  NOT NULL DEFAULT 'planned',
  data       JSONB        NOT NULL DEFAULT '{}',
  owner_id   VARCHAR(100),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE travel_trips ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_travel_trips_owner ON travel_trips(owner_id);

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

/* ── mindmap (구 테이블명 → 표준 명칭으로 RENAME, 없으면 신규 생성) ──────── */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mindmap_board')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mindmap_boards') THEN
    ALTER TABLE mindmap_board RENAME TO mindmap_boards;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'object_header')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mindmap_objects') THEN
    ALTER TABLE object_header RENAME TO mindmap_objects;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'object_detail')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mindmap_object_details') THEN
    ALTER TABLE object_detail RENAME TO mindmap_object_details;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'relation')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mindmap_relations') THEN
    ALTER TABLE relation RENAME TO mindmap_relations;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'object_memo')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mindmap_memos') THEN
    ALTER TABLE object_memo RENAME TO mindmap_memos;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mindmap_boards (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  owner_id    VARCHAR(100),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE mindmap_boards ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_mindmap_boards_owner ON mindmap_boards(owner_id);

CREATE TABLE IF NOT EXISTS mindmap_objects (
  id          SERIAL PRIMARY KEY,
  board_id    INTEGER NOT NULL REFERENCES mindmap_boards(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  content     TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mindmap_object_details (
  id          SERIAL PRIMARY KEY,
  object_id   INTEGER NOT NULL UNIQUE REFERENCES mindmap_objects(id) ON DELETE CASCADE,
  pos_x       NUMERIC NOT NULL DEFAULT 0,
  pos_y       NUMERIC NOT NULL DEFAULT 0,
  color       VARCHAR(20) NOT NULL DEFAULT '#F2A93B',
  width       NUMERIC NOT NULL DEFAULT 140,
  height      NUMERIC NOT NULL DEFAULT 60,
  shape       VARCHAR(20) NOT NULL DEFAULT 'rounded-rect',
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mindmap_relations (
  id          SERIAL PRIMARY KEY,
  board_id    INTEGER NOT NULL REFERENCES mindmap_boards(id) ON DELETE CASCADE,
  parent_id   INTEGER NOT NULL REFERENCES mindmap_objects(id) ON DELETE CASCADE,
  child_id    INTEGER NOT NULL REFERENCES mindmap_objects(id) ON DELETE CASCADE,
  label       VARCHAR(100),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (parent_id, child_id),
  CHECK (parent_id <> child_id)
);

CREATE TABLE IF NOT EXISTS mindmap_memos (
  id          SERIAL PRIMARY KEY,
  object_id   INTEGER NOT NULL REFERENCES mindmap_objects(id) ON DELETE CASCADE,
  memo_type   VARCHAR(50) NOT NULL DEFAULT 'note',
  memo_text   TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mindmap_objects_board   ON mindmap_objects(board_id);
CREATE INDEX IF NOT EXISTS idx_mindmap_relations_board  ON mindmap_relations(board_id);
CREATE INDEX IF NOT EXISTS idx_mindmap_relations_parent ON mindmap_relations(parent_id);
CREATE INDEX IF NOT EXISTS idx_mindmap_relations_child  ON mindmap_relations(child_id);
CREATE INDEX IF NOT EXISTS idx_mindmap_memos_object     ON mindmap_memos(object_id);
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
