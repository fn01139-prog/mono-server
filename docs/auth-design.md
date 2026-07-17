# 통합 인증 및 사용자별 데이터 격리 설계

> 작성일: 2026-07-17 (v2 — 결정사항 반영 완료)
> 상태: **설계 확정** (구현 착수 가능)
> 대상: mono-server 메인 허브 + 전체 프로젝트 앱

---

## 1. 목표

1. **메인 허브 로그인**: `/` (허브 페이지) 접근 시 로그인을 요구하고, 로그인한 사용자에게 **권한이 부여된 앱만** 카드로 노출한다.
2. **앱 접근 제어**: 권한 없는 앱은 URL 직접 접근(`/mdboard` 등)도 차단한다. 단, 앱별로 **공개 경로(publicPaths)** 를 선언해 로그인 없이 접근 가능한 URL을 둘 수 있다 (portfolio 공개 페이지 등).
3. **사용자별 데이터 격리**: 각 앱 내부에서 기본적으로 **본인이 생성한 데이터만** 조회/수정/삭제할 수 있다. (admin은 전체 조회 가능. 앱별 예외는 §5.5 참고)
4. **DB·사용자 정체성 통일**: 일부 앱에 흩어진 DB 접속을 `shared/db.js` 단일 pool로 승격하고, 테이블·컬럼 명칭을 표준화한다. **로그인 사용자(`platform_users`) 하나가 mdboard의 등록자, campchecklist의 참여자, 나머지 앱의 소유자로 공통 사용**된다.

## 2. 현재 상태 요약 (As-Is)

### 메인 허브 (`app.js`)
- `/` 에서 `loader.getList()`로 등록된 앱 전체를 인증 없이 노출.
- 인증 미들웨어 없음. CORS/logging만 존재.

### 앱별 인증·데이터 현황

| 앱 | 인증 방식 | 데이터 저장 | user 개념 | 비고 |
|---|---|---|---|---|
| campchecklist | **JWT** (`camp_accounts` + bcrypt) | PostgreSQL (`camp_*`) | ✅ 있음 (`user_id`, role) | 유일한 완전 계정 시스템 |
| mdboard | HMAC 단일 비밀번호 토큰 | **파일시스템** (`public/contents/`) | ❌ 없음 | 쓰기만 보호, 읽기는 전체 공개 |
| portfolio | HMAC 단일 비밀번호 토큰 | PostgreSQL (`portfolio_pages`) | ❌ 없음 (`person` 컬럼은 표시용) | `/studio`만 보호 |
| floorplan | 원시 관리자 토큰 (`x-admin-token`) | PostgreSQL (`floorplan_*`) | ❌ 없음 | 관리자/뷰어 2단계만 |
| travellog | **없음** | PostgreSQL (`travel_*`) + Google Drive | ❌ 없음 | 전체 공개 |
| mindmap | **없음** | PostgreSQL — **자체 pool(`db/pool.js`) + 비표준 테이블명**(`object_header`, `relation` 등) | ❌ 없음 | 전체 공개. DB 표준화 대상 |
| aptloan | 없음 (불필요) | 서버 데이터 없음 (순수 SPA) | — | 접근 제어만 적용 |

### 핵심 문제
- 인증이 앱마다 제각각 (JWT / HMAC / 원시 토큰 / 없음) → 통합 세션 불가.
- 대부분의 테이블에 소유자(`user_id`) 컬럼이 없어 데이터 격리 불가.
- mdboard는 DB가 아닌 파일시스템 기반이라 별도 전략 필요.

## 3. 설계 개요 (To-Be)

### 3.1 아키텍처 원칙

1. **campchecklist의 JWT 패턴을 플랫폼 공통으로 승격**한다. 기존 `camp_users`/`camp_accounts`를 플랫폼 테이블(`platform_users`/`platform_accounts`)로 일반화하고, campchecklist는 이를 사용하도록 마이그레이션한다.
2. 인증 로직은 `core/auth.js` (신규)에 두고, 각 앱의 `index.js`는 미들웨어만 가져다 쓴다.
3. 토큰 전달은 **httpOnly 쿠키** 를 기본으로 한다 (허브·모든 앱이 같은 도메인이므로 쿠키 하나로 SSO가 됨). 기존 앱 호환을 위해 `Authorization: Bearer` 헤더도 병행 지원.
4. 앱별 권한은 DB 테이블(`platform_app_grants`)로 관리하고, admin이 허브에서 부여/회수한다. `user_id = '*'` 와일드카드 행을 지원하여 **모든 로그인 계정에 해당 앱을 개방**할 수 있다.
5. 데이터 격리는 **각 데이터 테이블에 `owner_id` 컬럼 추가 + 라우트에서 WHERE 절 강제** 방식으로 구현한다 (RLS는 과설계로 판단, 애플리케이션 레벨로 충분).
6. **DB 표준화**: 모든 앱은 `shared/db.js` pool을 사용한다 (mindmap의 자체 `db/pool.js` 제거). 모든 테이블은 `<app>_` 접두사 + 복수형 명사로 통일하고, 소유자 컬럼은 `owner_id`, 행위자 참조는 `user_id`로 통일하며 전부 `platform_users.id`를 참조한다.

