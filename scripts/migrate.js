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

-- 모바일 앱 기기 기반 자동로그인: 계정당 활성 기기 1개 (새 기기에서 로그인하면 이전 값을 덮어써 자동 이관)
ALTER TABLE platform_accounts ADD COLUMN IF NOT EXISTS device_id VARCHAR(200);
ALTER TABLE platform_accounts ADD COLUMN IF NOT EXISTS device_bound_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_accounts_device_id
  ON platform_accounts(device_id) WHERE device_id IS NOT NULL;

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

/* ── totalprice (금/은 시세 캐시 — 비공식 외부 API 실패 시 폴백용 마지막 성공 응답)
 * 예전엔 로컬 파일(data/cache.json)에 저장했는데, Railway 같은 호스팅은 배포마다
 * 컨테이너가 새로 뜨는 임시 파일시스템이라 재배포 직후엔 캐시가 사라져 폴백이 무력화됐다 → DB로 이전.
 */
CREATE TABLE IF NOT EXISTS totalprice_gold_cache (
  cache_key       VARCHAR(50) PRIMARY KEY, -- 'type:startDate:endDate' 조회 조합별로 하나씩
  type            VARCHAR(10),
  data_date_start VARCHAR(20),
  data_date_end   VARCHAR(20),
  list            JSONB        NOT NULL,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

/* ── totalprice (주식 종목 마스터 목록 — code+name, 배치잡이 주기적으로 갱신) ── */
CREATE TABLE IF NOT EXISTS totalprice_stocks (
  code        VARCHAR(10)  PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  market      VARCHAR(10)  NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_totalprice_stocks_name ON totalprice_stocks(name);

/* ── totalprice (사용자별 AI 참고자료 알림 예약 — totalprice-alert-runner 배치잡이 소비) ── */
CREATE TABLE IF NOT EXISTS totalprice_alerts (
  id             SERIAL       PRIMARY KEY,
  user_id        VARCHAR(100) NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  api_key        VARCHAR(50)  NOT NULL DEFAULT 'stock-insight',
  code           VARCHAR(10)  NOT NULL,
  stock_name     VARCHAR(200),
  frequency      VARCHAR(20)  NOT NULL DEFAULT 'daily', -- 'daily' | 'hourly' | 'weekly'
  run_time       VARCHAR(5),                            -- 'HH:MM' (KST) — daily/weekly에서 사용
  run_minute     SMALLINT,                               -- 0~59 — hourly에서 사용(매시 이 분에 실행)
  run_weekday    SMALLINT,                               -- 0(일)~6(토) — weekly에서 사용
  notify_channel VARCHAR(20)  NOT NULL,                 -- 'telegram' | 'discord' | 'ntfy' | 'webpush'
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  last_run_at    TIMESTAMPTZ,
  last_run_bucket VARCHAR(20),                           -- 중복 실행 방지 키: daily/weekly='YYYY-MM-DD', hourly='YYYY-MM-DDTHH'
  last_status    VARCHAR(20),
  last_error     TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- 기존(daily만 지원하던 시절) 스키마에서 넘어오는 경우를 위한 보정
ALTER TABLE totalprice_alerts ALTER COLUMN run_time DROP NOT NULL;
ALTER TABLE totalprice_alerts ADD COLUMN IF NOT EXISTS run_minute SMALLINT;
ALTER TABLE totalprice_alerts ADD COLUMN IF NOT EXISTS run_weekday SMALLINT;
ALTER TABLE totalprice_alerts ADD COLUMN IF NOT EXISTS last_run_bucket VARCHAR(20);
ALTER TABLE totalprice_alerts DROP COLUMN IF EXISTS last_run_date;
CREATE INDEX IF NOT EXISTS idx_totalprice_alerts_user ON totalprice_alerts(user_id);

/* ── platform 공통 인프라: 메일 발송 / 배치잡 (core/batch.js, shared/mailer.js) ── */
CREATE TABLE IF NOT EXISTS platform_mail_log (
  id          SERIAL       PRIMARY KEY,
  to_addr     VARCHAR(300) NOT NULL,
  subject     VARCHAR(500) NOT NULL,
  status      VARCHAR(20)  NOT NULL,
  error       TEXT,
  app_prefix  VARCHAR(100),
  sent_by     VARCHAR(100),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_mail_log_created ON platform_mail_log(created_at DESC);

CREATE TABLE IF NOT EXISTS platform_batch_jobs (
  id          VARCHAR(100) PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  schedule    VARCHAR(100) NOT NULL,
  enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_status VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS platform_batch_log (
  id           SERIAL       PRIMARY KEY,
  job_id       VARCHAR(100) NOT NULL,
  status       VARCHAR(20)  NOT NULL,
  started_at   TIMESTAMPTZ  NOT NULL,
  finished_at  TIMESTAMPTZ  NOT NULL,
  duration_ms  INTEGER      NOT NULL,
  error        TEXT,
  summary      TEXT
);
CREATE INDEX IF NOT EXISTS idx_platform_batch_log_job ON platform_batch_log(job_id, started_at DESC);

/* ── platform 공통 인프라: 메신저 알림 (shared/notify/) ──────────────────
 * 텔레그램/디스코드/ntfy/웹푸시로 다중 수신자(본인/가족/지인)에게 알림 발송.
 * 카테고리(어느 프로젝트의 어떤 알림인지) 단위로 구독을 관리하고 발송 이력을 남긴다.
 */
CREATE TABLE IF NOT EXISTS notify_recipients (
  id                SERIAL       PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  relation          VARCHAR(20)  NOT NULL DEFAULT 'self', -- 'self' | 'family' | 'friend'
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  platform_user_id  VARCHAR(100) REFERENCES platform_users(id) ON DELETE SET NULL -- 로그인 사용자 셀프서비스 "내 알림 설정"용 연결. admin이 수동으로 만든 가족/지인 수신자는 NULL. 사용자 삭제 시 recipient는 남고 연결만 끊음(연결 끊긴 채로 admin이 계속 관리 가능)
);
ALTER TABLE notify_recipients ADD COLUMN IF NOT EXISTS platform_user_id VARCHAR(100) REFERENCES platform_users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notify_recipients_platform_user ON notify_recipients(platform_user_id) WHERE platform_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notify_telegram_channels (
  id            SERIAL       PRIMARY KEY,
  recipient_id  INTEGER      NOT NULL REFERENCES notify_recipients(id) ON DELETE CASCADE,
  chat_id       VARCHAR(50)  NOT NULL UNIQUE,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notify_discord_channels (
  id            SERIAL       PRIMARY KEY,
  recipient_id  INTEGER      NOT NULL REFERENCES notify_recipients(id) ON DELETE CASCADE,
  webhook_url   TEXT         NOT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notify_ntfy_channels (
  id            SERIAL       PRIMARY KEY,
  recipient_id  INTEGER      NOT NULL REFERENCES notify_recipients(id) ON DELETE CASCADE,
  topic         VARCHAR(100) NOT NULL UNIQUE,
  server        TEXT         NOT NULL DEFAULT 'https://ntfy.sh',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notify_push_subscriptions (
  id            SERIAL       PRIMARY KEY,
  recipient_id  INTEGER      NOT NULL REFERENCES notify_recipients(id) ON DELETE CASCADE,
  endpoint      TEXT         NOT NULL UNIQUE,
  p256dh        TEXT         NOT NULL,
  auth          TEXT         NOT NULL,
  label         VARCHAR(100),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_sent_at  TIMESTAMPTZ,
  last_error    TEXT
);

CREATE TABLE IF NOT EXISTS notify_fcm_channels (
  id            SERIAL       PRIMARY KEY,
  recipient_id  INTEGER      NOT NULL REFERENCES notify_recipients(id) ON DELETE CASCADE,
  fcm_token     TEXT         NOT NULL UNIQUE,
  platform      VARCHAR(10),           -- 'ios' | 'android'
  device_label  VARCHAR(100),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notify_categories (
  id          SERIAL       PRIMARY KEY,
  key         VARCHAR(50)  NOT NULL UNIQUE,  -- 'sap-batch', 'camp-check' 등 — 프로젝트가 정하는 알림 종류 키
  name        VARCHAR(100) NOT NULL,
  project     VARCHAR(50),                    -- 어느 프로젝트가 등록했는지 (app_prefix)
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notify_subscriptions (
  id            SERIAL       PRIMARY KEY,
  recipient_id  INTEGER      NOT NULL REFERENCES notify_recipients(id) ON DELETE CASCADE,
  category_id   INTEGER      NOT NULL REFERENCES notify_categories(id) ON DELETE CASCADE,
  channels      TEXT[]       NOT NULL DEFAULT ARRAY['telegram','discord','ntfy','webpush'],
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (recipient_id, category_id)
);

CREATE TABLE IF NOT EXISTS notify_log (
  id            SERIAL       PRIMARY KEY,
  category_id   INTEGER      REFERENCES notify_categories(id) ON DELETE SET NULL,
  recipient_id  INTEGER      REFERENCES notify_recipients(id) ON DELETE SET NULL,
  channel       VARCHAR(20)  NOT NULL,
  title         TEXT,
  body          TEXT,
  status        VARCHAR(10)  NOT NULL, -- 'success' | 'fail'
  error_message TEXT,
  sent_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notify_log_sent_at   ON notify_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notify_log_recipient ON notify_log(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notify_log_category  ON notify_log(category_id);

-- 가족/지인 온보딩용 1회성 초대 토큰 (현재는 테이블만 존재 — 초대 링크/딥링크 수신 플로우는 미구현)
CREATE TABLE IF NOT EXISTS notify_invite_tokens (
  token         VARCHAR(64)  PRIMARY KEY,
  recipient_id  INTEGER      NOT NULL REFERENCES notify_recipients(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ  NOT NULL,
  used_at       TIMESTAMPTZ
);

/* ── platform 공통 인프라: 버그/개선요청 신고 (Ctrl+H 위젯 → 관리자 콘솔/허브 모니터링)
 * shared/public/feedback-widget.js가 모든 프로젝트 화면에서 Ctrl+H로 띄우는 신고 폼의 저장소.
 * resolved_by = 'claude-batch'면 /auth/feedback/batch/:id(x-api-key)로 Claude가 자동 처리한 건,
 * 그 외 값이면 platform_users.id를 참조하는 관리자 수동 처리 건 (조회 시 LEFT JOIN으로 이름 표시).
 */
CREATE TABLE IF NOT EXISTS platform_feedback (
  id              SERIAL       PRIMARY KEY,
  app_prefix      VARCHAR(100) NOT NULL,
  category        VARCHAR(20)  NOT NULL,  -- 'bug' | 'improvement'
  type            VARCHAR(20)  NOT NULL,  -- 'ui' | 'error' | 'feature'
  content         TEXT         NOT NULL,
  page_url        VARCHAR(500),
  requester_id    VARCHAR(100) REFERENCES platform_users(id) ON DELETE SET NULL,
  requester_name  VARCHAR(200) NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending', -- 'pending' | 'done'
  resolution_note TEXT,
  resolved_by     VARCHAR(100),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_feedback_status    ON platform_feedback(status);
CREATE INDEX IF NOT EXISTS idx_platform_feedback_created   ON platform_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_feedback_requester ON platform_feedback(requester_id);
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
