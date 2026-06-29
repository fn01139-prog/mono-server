-- ============================================================
-- mono-server :: mindmap 프로젝트 PostgreSQL 스키마
-- Railway PostgreSQL 플러그인에 그대로 실행하면 됩니다.
-- (psql "$DATABASE_URL" -f db/schema.sql)
-- ============================================================

-- 마인드맵 보드 = 화면 상단의 "주제(제목)"
-- 여러 개의 마인드맵을 만들고 관리할 수 있도록 최상위 컨테이너로 분리했습니다.
CREATE TABLE IF NOT EXISTS mindmap_board (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- OBJECT_HEADER: 노드(항목)의 핵심 정보
CREATE TABLE IF NOT EXISTS object_header (
    id          SERIAL PRIMARY KEY,
    board_id    INTEGER NOT NULL REFERENCES mindmap_board(id) ON DELETE CASCADE,
    name        VARCHAR(200) NOT NULL,          -- 명칭
    content     TEXT,                            -- 내용
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- OBJECT_DETAIL: 노드의 화면 표시 속성 (1:1)
CREATE TABLE IF NOT EXISTS object_detail (
    id          SERIAL PRIMARY KEY,
    object_id   INTEGER NOT NULL UNIQUE REFERENCES object_header(id) ON DELETE CASCADE,
    pos_x       NUMERIC NOT NULL DEFAULT 0,      -- 위치 X
    pos_y       NUMERIC NOT NULL DEFAULT 0,      -- 위치 Y
    color       VARCHAR(20) NOT NULL DEFAULT '#F2A93B',   -- 색상
    width       NUMERIC NOT NULL DEFAULT 140,    -- 크기(가로)
    height      NUMERIC NOT NULL DEFAULT 60,     -- 크기(세로)
    shape       VARCHAR(20) NOT NULL DEFAULT 'rounded-rect', -- 모양: rounded-rect / ellipse / diamond / circle
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- RELATION: 객체 간 부모-자식 관계 (마인드맵 가지)
CREATE TABLE IF NOT EXISTS relation (
    id          SERIAL PRIMARY KEY,
    board_id    INTEGER NOT NULL REFERENCES mindmap_board(id) ON DELETE CASCADE,
    parent_id   INTEGER NOT NULL REFERENCES object_header(id) ON DELETE CASCADE,
    child_id    INTEGER NOT NULL REFERENCES object_header(id) ON DELETE CASCADE,
    label       VARCHAR(100),                    -- 관계선 위에 표시할 텍스트(선택)
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (parent_id, child_id),
    CHECK (parent_id <> child_id)
);

-- OBJECT_MEMO: 확장용 테이블 예시
-- 추가로 메모하고 싶은 내용은 이런 식으로 object_header.id를 참조하는
-- 별도 테이블을 계속 늘려가면 됩니다 (예: object_attachment, object_link, object_checklist ...)
CREATE TABLE IF NOT EXISTS object_memo (
    id          SERIAL PRIMARY KEY,
    object_id   INTEGER NOT NULL REFERENCES object_header(id) ON DELETE CASCADE,
    memo_type   VARCHAR(50) NOT NULL DEFAULT 'note',   -- note / link / file 등 자유롭게 구분
    memo_text   TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_object_header_board   ON object_header(board_id);
CREATE INDEX IF NOT EXISTS idx_relation_board         ON relation(board_id);
CREATE INDEX IF NOT EXISTS idx_relation_parent        ON relation(parent_id);
CREATE INDEX IF NOT EXISTS idx_relation_child         ON relation(child_id);
CREATE INDEX IF NOT EXISTS idx_object_memo_object     ON object_memo(object_id);

-- 동작 확인용 샘플 데이터 (필요 없으면 이 아래는 지우세요)
-- INSERT INTO mindmap_board (title) VALUES ('샘플 마인드맵') RETURNING id;