### 3.2 전체 구성도

```
브라우저
  │  (쿠키: mono_token = JWT)
  ▼
app.js
  ├─ cookie-parser (신규)
  ├─ core/auth.js  ──  attachUser        : 모든 요청에서 JWT 파싱 → req.user 주입
  │                ──  requireLogin      : 미로그인 시 401(API) / 로그인 페이지 redirect(HTML)
  │                ──  requireApp(name)  : 해당 앱 권한 검사 → 403
  │                ──  requireRole('admin')
  ├─ /auth/*       : 로그인/로그아웃/내정보/관리자용 사용자·권한 관리 API (신규)
  ├─ /login        : 로그인 페이지 (신규, 허브 스타일과 동일한 다크 테마)
  ├─ /             : 허브 — req.user의 권한 있는 앱만 카드 렌더링
  └─ core/loader.js
       └─ 각 앱 mount 시  requireLogin + requireApp(prefix) 를
          정적파일·API·SPA catch-all 앞단에 자동 삽입
```

## 4. DB 스키마 변경

### 4.1 신규 플랫폼 테이블

```sql
-- 사용자 (camp_users를 일반화)
CREATE TABLE IF NOT EXISTS platform_users (
  id          VARCHAR(100) PRIMARY KEY,          -- 기존 camp_users.id 형식 유지
  name        VARCHAR(200) NOT NULL,
  color       VARCHAR(20)  NOT NULL DEFAULT '#4a9eff',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 계정 (camp_accounts를 일반화)
CREATE TABLE IF NOT EXISTS platform_accounts (
  user_id       VARCHAR(100) PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  login_id      VARCHAR(100) UNIQUE NOT NULL,
  pw_hash       VARCHAR(200) NOT NULL,            -- bcrypt
  role          VARCHAR(50)  NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,      -- 비활성 계정 로그인 차단
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 앱별 접근 권한
CREATE TABLE IF NOT EXISTS platform_app_grants (
  user_id     VARCHAR(100) NOT NULL,              -- platform_users.id 또는 '*' (전체 계정 개방)
  app_prefix  VARCHAR(100) NOT NULL,              -- '/mdboard', '/travellog' 등 config.prefix
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  granted_by  VARCHAR(100),
  PRIMARY KEY (user_id, app_prefix)
);
```

- **admin은 grants와 무관하게 전체 앱 접근 가능.**
- **와일드카드**: `(user_id='*', app_prefix='/aptloan')` 처럼 등록하면 모든 로그인 계정이 해당 앱 접근 가능. `'*'`는 FK를 걸 수 없으므로 `user_id`에 FK 제약을 두지 않고, 사용자 삭제 시 애플리케이션에서 grants 행을 함께 삭제한다. (`requireApp` 판정: `role='admin'` OR `user_id IN (본인, '*')` 행 존재)
- 회원가입은 **없음** — admin이 `/auth/admin/users` API(또는 허브 관리 화면)에서 계정을 생성/발급한다. (개인 서버 특성상 셀프 가입은 불필요하고 공격면만 늘림. 필요해지면 초대코드 방식으로 추가.)

### 4.2 기존 사용자 마이그레이션

- `camp_users` → `platform_users`, `camp_accounts` → `platform_accounts` 로 **데이터 복사** (id/pw_hash 그대로, bcrypt 호환).
- 복사된 전원에게 `/campchecklist` 권한 자동 부여.
- `camp_users`/`camp_accounts` 테이블은 campchecklist 코드 전환 완료 후 제거 (전환 기간에는 유지).

### 4.3 앱별 소유자 컬럼 추가

