-- baby-log 스키마
-- 사용자(users) ─< 가족 구성원(family_members) >─ 가족(families) ─< 아기(babies) ─< 이벤트(events)

-- 1단계(가족코드 버전) events 테이블이 남아 있으면 보존용으로 이름 변경
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'baby_id') THEN
    ALTER TABLE events RENAME TO events_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,              -- 소문자로 정규화해서 저장
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS families (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,                -- 배우자·조부모 초대용
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_members (
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);
CREATE INDEX IF NOT EXISTS family_members_user_idx ON family_members (user_id);

CREATE TABLE IF NOT EXISTS babies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- 아기 구분 키
  family_id  UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  birth_date DATE,
  sex        TEXT CHECK (sex IN ('M', 'F')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, name)                                  -- 한 가족 안에서 이름 중복 방지(음성 매칭용)
);
CREATE INDEX IF NOT EXISTS babies_family_idx ON babies (family_id);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,                             -- 클라이언트 생성 UUID (재전송 멱등성)
  baby_id     UUID NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('feeding', 'diaper', 'sleep', 'medicine', 'bath', 'etc')),
  time        TIMESTAMPTZ NOT NULL,                         -- 실제 발생 시각
  amount      NUMERIC(8, 2),
  unit        TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,           -- kind, food, side, duration_min 등
  raw_text    TEXT,                                         -- 음성 원문 (재파싱용)
  approx_time BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL, -- 누가 기록했는지
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_baby_time_idx      ON events (baby_id, time DESC);
CREATE INDEX IF NOT EXISTS events_baby_type_time_idx ON events (baby_id, type, time DESC);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,                          -- 원문이 아닌 SHA-256 해시만 저장
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

