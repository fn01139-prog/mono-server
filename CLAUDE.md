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

# DB 마이그레이션 (테이블 생성, 최초 1회)
node scripts/migrate.js

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
| `/mdboard` | Markdown document platform | 폴더 분류; 파일 CRUD + 이미지 업로드(multer); Marp HTML/PDF 내보내기; Google Drive 백업 |
| `/portfolio` | Personal portfolio page builder | SPA mode; **PostgreSQL** (`portfolio_pages`) |
| `/aptloan` | 아파트 대출 계산기 | SPA mode; 입주비용·중도금이자·대출 상환 시뮬레이터 |
| `/floorplan` | 평면도 그리기 | SPA mode; **PostgreSQL** (`floorplan_templates`, `floorplan_categories`); 관리자 토큰 인증 |
| `/travellog` | 여행 계획 및 기록 관리 | SPA mode; **PostgreSQL** (`travel_*`); 사진 파일은 Google Drive |
| `/campchecklist` | 캠핑 체크리스트 | JWT 인증; **PostgreSQL** (`camp_*`) |

### Custom Routes (`config.customRoutes`)

`loader.js`는 SPA catch-all 이전에 특정 파일을 특정 경로로 서빙하는 `customRoutes`를 지원한다. 확장자 없는 URL로 특정 HTML 파일을 제공할 때 사용한다.

```js
// config.js 예시
customRoutes: [
  { path: '/studio', file: 'studio.html' },
]
```

### Authentication Pattern

프로젝트별로 두 가지 인증 패턴이 사용된다.

#### 패턴 A — HMAC 비밀번호 토큰 (mdboard, portfolio)

**Backend (`index.js`)**
- `GET /<prefix>/api/auth/check` → `{ required: bool }` — 비밀번호 설정 여부
- `POST /<prefix>/api/auth` → `{ success, token }` — 비밀번호 검증 후 HMAC 토큰 반환
- 토큰: `HMAC-SHA256(password, '<project>-auth')` — 비밀번호 변경 시 자동 무효화
- `requireAuth` 미들웨어: `x-auth-token` 헤더 검증, `PASSWORD` 환경변수 미설정 시 통과

**Frontend**
- 토큰은 `localStorage`에 저장 (`mdboard_token`, `portfolio_token`)
- 모든 쓰기 API 요청에 `x-auth-token` 헤더 포함

**보호 대상 엔드포인트**
- mdboard: `POST /save`, `DELETE /file/*`, `POST /upload-image`
- portfolio: `POST /pages`, `PUT /pages/:id`, `DELETE /pages/:id`

#### 패턴 B — 원시 토큰 (floorplan)

**Backend (`index.js`)**
- `GET /auth/check` → `{ ok, required: bool }` — 토큰 설정 여부
- `POST /auth/verify` → `{ ok, isAdmin: bool }` — 토큰 일치 여부 확인
- `requireAdmin` 미들웨어: `x-admin-token` 헤더 검증, 토큰 미설정 시 통과
- 환경변수 `FLOORPLAN_ADMIN_TOKENS` 또는 `ADMIN_TOKENS` (쉼표 구분 복수 가능)

**Frontend**
- 로그인 모달에서 토큰 입력 → `POST /api/auth/verify` 호출
- `isAdmin = true` 시 벽/방/문 그리기 도구 활성화, 서버 저장 탭 표시
- 관리자일 때 빈 캔버스 오버레이("평면도를 선택해주세요") 숨김 처리

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

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Server listen port |
| `NODE_ENV` | `development` | Environment flag |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins (comma-separated) |
| `DATABASE_URL` | (필수) | PostgreSQL 연결 문자열 (Railway 자동 주입) |
| `MDBOARD_PASSWORD` | (없음) | mdboard 에디터 인증 비밀번호 |
| `PORTFOLIO_PASSWORD` | (없음) | portfolio `/studio` 관리자 인증 비밀번호 |
| `FLOORPLAN_ADMIN_TOKENS` | (없음) | floorplan 관리자 토큰 (우선순위 높음) |
| `ADMIN_TOKENS` | (없음) | floorplan 관리자 토큰 폴백 (쉼표 구분, 복수 가능) |
| `JWT_SECRET` | `campcheck-dev-secret-change-in-prod` | campchecklist JWT 서명 키 |
| `GOOGLE_SERVICE_ACCOUNT` | (없음) | travellog Drive 서비스 계정 JSON (base64) |
| `DRIVE_FOLDER_ID` | (없음) | travellog 사진 업로드 Drive 폴더 ID |
| `GDRIVE_CLIENT_ID` | (없음) | mdboard/campchecklist Drive OAuth2 클라이언트 ID |
| `GDRIVE_CLIENT_SECRET` | (없음) | mdboard/campchecklist Drive OAuth2 시크릿 |
| `GDRIVE_REFRESH_TOKEN` | (없음) | mdboard/campchecklist Drive OAuth2 리프레시 토큰 |
| `GDRIVE_FOLDER_ID` | (없음) | mdboard/campchecklist Drive 폴더 ID |

### Deployment

Deployed on [Railway.app](https://railway.app) via NIXPACKS builder. Health check endpoint: `GET /health`. Start command: `node app.js`.