```sql
-- 공통 패턴: owner_id 추가, 기존 데이터는 admin 계정으로 귀속
ALTER TABLE portfolio_pages      ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
ALTER TABLE floorplan_templates  ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
ALTER TABLE floorplan_categories ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
ALTER TABLE travel_trips         ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
ALTER TABLE mindmap_boards       ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);  -- §4.5 RENAME 이후
ALTER TABLE camp_trips           ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100);
ALTER TABLE portfolio_pages      ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_portfolio_owner ON portfolio_pages(owner_id);
CREATE INDEX IF NOT EXISTS idx_floorplan_owner ON floorplan_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_travel_owner    ON travel_trips(owner_id);
CREATE INDEX IF NOT EXISTS idx_mindmap_owner   ON mindmap_boards(owner_id);
```

- **자식 테이블은 부모를 통해 격리** (별도 owner_id 불필요):
  - travellog: `travel_schedules/records/photos` → `trip_id` 로 `travel_trips.owner_id` 검사
  - mindmap: objects/relations/memos → `board_id` 로 보드 owner 검사
- **기존 데이터 귀속**: 마이그레이션 시 `owner_id`가 NULL인 행은 admin 사용자 id로 UPDATE. 이후 `NOT NULL` 제약 추가.
- campchecklist는 이미 `user_id` 체계가 있으므로 소유 컬럼 추가 없음 (FK 대상만 `platform_users`로 변경). 단, trip 소유자 판정을 위해 `camp_trips`에 `owner_id` 컬럼을 추가한다 (기존 `created_by` JSONB에서 userId를 추출해 채움 — §5.5 참고).

### 4.4 신규: mdboard 파일 권한 테이블

파일 자체는 파일시스템에 유지하고(물리적 격리 없음), **파일별 소유자/권한을 DB로 관리**한다.

```sql
-- 파일 레지스트리 (등록자 = 로그인 사용자)
CREATE TABLE IF NOT EXISTS mdboard_files (
  id          SERIAL       PRIMARY KEY,
  file_path   VARCHAR(500) UNIQUE NOT NULL,   -- '폴더/파일.md' 또는 '파일.md' (기존 경로 식별자 그대로)
  file_type   VARCHAR(10)  NOT NULL DEFAULT 'md',  -- 'md' | 'html'
  owner_id    VARCHAR(100) NOT NULL REFERENCES platform_users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 파일별 공유 권한
CREATE TABLE IF NOT EXISTS mdboard_file_grants (
  file_id     INTEGER      NOT NULL REFERENCES mdboard_files(id) ON DELETE CASCADE,
  user_id     VARCHAR(100) NOT NULL,           -- platform_users.id 또는 '*' (전체 공유)
  permission  VARCHAR(10)  NOT NULL DEFAULT 'read',  -- 'read' | 'write'
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  granted_by  VARCHAR(100),
  PRIMARY KEY (file_id, user_id)
);
```

- 조회 가능 파일 = 본인 소유 + grants에 본인(또는 `'*'`)이 있는 파일. admin은 전체.
- 파일 저장/업로드 시 레지스트리에 자동 등록(owner = 요청자), 이동 시 `file_path` 갱신, 삭제 시 행 삭제 — **파일시스템과 DB의 동기화는 mdboard 라우트에서 책임진다.**
- 레지스트리에 없는 파일(수동 배치 등)은 파일 목록 스캔 시 자동으로 admin 소유로 등록 (self-healing).

### 4.5 mindmap 테이블 명칭 표준화 (RENAME)

mindmap의 범용 테이블명은 충돌 위험이 있고 명명 규칙에 어긋나므로 `<app>_` 접두사 + 복수형으로 개명한다.

```sql
ALTER TABLE mindmap_board RENAME TO mindmap_boards;
ALTER TABLE object_header RENAME TO mindmap_objects;
ALTER TABLE object_detail RENAME TO mindmap_object_details;
ALTER TABLE relation      RENAME TO mindmap_relations;
ALTER TABLE object_memo   RENAME TO mindmap_memos;
```

- `projects/mindmap/db/schema.sql`은 중앙 `scripts/migrate.js`로 통합하고 삭제.
- `projects/mindmap/db/pool.js` 삭제 → `shared/db.js` 사용 (index.js의 require 경로만 교체).
- 기존 DB에 옛 이름 테이블이 존재하면 RENAME, 없으면 새 이름으로 CREATE (마이그레이션 스크립트에서 분기).

## 5. 백엔드 변경 사항

### 5.1 신규: `core/auth.js`

