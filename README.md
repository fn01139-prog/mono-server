# Yu's Mono-Server

> mdBoard, 마인드맵, 포트폴리오 등 여러 프로젝트를 하나의 Node.js 서버로 운영하는 모노서버

배포 주소: **https://fn0113.up.railway.app**

---

## 📁 폴더 구조

```
mono-server/
├── app.js                    # 메인 진입점
├── ecosystem.config.js       # PM2 설정
├── core/
│   └── loader.js             # 프로젝트 자동 로딩 엔진
├── shared/
│   └── utils.js              # 공통 유틸 (asyncHandler, ok, fail)
├── scripts/
│   ├── migrate.js            # DB 테이블 생성 (최초 1회)
│   ├── seed.js               # JSON → PostgreSQL 시딩 (최초 1회)
│   └── mdboard-push.js       # md 파일을 mdboard에 직접 등록
└── projects/
    ├── _template/            # 새 프로젝트 템플릿 (enabled: false)
    ├── mdboard/              # Markdown 문서 플랫폼
    ├── portfolio/            # 개인 포트폴리오 빌더
    ├── aptloan/              # 아파트 대출 계산기
    ├── floorplan/            # 평면도 그리기
    ├── travellog/            # 여행 계획 및 기록 관리
    ├── campchecklist/        # 캠핑 체크리스트
    ├── mindmap/              # 마인드맵
    └── location/             # 시간별 위치 일정 (음성 등록 → 공유 링크)
```

---

## 🚀 실행

```bash
npm install
cp .env.example .env

# DB 마이그레이션 (테이블 생성, 최초 1회)
node scripts/migrate.js

# 기존 JSON → PostgreSQL 시딩 (최초 1회)
node scripts/seed.js

# 개발 (nodemon 자동 재시작)
npm run dev

# 운영
npm start          # node app.js
npm run pm2        # PM2 프로세스 매니저
```

---

## 📦 활성 프로젝트

| 경로 | 이름 | 설명 | DB |
|------|------|------|----|
| `/mdboard` | 📝 mdBoard | Markdown 문서 플랫폼 — 폴더 분류, CRUD, 이미지/HTML 업로드, Marp 내보내기, Railway 볼륨 저장 + Google Drive 월간 백업 | 파일시스템(볼륨) |
| `/portfolio` | 포트폴리오 | 개인 포트폴리오 페이지 빌더 (SPA) | PostgreSQL |
| `/aptloan` | 🏠 아파트 대출 계산기 | 입주비용·중도금이자·대출 상환 시뮬레이터 (SPA) | — |
| `/floorplan` | 🌐 평면도 | 평면도 그리기 — 관리자 토큰 인증, Google Drive 저장 (SPA) | PostgreSQL |
| `/travellog` | 여행로그 | 여행 계획 및 기록 관리 — 사진은 Google Drive (SPA) | PostgreSQL |
| `/campchecklist` | 🏕️ CampCheck | 캠핑 짐 체크리스트 — 참여자별 품목 관리, 게시판, JWT 인증 | PostgreSQL |
| `/mindmap` | 마인드맵 | 노드 기반 마인드맵 — 팬/줌, 인라인 편집, 다중 선택, Undo/Redo, HTML/PDF 내보내기 | PostgreSQL |
| `/location` | 📍 위치 일정 | 시간별 위치 일정 — Claude 앱 음성 입력(원격 MCP)으로 등록, 공유 링크(`/location/s/:token`)를 문자/카톡으로 발송 | PostgreSQL |

---

## 🌐 URL 구조

| 경로 | 설명 |
|------|------|
| `/` | 앱 허브 (등록된 프로젝트 목록) |
| `/health` | 서버 헬스체크 |
| `/<prefix>` | 프로젝트 정적 파일 (public/) |
| `/<prefix>/api/*` | 프로젝트 API 라우터 |

---

## ➕ 새 프로젝트 추가

```bash
# 1. 폴더 복사
cp -r projects/_template projects/my-new-app

# 2. config.js 수정 (name, prefix, description, icon, enabled: true)

# 3. index.js 에 Express Router 작성
#    ※ 라우트 경로에 /api/ 접두사 금지 — loader.js가 이미 /<prefix>/api 에 마운트함

# 4. public/ 에 프론트엔드 파일 추가 (선택)

# 5. 서버 재시작
pm2 restart mono-server
```

---

