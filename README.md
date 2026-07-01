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
    └── mindmap/              # 마인드맵
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
| `/mdboard` | 📝 mdBoard | Markdown 문서 플랫폼 — 폴더 분류, CRUD, 이미지/HTML 업로드, Marp 내보내기, Google Drive 백업 | 파일시스템 |
| `/portfolio` | 포트폴리오 | 개인 포트폴리오 페이지 빌더 (SPA) | PostgreSQL |
| `/aptloan` | 🏠 아파트 대출 계산기 | 입주비용·중도금이자·대출 상환 시뮬레이터 (SPA) | — |
| `/floorplan` | 🌐 평면도 | 평면도 그리기 — 관리자 토큰 인증, Google Drive 저장 (SPA) | PostgreSQL |
| `/travellog` | 여행로그 | 여행 계획 및 기록 관리 — 사진은 Google Drive (SPA) | PostgreSQL |
| `/campchecklist` | 🏕️ CampCheck | 캠핑 짐 체크리스트 — 참여자별 품목 관리, 게시판, JWT 인증 | PostgreSQL |
| `/mindmap` | 마인드맵 | 노드 기반 마인드맵 — 팬/줌, 인라인 편집, 다중 선택, Undo/Redo, HTML/PDF 내보내기 | PostgreSQL |

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
| `MDBOARD_API_KEY` | (없음) | mdboard-push 스크립트 API 키 |
| `MDBOARD_URL` | `http://localhost:3000` | mdboard-push 대상 서버 URL |
| `PORTFOLIO_PASSWORD` | (없음) | portfolio 관리자 인증 비밀번호 |
| `FLOORPLAN_ADMIN_TOKENS` | (없음) | floorplan 관리자 토큰 (우선순위 높음) |
| `ADMIN_TOKENS` | (없음) | floorplan 관리자 토큰 폴백 (쉼표 구분) |
| `JWT_SECRET` | `campcheck-dev-secret-change-in-prod` | campchecklist JWT 서명 키 |
| `CAMP_ADMIN_ID` | `admin` | campchecklist 관리자 로그인 ID |
| `GOOGLE_SERVICE_ACCOUNT` | (없음) | travellog Drive 서비스 계정 JSON (base64) |
| `DRIVE_FOLDER_ID` | (없음) | travellog 사진 업로드 Drive 폴더 ID |
| `GDRIVE_CLIENT_ID` | (없음) | mdboard/campchecklist Drive OAuth2 클라이언트 ID |
| `GDRIVE_CLIENT_SECRET` | (없음) | mdboard/campchecklist Drive OAuth2 시크릿 |
| `GDRIVE_REFRESH_TOKEN` | (없음) | mdboard/campchecklist Drive OAuth2 리프레시 토큰 |
| `GDRIVE_FOLDER_ID` | (없음) | mdboard/campchecklist Drive 폴더 ID |

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

### Claude Code vs Claude Desktop

| 환경 | 사용 가능 여부 | 조건 |
|------|--------------|------|
| **Claude Code (CLI)** | ✅ 바로 사용 가능 | `.env`에 `MDBOARD_API_KEY` 설정 |
| **Claude Desktop** | ❌ 추가 설정 필요 | MCP 파일시스템 서버 구성 필요 |

> Claude Code는 `.claude/skills/mdboard-publish.md` 스킬을 자동으로 인식하므로,  
> 대화 중 "mdboard에 등록해줘"라고 하면 파일명·폴더 제안 → 등록까지 자동 처리됩니다.