```js
// 제공 미들웨어 / 함수
attachUser(req, res, next)   // 쿠키(mono_token) 또는 Bearer 헤더에서 JWT 검증 → req.user = { userId, loginId, name, role, apps: [...] }
requireLogin                 // req.user 없으면: API(Accept: json) → 401, HTML → 302 /login?next=<원경로>
requireApp(prefix)           // req.user.role === 'admin' 이거나 apps에 prefix 포함 시 통과, 아니면 403 (HTML이면 안내 페이지)
requireRole(role)            // admin 전용 라우트 보호
signToken(user)              // JWT 발급 (payload: userId, loginId, name, role / 만료 7d)
```

- JWT payload에 **앱 권한 목록은 넣지 않는다** (권한 회수 즉시 반영을 위해 `requireApp`에서 DB 조회). 성능이 문제되면 60초 in-memory 캐시 추가.
- `JWT_SECRET` 환경변수 재사용 (기존 campchecklist용 키. 프로덕션에서 강한 값으로 교체 필수).
- 쿠키 옵션: `httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production', maxAge: 7d`.
- 의존성 추가: `cookie-parser` (jsonwebtoken, bcryptjs는 이미 있음).

### 5.2 신규: 플랫폼 인증 라우트 (`core/auth-routes.js` → app.js에서 `/auth` 마운트)

| Method | Path | 권한 | 설명 |
|---|---|---|---|
| POST | `/auth/login` | 공개 | `{ loginId, password }` → JWT 발급 + `mono_token` 쿠키 세팅 |
| POST | `/auth/logout` | 로그인 | 쿠키 삭제 |
| GET  | `/auth/me` | 로그인 | 내 정보 + 권한 있는 앱 목록 |
| GET  | `/auth/admin/users` | admin | 사용자 목록 + 권한 현황 |
| POST | `/auth/admin/users` | admin | 계정 생성 `{ name, loginId, password, apps: [] }` |
| PUT  | `/auth/admin/users/:id` | admin | 이름/비밀번호 초기화/활성화 토글 |
| PUT  | `/auth/admin/users/:id/apps` | admin | 앱 권한 목록 교체 `{ apps: ['/mdboard', ...] }` |
| DELETE | `/auth/admin/users/:id` | admin | 계정 삭제 (소유 데이터는 유지, owner 표기만 남음) |

### 5.3 `app.js` 변경

1. `cookie-parser` + `attachUser` 를 공통 미들웨어에 추가.
2. `/login` GET: 로그인 HTML 페이지 (허브와 동일 다크 테마, 인라인 렌더 또는 `core/views/login.html`).
3. `/` 허브: `requireLogin` 적용. 카드 목록을 `projects.filter(p => req.user.role === 'admin' || req.user.apps.includes(p.prefix))` 로 필터링. 상단에 사용자명 + 로그아웃 버튼, admin이면 "사용자 관리" 링크 추가.
4. `/health` 는 인증 제외 (Railway 헬스체크).

### 5.4 `core/loader.js` 변경

각 앱 마운트 시 정적/API/SPA 라우트 **앞에** 가드를 삽입:

```js
const guard = [attachUser, requireLogin, requireApp(prefix)];
app.use(prefix, ...guard, express.static(publicDir));
app.use(`${prefix}/api`, ...guard, router);
// customRoutes, SPA catch-all도 동일 가드 적용
```

- `config.js`에 공개 범위 옵션 추가 (둘 다 지원):
  - `public: true` — 앱 전체 가드 생략 (전면 공개. 현재 사용 앱 없음)
  - `publicPaths: [...]` — 지정한 경로 패턴만 로그인 없이 통과. 가드 미들웨어가 `req.path`를 패턴과 대조해 매칭되면 skip. 정적 자원 확장자(`.css`, `.js`, `.png` 등)는 패턴에 포함 가능.
    ```js
    // portfolio/config.js 예시 — 공개 뷰어 경로
    publicPaths: [
      '/:pageId',           // 공개 페이지 뷰 (SPA 진입)
      '/api/pages/:id',     // 페이지 데이터 조회 (is_public 검사는 앱 라우트에서)
      '/assets/*',          // 뷰어 정적 자원
    ],
    ```
- publicPaths로 열린 API는 **앱 라우트에서 2차 검사 필수** (예: portfolio는 `is_public = true`인 페이지만 비로그인 응답). loader는 "로그인 면제"만 담당하고 데이터 노출 판단은 앱이 한다.
- 이 방식의 장점: **앱 코드를 건드리지 않아도 접근 제어는 loader 레벨에서 일괄 적용**됨. 앱 내부 변경은 "데이터 격리"에만 집중하면 된다.

### 5.5 앱별 변경 (데이터 격리)