## 🗄️ 환경변수

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `NODE_ENV` | `development` | 환경 플래그 |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS 허용 도메인 (쉼표 구분) |
| `DATABASE_URL` | (필수) | PostgreSQL 연결 문자열 |
| `MDBOARD_PASSWORD` | (없음) | mdboard 에디터 인증 비밀번호 |
| `MDBOARD_API_KEY` | (없음) | mdboard-push 스크립트 / mdboard MCP 서버 / `/publish`·`/publish-html` API 키 |
| `MDBOARD_URL` | `http://localhost:3000` | mdboard-push·mdboard MCP 서버 대상 서버 URL |
| `PORTFOLIO_PASSWORD` | (없음) | portfolio 관리자 인증 비밀번호 |
| `FLOORPLAN_ADMIN_TOKENS` | (없음) | floorplan 관리자 토큰 (우선순위 높음) |
| `ADMIN_TOKENS` | (없음) | floorplan 관리자 토큰 폴백 (쉼표 구분) |
| `JWT_SECRET` | `campcheck-dev-secret-change-in-prod` | campchecklist JWT 서명 키 |
| `CAMP_ADMIN_ID` | `admin` | campchecklist 관리자 로그인 ID |
| `GOOGLE_SERVICE_ACCOUNT` | (없음) | travellog Drive 서비스 계정 JSON (base64) |
| `DRIVE_FOLDER_ID` | (없음) | travellog 사진 업로드 Drive 폴더 ID |
| `MDBOARD_CONTENTS_DIR` | `/data/contents/mdboard` | mdboard 콘텐츠 저장 경로 (Railway 볼륨 마운트 경로) |
| `GDRIVE_CLIENT_ID` | (없음) | mdboard Drive 백업용 OAuth2 클라이언트 ID |
| `GDRIVE_CLIENT_SECRET` | (없음) | mdboard Drive 백업용 OAuth2 시크릿 |
| `GDRIVE_REFRESH_TOKEN` | (없음) | mdboard Drive 백업용 OAuth2 리프레시 토큰 |
| `MDBOARD_FOLDER_ID` | (없음) | mdboard 전용 Drive 백업 폴더 ID |

---

## 🚂 Railway 배포

1. GitHub에 push → Railway 자동 배포 (NIXPACKS 빌더)
2. 환경변수는 Railway 대시보드에서 설정 (`PORT`는 자동 주입)
3. 헬스체크: `GET /health`

```js
// 외부에서 API 호출 시
const API = 'https://fn0113.up.railway.app';
fetch(`${API}/mdboard/api/docs`);
```

---

## 📝 mdboard-push — Claude에서 md 파일 직접 등록

Claude Code(CLI)에서 정리한 마크다운을 mdboard에 바로 올릴 수 있습니다.

### 설정

`.env` 및 Railway 환경변수에 추가:
```
MDBOARD_API_KEY=your_api_key_here
MDBOARD_URL=https://fn0113.up.railway.app
```

### 사용법

```bash
# 기본 (루트에 저장)
node scripts/mdboard-push.js ./report.md

# 폴더 지정
node scripts/mdboard-push.js ./report.md "월간리포트"

# 덮어쓰기
node scripts/mdboard-push.js ./report.md "월간리포트" --overwrite
```

### REST API 직접 호출

```http
POST /mdboard/api/publish
x-api-key: your_api_key_here
Content-Type: application/json

{
  "title": "파일명.md",
  "content": "# 제목\n\n내용...",
  "folder": "폴더명",
  "overwrite": false
}
```

HTML 문서를 올릴 때는 `/publish-html`을 사용합니다(콘텐츠 루트에만 저장, 서브폴더 없음):

```http
POST /mdboard/api/publish-html
x-api-key: your_api_key_here
Content-Type: application/json

{
  "title": "파일명.html",
  "content": "<!DOCTYPE html>...",
  "overwrite": false
}
```

## 🔌 mdboard MCP 서버 — Claude Desktop 등에서 바로 등록

`scripts/mdboard-mcp-server.js`는 위 퍼블리시 API를 감싼 MCP(Model Context Protocol) stdio 서버입니다. MCP를 지원하는 클라이언트(Claude Desktop, Claude Code 등)에 등록해두면 블로그용으로 정리한 마크다운/HTML을 대화 중 바로 mdboard에 반영할 수 있습니다 — 파일 저장, CLI 실행, 별도 파일시스템 MCP 서버 구성이 모두 필요 없습니다.

**제공 툴**
- `mdboard_publish_markdown` — `{ title, content, folder?, overwrite? }`
- `mdboard_publish_html` — `{ title, content, overwrite? }`
- `mdboard_list_folders` — 등록된 폴더 목록 조회

**Claude Desktop 설정** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "mdboard": {
      "command": "node",
      "args": ["/absolute/path/to/mono-server/scripts/mdboard-mcp-server.js"],
      "env": {
        "MDBOARD_URL": "https://fn0113.up.railway.app",
        "MDBOARD_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Claude Code 설정**:
```bash
claude mcp add mdboard -- node /absolute/path/to/mono-server/scripts/mdboard-mcp-server.js
# 이후 MDBOARD_URL / MDBOARD_API_KEY 환경변수를 설정된 셸에서 실행하거나 .mcp.json의 env에 추가
```

### Claude Code vs Claude Desktop

| 환경 | 사용 가능 여부 | 방법 |
|------|--------------|------|
| **Claude Code (CLI)** | ✅ 바로 사용 가능 | `.env`에 `MDBOARD_API_KEY` 설정 후 `scripts/mdboard-push.js` 또는 `mdboard-publish` 스킬 |
| **Claude Desktop / MCP 클라이언트 전반** | ✅ MCP 서버 등록만 하면 사용 가능 | 위 `mdboard-mcp-server.js`를 `mcpServers`에 등록 |

> Claude Code는 `.claude/skills/mdboard-publish.md` 스킬을 자동으로 인식하므로,  
> 대화 중 "mdboard에 등록해줘"라고 하면 파일명·폴더 제안 → 등록까지 자동 처리됩니다.
