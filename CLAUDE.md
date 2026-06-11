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

### Shared Utilities (`shared/utils.js`)

- `asyncHandler(fn)` — wraps async route handlers to forward errors to Express error middleware
- `ok(res, data, msg)` — standard `{ success: true, data, message }` response
- `fail(res, msg, status)` — standard `{ success: false, message }` error response

### Active Projects

| Prefix | Description | Notes |
|--------|-------------|-------|
| `/mdboard` | Markdown document platform | File CRUD + image upload via multer |
| `/portfolio` | Personal portfolio page builder | SPA mode; JSON file persistence |
| `/aptloan` | 아파트 대출 계산기 | SPA mode; 입주비용·중도금이자·대출 상환 시뮬레이터 |
| `/floorplan` | 평면도 그리기 | SPA mode; Google Drive 연동, 관리자 토큰 인증 |
| `/travellog` | 여행 계획 및 기록 관리 | SPA mode; 지도·계획·기록 기능 |

### Custom Routes (`config.customRoutes`)

`loader.js`는 SPA catch-all 이전에 특정 파일을 특정 경로로 서빙하는 `customRoutes`를 지원한다. 확장자 없는 URL로 특정 HTML 파일을 제공할 때 사용한다.

```js
// config.js 예시
customRoutes: [
  { path: '/studio', file: 'studio.html' },
]
```

### Authentication Pattern

mdboard와 portfolio 모두 동일한 인증 패턴을 사용한다.

**Backend (`index.js`)**
- `GET /<prefix>/api/auth/check` → `{ required: bool }` — 비밀번호 설정 여부
- `POST /<prefix>/api/auth` → `{ success, token }` — 비밀번호 검증 후 HMAC 토큰 반환
- 토큰: `HMAC-SHA256(password, '<project>-auth')` — 비밀번호 변경 시 자동 무효화
- `requireAuth` 미들웨어: `x-auth-token` 헤더 검증, `PASSWORD` 환경변수 미설정 시 통과

**Frontend**
- 토큰은 `localStorage`에 저장 (`mdboard_token`, `portfolio_token`)
- 모든 쓰기 API 요청에 `x-auth-token` 헤더 포함
- mdboard: `index.html` 헤더 우측 "인증하기" 버튼 → 인라인 입력창 → 인증됨 상태
- portfolio: `/portfolio/studio` 진입 시 전체 화면 오버레이로 비밀번호 입력

**보호 대상 엔드포인트**
- mdboard: `POST /save`, `DELETE /file/:name`, `POST /upload-image`
- portfolio: `POST /pages`, `PUT /pages/:id`, `DELETE /pages/:id`

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Server listen port |
| `NODE_ENV` | `development` | Environment flag |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins (comma-separated) |
| `MDBOARD_PASSWORD` | (없음) | mdboard 에디터 인증 비밀번호 |
| `PORTFOLIO_PASSWORD` | (없음) | portfolio `/studio` 관리자 인증 비밀번호 |
| `ADMIN_TOKENS` | (없음) | floorplan 관리자 토큰 (쉼표 구분, 복수 가능) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | `./credentials/gdrive-service-account.json` | floorplan Google Drive 서비스 계정 키 경로 |
| `GDRIVE_FOLDER_ID` | (없음) | floorplan Google Drive 저장 폴더 ID |
| `USE_LOCAL_FALLBACK` | `true` | floorplan Drive 미설정 시 로컬 파일 폴백 여부 |
| `LOCAL_DATA_DIR` | `./data` | floorplan 로컬 폴백 데이터 디렉토리 |

### Deployment

Deployed on [Railway.app](https://railway.app) via NIXPACKS builder. Health check endpoint: `GET /health`. Start command: `node app.js`.