-- ---------- 알림 ----------
-- 아기별 알림 규칙 (가족 공용)
CREATE TABLE IF NOT EXISTS reminder_settings (
  baby_id               UUID PRIMARY KEY REFERENCES babies(id) ON DELETE CASCADE,
  feeding_enabled       BOOLEAN  NOT NULL DEFAULT TRUE,
  feeding_interval_min  SMALLINT NOT NULL DEFAULT 180 CHECK (feeding_interval_min BETWEEN 30 AND 720),
  diaper_enabled        BOOLEAN  NOT NULL DEFAULT FALSE,
  diaper_interval_min   SMALLINT NOT NULL DEFAULT 180 CHECK (diaper_interval_min BETWEEN 30 AND 720),
  nap_enabled           BOOLEAN  NOT NULL DEFAULT FALSE,   -- 낮잠이 너무 길면
  nap_max_min           SMALLINT NOT NULL DEFAULT 120 CHECK (nap_max_min BETWEEN 20 AND 360),
  wake_enabled          BOOLEAN  NOT NULL DEFAULT FALSE,   -- 깬 지 오래되면(재울 시간)
  wake_window_min       SMALLINT NOT NULL DEFAULT 120 CHECK (wake_window_min BETWEEN 30 AND 480),
  skip_while_sleeping   BOOLEAN  NOT NULL DEFAULT TRUE,    -- 자는 동안 수유·기저귀 알림 보류
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 사용자별 방해금지 시간 (분 단위, 로컬 시각)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quiet_enabled BOOLEAN  NOT NULL DEFAULT FALSE,
  quiet_start  SMALLINT NOT NULL DEFAULT 1380 CHECK (quiet_start BETWEEN 0 AND 1439), -- 23:00
  quiet_end    SMALLINT NOT NULL DEFAULT 360  CHECK (quiet_end BETWEEN 0 AND 1439),   -- 06:00
  tz_min       SMALLINT NOT NULL DEFAULT 540,
  notify_enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS push_tokens (
  token      TEXT PRIMARY KEY,                 -- ExponentPushToken[...]
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON push_tokens (user_id);

-- 같은 기준 이벤트로 같은 알림을 두 번 보내지 않기 위한 기록
CREATE TABLE IF NOT EXISTS reminder_log (
  baby_id   UUID NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  rule      TEXT NOT NULL,
  anchor_id TEXT NOT NULL,                     -- 기준이 된 이벤트 id
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipients SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (baby_id, rule, anchor_id)
);

-- ---------- 성장 기록 ----------
CREATE TABLE IF NOT EXISTS growth_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baby_id     UUID NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  measured_on DATE NOT NULL,
  weight_kg   NUMERIC(5, 2) CHECK (weight_kg BETWEEN 0.3 AND 60),
  height_cm   NUMERIC(5, 1) CHECK (height_cm BETWEEN 25 AND 150),
  head_cm     NUMERIC(4, 1) CHECK (head_cm BETWEEN 18 AND 60),
  note        TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (weight_kg IS NOT NULL OR height_cm IS NOT NULL OR head_cm IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS growth_baby_date_idx ON growth_records (baby_id, measured_on);

-- ---------- 예방접종·건강검진 완료 기록 ----------
CREATE TABLE IF NOT EXISTS health_records (
  baby_id     UUID NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('vaccine', 'checkup')),
  code        TEXT NOT NULL,        -- 예: DTaP, HepB, CHECKUP
  dose        SMALLINT NOT NULL,    -- 차수
  done_on     DATE NOT NULL,
  place       TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (baby_id, kind, code, dose)
);

-- 로타바이러스(로타릭스/로타텍), 일본뇌염(사백신/생백신) 선택
ALTER TABLE babies ADD COLUMN IF NOT EXISTS vaccine_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS vaccine_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS checkup_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------- 투약 (간격은 부모가 약 라벨·처방대로 입력) ----------
CREATE TABLE IF NOT EXISTS medicines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baby_id          UUID NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  aliases          TEXT[] NOT NULL DEFAULT '{}',     -- 말로 부르는 이름 (예: 해열제)
  min_interval_min SMALLINT NOT NULL CHECK (min_interval_min BETWEEN 30 AND 1440),
  max_per_day      SMALLINT CHECK (max_per_day BETWEEN 1 AND 12),
  dose_amount      NUMERIC(6, 2),
  dose_unit        TEXT,
  remind           BOOLEAN NOT NULL DEFAULT TRUE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS medicines_baby_name_active ON medicines (baby_id, name) WHERE active;

-- ---------- 이유식 새 재료 관찰 ----------
CREATE TABLE IF NOT EXISTS food_trials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baby_id      UUID NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
  food         TEXT NOT NULL,
  first_date   DATE NOT NULL,
  observe_days SMALLINT NOT NULL DEFAULT 3 CHECK (observe_days BETWEEN 1 AND 7),
  status       TEXT NOT NULL DEFAULT 'watching' CHECK (status IN ('watching', 'ok', 'reaction', 'known')),
  reactions    TEXT[] NOT NULL DEFAULT '{}',
  note         TEXT,
  recorded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (baby_id, food)
);

-- ---------- 밤 당번 ----------
CREATE TABLE IF NOT EXISTS family_settings (
  family_id    UUID PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  duty_enabled BOOLEAN  NOT NULL DEFAULT FALSE,
  night_start  SMALLINT NOT NULL DEFAULT 1320 CHECK (night_start BETWEEN 0 AND 1439), -- 22:00
  night_end    SMALLINT NOT NULL DEFAULT 420  CHECK (night_end BETWEEN 0 AND 1439)    -- 07:00
);
CREATE TABLE IF NOT EXISTS night_duty (            -- 요일별 반복 (0=일 … 6=토, 그날 저녁에 시작하는 밤)
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  weekday   SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (family_id, weekday)
);
CREATE TABLE IF NOT EXISTS night_duty_override (   -- 특정 날 밤만 바꾸기 (user_id NULL = 그날은 당번 없음)
  family_id  UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  night_date DATE NOT NULL,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (family_id, night_date)
);

ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS medicine_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS food_enabled BOOLEAN NOT NULL DEFAULT TRUE;