모든 앱 공통: 가드가 앞단에 있으므로 라우터 진입 시 `req.user`가 항상 존재. 격리 규칙은 다음과 같다.

> **격리 기본 규칙**
> - 목록/조회: `WHERE owner_id = $userId` (admin은 전체 + 응답에 owner 정보 포함)
> - 생성: `owner_id = req.user.userId` 서버에서 강제 주입 (클라이언트 값 무시)
> - 수정/삭제: 대상 행의 owner 확인 후 불일치 시 404 (403이 아닌 404로 존재 자체를 숨김. admin은 통과)

#### campchecklist — 컨셉 변경: "참여" → "초대"
기존 self-join 모델(사용자가 일정에 스스로 참여/탈퇴)을 폐기하고, **일정 생성자가 참여자를 추가하는 초대 모델**로 전환한다.

- **인증**: 자체 `/auth/register`, `/auth/login` 라우트 제거, `authOptional` 제거 → 플랫폼 로그인 사용 (JWT payload 필드명 `userId/loginId/name/role` 동일하게 유지해 호환).
- **사용자**: `camp_users`/`camp_accounts` 참조를 `platform_users`/`platform_accounts`로 전환. 참여자 = 플랫폼 로그인 사용자. 사용자 색상(color)은 `platform_users`로 이동.
- **일정(trips) 격리**:
  - 조회: **본인이 만든 trip(owner_id) + participants에 본인이 포함된 trip**만 목록에 노출. admin은 전체.
  - `camp_trips.owner_id` 신설 — 기존 행은 `created_by` JSONB의 userId를 추출해 채우는 1회성 마이그레이션.
  - 수정/삭제: owner(또는 admin)만.
- **참여자 관리**: `PUT /trips/:id/join`, `DELETE /trips/:id/join` (self-join) **제거** → `PUT /trips/:id/participants` (owner 전용, 참여자 목록 교체) 신설. 참여자 선택 UI는 `/campchecklist` 접근 권한이 있는 platform 사용자 목록에서 선택 (`GET /members` — grants 조인 조회).
- **품목(items)**: 본인 품목만 생성/수정/삭제 (기존 `user_id` 체계 유지). 같은 trip의 참여자 품목은 해당 trip 화면에서 조회 가능 (체크리스트 협업 유지).
- **체크(checks)**: 본인 참여 trip에서 본인 체크만 수정.
- **댓글(comments)**: 해당 trip의 owner/참여자만 조회·작성.

#### portfolio — 공개 페이지 + 와일드카드 권한
- `portfolio_pages.owner_id` 기준 CRUD 격리 (`/studio`는 로그인 사용자 접근 가능, 본인 페이지만 편집).
- HMAC 인증(`PORTFOLIO_PASSWORD`, `/api/auth*`) 제거 → 플랫폼 인증으로 대체.
- **공개 조회 (URL 기반)**: `config.publicPaths`로 뷰어 경로(`/:pageId`, `GET /api/pages/:id`, 뷰어 정적 자원)를 로그인 면제. 앱 라우트에서 비로그인 요청은 **`is_public = true`(또는 `status = 'published'`)인 페이지만** 응답, 그 외 404. 로그인 사용자는 본인 페이지 + 공개 페이지 조회 가능.
  - `is_public` 토글은 studio에서 페이지별로 설정.
- **전 계정 개방 옵션**: 필요 시 grants에 `(user_id='*', app_prefix='/portfolio')` 등록으로 모든 로그인 계정에 개방 가능 (§4.1 와일드카드). 관리 페이지(`/studio`)는 허브·공개 페이지에서 링크되지 않으며, 쓰기 API는 어차피 로그인+본인 소유 검사로 보호됨.

#### travellog
- `travel_trips.owner_id` 기준 격리. 하위 schedules/records/photos는 trip 소유권 경유 검사 (라우트마다 `trip_id` → owner 확인 헬퍼 함수 1개 추가).
- 인증이 아예 없던 앱이므로 프론트에 로그인 상태 표시만 추가하면 됨 (가드는 loader가 처리).

#### mindmap
- **DB 표준화 선행**: `db/pool.js` 제거 → `shared/db.js`, 테이블 RENAME (§4.5), `schema.sql` → 중앙 migrate.js 통합.
- `mindmap_boards.owner_id` 기준 격리. objects/relations/memos는 board 소유권 경유 검사.
- `GET /boards` → 본인 보드만. duplicate 시 새 보드 owner = 본인.

