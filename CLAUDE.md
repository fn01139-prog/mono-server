# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Setup
cp .env.example .env

# Development (auto-reload via nodemon)
npm run dev

# Production
npm start          # node app.js
npm run pm2        # via PM2 process manager

# DB 마이그레이션 (테이블 생성, 서버 기동 시 자동 실행됨 — 수동 실행도 가능)
node scripts/migrate.js

# 플랫폼 인증 부트스트랩/마이그레이션 (admin 계정 생성, 레거시 데이터 이관 — 멱등, 서버 기동 시 자동 실행)
node scripts/migrate-auth.js

# 기존 JSON 파일 → PostgreSQL 시딩 (최초 1회)
node scripts/seed.js
```

No test or lint scripts are configured.

## Architecture

This is a **plugin-loading mono-server**: a single Express app that auto-discovers and mounts independent project modules at runtime.

### Core Flow

1. `app.js` initializes Express, CORS, and logging, then calls `core/loader.js`
2. `core/loader.js` scans `projects/`, and for each directory with `config.js` where `enabled: true`:
   - Mounts `public/` as static files at `/<prefix>`
   - Mounts `index.js` (Express Router) as API at `/<prefix>/api`
   - If `config.spa: true`, adds a catch-all that serves `public/index.html` for SPA routing
3. `/health` and `/` (project hub listing) are registered after all projects load

### Adding a New Project

Create `projects/<name>/config.js`:
```js
module.exports = { name: 'My App', prefix: 'myapp', enabled: true, icon: '🔧', description: '...' };
```

Create `projects/<name>/index.js` exporting an Express Router, and optionally a `projects/<name>/public/` directory for static assets.

> **중요**: `index.js`의 라우트 경로에 `/api/` 접두사를 붙이지 말 것. `loader.js`가 이미 라우터를 `/<prefix>/api`에 마운트하므로, 내부 라우트에 `/api/`를 추가하면 실제 경로가 `/<prefix>/api/api/...`가 되어 SPA catch-all이 HTML을 반환하는 버그가 발생한다.
>
> ```js
> // ❌ 잘못된 예 — /prefix/api/api/items 로 등록됨
> router.get('/api/items', ...)
>
> // ✅ 올바른 예 — /prefix/api/items 로 등록됨
> router.get('/items', ...)
> ```

### Shared Utilities (`shared/utils.js`)

- `asyncHandler(fn)` — wraps async route handlers to forward errors to Express error middleware
- `ok(res, data, msg)` — standard `{ success: true, data, message }` response
- `fail(res, msg, status)` — standard `{ success: false, message }` error response

### Active Projects

| Prefix | Description | Notes |
|--------|-------------|-------|
| `/mdboard` | Markdown document platform | 폴더 분류; 파일 CRUD + 이미지 업로드(multer); HTML 파일 업로드/뷰어; Marp HTML/PDF 내보내기; Google Drive 백업; **파일별 소유/공유 권한** (`mdboard_files`, `mdboard_file_grants`) |
| `/portfolio` | Personal portfolio page builder | SPA mode; **PostgreSQL** (`portfolio_pages`); `owner_id` 격리; `status='published'` 페이지는 비로그인 공개 조회 |
| `/aptloan` | 아파트 대출 계산기 | SPA mode; 입주비용·중도금이자·대출 상환 시뮬레이터; 서버 데이터 없음 |
| `/floorplan` | 평면도 그리기 | SPA mode; **PostgreSQL** (`floorplan_templates`, `floorplan_categories`); 조회는 로그인 사용자 전원, 수정은 소유자/admin만 |
| `/travellog` | 여행 계획 및 기록 관리 | SPA mode; **PostgreSQL** (`travel_*`); `owner_id` 격리; 사진 파일은 Google Drive |
| `/campchecklist` | 캠핑 체크리스트 | **PostgreSQL** (`camp_*`); 생성자가 참여자를 초대하는 방식 — 본인이 만들었거나 초대된 일정만 조회 |
| `/mindmap` | 마인드맵 | **PostgreSQL** (`mindmap_boards` 등); `owner_id` 격리 |

모든 앱은 인증을 자체 구현하지 않는다 — `core/loader.js`가 마운트 시점에 로그인·앱 권한 가드를 자동으로 앞단에 삽입한다. 자세한 내용은 아래 "Authentication" 섹션 참고.

### Custom Routes (`config.customRoutes`)

`loader.js`는 SPA catch-all 이전에 특정 파일을 특정 경로로 서빙하는 `customRoutes`를 지원한다. 확장자 없는 URL로 특정 HTML 파일을 제공할 때 사용한다.

```js
// config.js 예시
customRoutes: [
  { path: '/studio', file: 'studio.html' },
]
```

### Authentication (플랫폼 통합 인증)

모든 앱은 단일 플랫폼 로그인(JWT, httpOnly 쿠키)을 공유한다. 앱별 자체 인증(비밀번호/토큰)은 존재하지 않는다.

**핵심 파일**
- `core/auth.js` — JWT 서명/검증, `attachUser`(모든 요청에 `req.user` 주입), `requireLogin`, `requireApp(prefix)`, `requireRole(role)`, `matchesPublicPath`
- `core/auth-routes.js` — `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/admin/*`(사용자·권한 관리, admin 전용)
- `core/loader.js` — 각 앱을 마운트할 때 `requireLogin` + `requireApp(prefix)` 가드를 정적 파일/API/customRoutes/SPA catch-all 앞에 자동 삽입. 앱 코드는 가드를 신경 쓸 필요 없음
- `core/views/login.html`, `core/views/admin.html` — 로그인 페이지, **관리자 콘솔**(`/admin`, admin 전용, 탭형 단일 페이지: 사용자 관리 / 메일 발송 / 배치잡 / 시스템 점검)

**DB 테이블**
- `platform_users` / `platform_accounts` — 사용자·계정(로그인ID, bcrypt 해시, role: `admin`|`member`)
- `platform_app_grants` — `(user_id, app_prefix)` 쌍으로 앱별 접근 권한. `user_id = '*'`는 전체 계정에 개방하는 와일드카드
- admin은 grants와 무관하게 모든 앱에 접근 가능

**앱별 접근 제어 예외 (`config.js`)**
- `public: true` — 가드 없이 전면 공개 (현재 사용 앱 없음)
- `publicPaths: [...]` — API 마운트(`${prefix}/api`) 기준 상대경로 중 GET만 로그인 없이 통과 (쓰기 메서드는 항상 로그인 필요)
- `publicStaticPaths: [...]` — 정적/SPA 마운트(`${prefix}`) 기준 상대경로용 별도 목록. 예: `portfolio/config.js`의 공개 페이지 뷰어
- `customRoutes`로 등록된 파일(예: `studio.html`)은 정적 서빙 경로로 직접 요청해도 `publicPaths` 와일드카드로 우회되지 않도록 loader.js가 항상 로그인을 요구함

**데이터 격리 패턴 (앱별 구현)**
- 대부분의 테이블에 `owner_id` 컬럼 (→ `platform_users.id`) — 본인 것만 조회/수정/삭제, admin은 전체
- `mdboard`는 파일시스템 기반이라 예외: `mdboard_files`/`mdboard_file_grants`로 파일별 소유자·공유 권한을 DB로 관리 (파일 자체는 격리하지 않음)
- `campchecklist`는 트립 생성자가 참여자를 초대하는 방식 (`camp_trips.owner_id` + `participants` JSONB)
- `floorplan`은 조회는 로그인 사용자 전원, 수정/삭제만 소유자 제한

### 플랫폼 공통 인프라: 메일 발송 / 배치잡 / 관리자 콘솔

`/admin`(admin 전용)은 4개 탭으로 구성된 탭형 단일 페이지다: 사용자 관리, 메일 발송, 배치잡, 시스템 점검. API는 모두 `core/auth-routes.js`의 `/auth/admin/*` 아래 있다(기존 `requireRole('admin')` 가드 재사용).

**메일 발송 (`shared/mailer.js`)**
- 모든 앱/배치잡이 재사용하는 공통 발송 함수: `sendMail({ to, subject, text, html, appPrefix, sentBy })`
- SMTP 자격 증명은 `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` 환경변수로만 설정(admin 콘솔에서는 편집 불가, 상태 조회만)
- 모든 발송 시도(성공/실패)는 `platform_mail_log`에 기록됨
- admin API: `GET /auth/admin/mail/config`(설정 상태), `POST /auth/admin/mail/test`(테스트 발송), `GET /auth/admin/mail/logs`

**배치잡 (`core/batch.js`)**
- `core/jobs/*.js`를 자동 스캔해 `node-cron`으로 등록 (projects/ 자동 로딩과 동일한 패턴). 각 파일은 `{ id, name, schedule, description, run(pool) }`을 export
- 실행 이력은 `platform_batch_log`에, 활성화 여부/마지막 실행 상태는 `platform_batch_jobs`에 저장
- 활성화 스위치는 "자동 스케줄 실행"만 제어 — admin 콘솔의 "지금 실행"은 비활성 상태여도 항상 동작
- 기본 등록된 잡: `mail-log-cleanup`(90일 지난 메일 로그 정리), `batch-log-cleanup`(180일 지난 배치 로그 정리)
- admin API: `GET/PUT /auth/admin/batch/jobs(/:id)`, `POST /auth/admin/batch/jobs/:id/run`, `GET /auth/admin/batch/logs`

**시스템 점검 (`GET /auth/admin/system/check`)**
- 로그인/권한 제어(`core/auth.js`) 상태를 점검: `JWT_SECRET` 기본값 여부, 활성 admin 수, 비활성 계정 수, 와일드카드(`*`) 권한 수, 앱 권한이 하나도 없는 사용자, SMTP 설정 여부
- 부수 안전장치: `/auth/admin/users/:id`의 PUT(비활성화)/DELETE는 **마지막으로 남은 활성 admin 계정**을 대상으로 하면 차단됨(전원 잠금 방지)

### mdboard 폴더 구조

`projects/mdboard/public/contents/` 하위 디렉토리가 폴더 단위이며, 루트의 `.md` 파일은 "기본" 폴더로 표시된다.

- 파일 식별자: `폴더명/파일명.md` 또는 `파일명.md` (경로 기반 unique key)
- API 경로 인코딩: `filePath.split('/').map(encodeURIComponent).join('/')` (슬래시는 경로 구분자로 유지)
- Express 라우트: `router.get('/file/*', ...)` → `req.params[0]`으로 전체 경로 수신
- 최대 2 depth 제한, `img/` 폴더 접근 불가 (`safePath()` 함수로 검증)

**폴더 관련 API**
- `GET /folders` — 폴더 목록
- `POST /folders` — 폴더 생성
- `DELETE /folders/:name` — 폴더 삭제 (비어있을 때만)
- `POST /move` — 파일 폴더 이동 `{ file, fromFolder, toFolder }`

**HTML 파일 기능**

HTML 파일은 `contents/` 루트에만 저장되며 (서브폴더 없음), 사이드바 별도 섹션에 표시된다.

- `GET /files` 응답에 `htmlFiles` 배열 포함 (`.html`/`.htm` 파일 목록)
- `GET /stats` 응답에 `totalHtmlFiles` 포함
- `POST /upload-html` — HTML 파일 업로드 (최대 5MB, `requireAuth`)
- `DELETE /html-file/:filename` — HTML 파일 삭제 (`requireAuth`)
- 뷰어: `public/include/view-html.html` — 샌드박스 iframe으로 렌더링, 새 탭 열기/삭제 지원
- 경로 보안: `safeHtmlPath()` — 루트 레벨만 허용, 서브디렉토리 탈출 불가

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Server listen port |
| `NODE_ENV` | `development` | Environment flag |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins (comma-separated) |
| `DATABASE_URL` | (필수) | PostgreSQL 연결 문자열 (Railway 자동 주입) |
| `JWT_SECRET` | `campcheck-dev-secret-change-in-prod` | **플랫폼 공통** JWT 서명 키. 프로덕션에서 기본값이면 기동 시 경고 로그 출력 |
| `PLATFORM_ADMIN_ID` | `admin` | `platform_accounts`가 비어있을 때 자동 생성되는 최초 admin 계정의 로그인ID (구 `CAMP_ADMIN_ID`도 폴백으로 인식) |
| `PLATFORM_ADMIN_PW` | `admin1234` | 위 admin 계정의 초기 비밀번호 — 최초 로그인 후 반드시 변경 |
| `MDBOARD_API_KEY` | (없음) | mdboard `/publish` API 키 (Claude Code 등 programmatic 접근용, 플랫폼 로그인과 무관) |
| `GOOGLE_SERVICE_ACCOUNT` | (없음) | travellog Drive 서비스 계정 JSON (base64) |
| `DRIVE_FOLDER_ID` | (없음) | travellog 사진 업로드 Drive 폴더 ID |
| `GDRIVE_CLIENT_ID` | (없음) | mdboard/campchecklist Drive OAuth2 클라이언트 ID |
| `GDRIVE_CLIENT_SECRET` | (없음) | mdboard/campchecklist Drive OAuth2 시크릿 |
| `GDRIVE_REFRESH_TOKEN` | (없음) | mdboard/campchecklist Drive OAuth2 리프레시 토큰 |
| `GDRIVE_FOLDER_ID` | (없음) | mdboard/campchecklist Drive 폴더 ID |
| `SMTP_HOST` | (없음) | 플랫폼 공통 메일 발송(`shared/mailer.js`) SMTP 호스트. 미설정 시 발송 시도는 실패로 로그만 남음 |
| `SMTP_PORT` | `587` | SMTP 포트 |
| `SMTP_SECURE` | `false` | `true`면 SMTPS(암시적 TLS) |
| `SMTP_USER` | (없음) | SMTP 인증 계정 |
| `SMTP_PASS` | (없음) | SMTP 인증 비밀번호 |
| `SMTP_FROM` | `SMTP_USER` 값 | 발신자 주소 |

### Deployment

Deployed on [Railway.app](https://railway.app) via NIXPACKS builder. Health check endpoint: `GET /health`. Start command: `node app.js`.