#### floorplan — 본인 것만 수정, 타인 것은 조회 전용
- 기존 `x-admin-token` / `ADMIN_TOKENS` 방식 제거 → 플랫폼 인증으로 대체.
- **조회**: 로그인 사용자는 **전체 템플릿 목록 조회 가능** (본인/타인 구분 표시, owner 이름 포함).
- **수정/삭제/저장**: `floorplan_templates.owner_id` 본인 것만 (admin 예외). 신규 저장 시 owner = 본인.
- **프론트**: 본인 템플릿 열람 시 그리기 도구 활성화, 타인 템플릿 열람 시 도구 비활성(읽기 전용 뷰). 기존 "관리자 로그인 모달" 제거.
- `floorplan_categories`(품목 카테고리)도 동일 규칙: 조회는 전체, 수정은 본인 것만.

#### mdboard — 파일 격리 없음, DB 기반 파일별 권한
파일시스템 구조(`public/contents/`)는 그대로 두고, **파일별 소유/공유 권한을 DB(`mdboard_files`, `mdboard_file_grants` — §4.4)로 관리**한다. 등록자 = 플랫폼 로그인 사용자.

- **파일 목록(`GET /files`)**: 파일시스템 스캔 결과를 레지스트리와 조인해 **본인 소유 + 권한 부여받은 파일(read 이상)** 만 반환. admin은 전체. 폴더 목록도 노출 파일이 속한 폴더만 표시.
- **파일 조회(`GET /file/*`)**: 소유자이거나 read 이상 권한 보유 시에만 응답, 아니면 404.
- **파일 저장(`POST /save`)**: 신규 파일 → 레지스트리 등록(owner = 본인). 기존 파일 → 소유자 또는 write 권한 보유자만.
- **삭제/이동**: 소유자(또는 admin)만. 처리 시 레지스트리 동기화 (이동 → `file_path` UPDATE, 삭제 → 행 DELETE).
- **공유 UI**: 파일 상세/사이드바에 "공유" 메뉴 — 소유자가 다른 사용자를 선택해 read/write 부여, `'*'` 선택 시 전체 공유. 대상 사용자 목록은 `/mdboard` 접근 권한 보유자만.
- **HTML 파일·이미지**: HTML 파일도 동일 레지스트리로 관리(`file_type='html'`). 업로드 이미지(`img/`)는 문서에 종속되므로 별도 권한 관리 없음 (문서 접근 가능자는 이미지도 접근 가능).
- **레거시 파일**: 마이그레이션 스크립트로 기존 파일 전량을 admin 소유로 등록. 이후 스캔 시 미등록 파일 발견하면 admin 소유로 자동 등록 (self-healing).
- HMAC 인증(`MDBOARD_PASSWORD`) 제거.

#### aptloan
- 서버 데이터 없음. loader 가드에 의한 접근 제어만 적용, 코드 변경 없음.

## 6. 프론트엔드 변경 사항

1. **신규 `/login` 페이지**: loginId/password 폼, 실패 메시지, 성공 시 `next` 파라미터로 복귀. 허브 다크 테마 재사용.
2. **허브 (`/`)**: 사용자명·로그아웃 버튼, admin 전용 "사용자 관리" 화면(계정 생성, 앱 권한 체크박스 매트릭스). 사용자 관리는 별도 페이지(`/admin`)로 분리 권장.
3. **각 앱 공통**:
   - API가 401을 반환하면 `/login?next=<현재경로>`로 리다이렉트하는 공통 fetch 래퍼 or 인터셉터 추가 (`shared/` 또는 각 앱 js에 소량 삽입).
   - 쿠키 기반이므로 **기존 localStorage 토큰 로직(`mdboard_token`, `portfolio_token`, floorplan 모달, campchecklist 로그인 폼)은 제거**.
4. **앱별 신규 UI**:
   - **campchecklist**: 자체 로그인/가입 UI 제거 (`/auth/me`로 사용자 표시). 일정 상세에 owner 전용 "참여자 관리" 패널 (권한 보유 사용자 목록에서 추가/제거). 기존 "참여하기/빠지기" 버튼 제거.
   - **mdboard**: 파일별 "공유" 메뉴 (사용자 선택 + read/write + 전체 공유). 파일 목록에 소유자/공유 상태 배지.
   - **floorplan**: 타인 템플릿 열람 시 읽기 전용 모드 (그리기 도구 비활성 + "읽기 전용" 표시). 템플릿 목록에 소유자 표시.
   - **portfolio**: studio에 페이지별 공개(`is_public`) 토글 + 공개 URL 복사 버튼.

## 7. 환경변수 변경

| 변수 | 변경 |
|---|---|
| `JWT_SECRET` | 유지 (플랫폼 공통 서명 키로 승격, 프로덕션 값 교체 필수) |
| `MDBOARD_PASSWORD`, `PORTFOLIO_PASSWORD` | **제거** |
| `FLOORPLAN_ADMIN_TOKENS`, `ADMIN_TOKENS` | **제거** |
| `CAMP_ADMIN_ID` | `PLATFORM_ADMIN_ID`로 개명 — 이 loginId로 로그인하는 계정은 admin role (최초 부트스트랩용) |
| `PLATFORM_ADMIN_PW` (신규, 선택) | 서버 기동 시 admin 계정이 없으면 자동 생성하는 초기 비밀번호 |

**부트스트랩**: 서버 시작 시 `platform_accounts`가 비어 있으면 `PLATFORM_ADMIN_ID`/`PLATFORM_ADMIN_PW`로 admin 계정 자동 생성 (콘솔에 안내 로그). 이것으로 최초 로그인 → 이후 admin이 사용자 발급.

## 8. 구현 순서 (단계별 배포 가능하도록)

각 단계는 독립 배포 가능하며, 이전 단계가 깨져도 롤백 범위가 좁다.

1. **Phase 1 — 플랫폼 인증 기반** (앱 동작 변화 없음)
   - `platform_*` 테이블 마이그레이션 + camp 계정 데이터 복사 + admin 부트스트랩
   - `core/auth.js`, `/auth/*` 라우트, `/login` 페이지
   - 허브(`/`)에 `requireLogin` + 앱 필터링 적용
   - 이 시점: 허브만 로그인 필요, 각 앱 URL 직접 접근은 아직 열려 있음
2. **Phase 2 — 앱 접근 제어**
   - `core/loader.js`에 가드 삽입 (전 앱 일괄)
   - 각 앱 프론트에 401 → `/login` 리다이렉트 래퍼 추가
   - 기존 앱별 인증(HMAC/토큰) 제거는 아직 하지 않음 (이중 인증 상태지만 동작함)
3. **Phase 3 — DB 표준화 + 데이터 격리 (앱별 순차 진행, 앱당 1커밋)**
   - ⓪ mindmap DB 표준화 (pool 교체 + 테이블 RENAME + migrate.js 통합) — 격리와 무관하게 선행 가능
   - ① mindmap 격리 → ② travellog → ③ portfolio (publicPaths + is_public 포함) → ④ floorplan (읽기 전용 뷰 포함)
   - 각 앱: owner_id 마이그레이션 → 라우트 WHERE 강제 → 기존 자체 인증 제거 → 프론트 정리
4. **Phase 4 — campchecklist 초대 모델 전환 + mdboard 파일 권한**
   - campchecklist: platform_users 참조 전환, 자체 auth 제거, `owner_id` 백필, self-join 라우트 제거 → 참여자 관리 라우트/UI
   - mdboard: `mdboard_files`/`mdboard_file_grants` 생성, 레거시 파일 admin 귀속, 라우트 권한 검사, 공유 UI
   - `camp_users`/`camp_accounts` 제거, 불용 환경변수 정리
5. **Phase 5 — 관리 화면**
   - `/admin` 사용자 관리 UI — 계정 생성/비활성화, 앱 권한 매트릭스 (와일드카드 `*` 행 포함)
   - 그 전까지는 API 직접 호출로 운영 가능

## 9. 보안 체크리스트 (구현 시 준수)

- [ ] 비밀번호는 bcrypt (cost 10+), 응답에 pw_hash 절대 미포함
- [ ] JWT는 httpOnly 쿠키 — 프론트 JS에서 토큰을 다루지 않음 (XSS 내성)
- [ ] `sameSite: 'lax'` + 상태 변경은 전부 JSON POST/PUT/DELETE → CSRF 실질 차단 (form POST 없음)
- [ ] 로그인 라우트에 rate limit (`express-rate-limit`, 예: 15분 10회)
- [ ] 존재하지 않는 리소스와 남의 리소스는 동일하게 404 응답 (열거 공격 방지)
- [ ] `owner_id`는 항상 서버에서 주입 — 요청 body의 owner 관련 필드 무시
- [ ] 로그인 실패 메시지는 "아이디 또는 비밀번호가 올바르지 않습니다"로 통일
- [ ] `JWT_SECRET` 기본값(`campcheck-dev-secret-*`)으로 프로덕션 기동 시 경고 로그 (또는 기동 거부)
- [ ] `/health` 외 모든 경로 인증 필수 확인 (특히 SPA catch-all, customRoutes, 정적 파일)

## 10. 확정된 결정사항

| # | 항목 | 결정 | 반영 위치 |
|---|---|---|---|
| 1 | portfolio 공개 조회 | **URL 기반 공개 경로(`config.publicPaths`) + 페이지별 `is_public` 플래그**. 추가로 grants 와일드카드(`user_id='*'`)로 앱 단위 전 계정 개방도 지원 | §4.1, §5.4, §5.5 |
| 2 | floorplan 그리기 권한 | **로그인 사용자는 본인 것만 수정, 타인 것은 조회 전용** (읽기 전용 뷰) | §5.5 |
| 3 | mdboard 격리 방식 | **파일 격리 없음. 파일별 소유/공유 권한을 DB로 관리** — 본인 소유 + 권한 부여받은 파일만 노출 | §4.4, §5.5 |
| 4 | campchecklist | **초대 모델로 컨셉 변경** — 생성자가 참여자를 추가, 본인이 만들었거나 초대된 일정만 조회 | §5.5 |
| 5 | 토큰 만료 | **7일 고정** (refresh 토큰 없음) | §5.1 |
| 6 | DB·명칭 표준화 | **`shared/db.js` pool 공통 사용 + 테이블 `<app>_` 접두사·복수형 통일 + `platform_users` 단일 사용자 정체성** (mdboard 등록자 = campchecklist 참여자 = 각 앱 소유자) | §3.1, §4.5 |

---

## 부록 A. 요청 흐름 예시

```
[비로그인] GET /travellog/trips 페이지
  → attachUser: 쿠키 없음
  → requireLogin: HTML 요청 → 302 /login?next=/travellog/trips
  → 로그인 성공 → 쿠키 세팅 → /travellog/trips 복귀
  → requireApp('/travellog'): grants 조회 → 통과 (없으면 403 안내 페이지)
  → SPA index.html 서빙

[로그인] GET /travellog/api/trips
  → req.user = { userId: 'u_xxx', role: 'member', ... }
  → SELECT * FROM travel_trips WHERE owner_id = 'u_xxx'
```

## 부록 B. 영향 파일 목록 (예상)

| 파일 | 작업 |
|---|---|
| `scripts/migrate.js` | platform_* 테이블, `mdboard_files`/`mdboard_file_grants`, owner_id·is_public 컬럼, mindmap RENAME 분기, 인덱스 추가 |
| `scripts/migrate-auth.js` (신규) | camp → platform 계정 복사, 기존 행 admin 귀속, `camp_trips.owner_id` 백필, mdboard 레거시 파일 등록 (1회성) |
| `core/auth.js` (신규) | JWT/미들웨어 (attachUser, requireLogin, requireApp — 와일드카드 판정 포함, requireRole) |
| `core/auth-routes.js` (신규) | /auth/* API |
| `core/views/login.html` (신규) | 로그인 페이지 |
| `app.js` | cookie-parser, attachUser, /login, /auth 마운트, 허브 필터링 |
| `core/loader.js` | 앱별 가드 삽입, `config.public` / `config.publicPaths` 지원 |
| `projects/mindmap/db/pool.js`, `db/schema.sql` | **삭제** → `shared/db.js` 사용, migrate.js로 통합 |
| `projects/mindmap/index.js` | pool 경로 교체, 신규 테이블명, 격리 WHERE |
| `projects/campchecklist/index.js` | platform 참조 전환, 자체 auth 제거, self-join 제거, 참여자 관리 라우트, trip 격리 |
| `projects/mdboard/index.js` | 파일 레지스트리 동기화, 권한 검사, 공유 API, HMAC 제거 |
| `projects/portfolio/index.js`, `config.js` | owner 격리, is_public 공개 조회, publicPaths, HMAC 제거 |
| `projects/floorplan/index.js`, `services/storage.js` | owner 격리(조회 전체/수정 본인), 토큰 인증 제거 |
| `projects/travellog/index.js` | trip owner 격리 + 하위 리소스 경유 검사 |
| `projects/*/public/**/*.js` | 401 리다이렉트, 기존 토큰 UI 제거, 앱별 신규 UI (§6-4) |
| `package.json` | `cookie-parser`, `express-rate-limit` 추가 |
| `CLAUDE.md`, `README.md` | 인증 패턴·테이블 명칭 문서 갱신 |
