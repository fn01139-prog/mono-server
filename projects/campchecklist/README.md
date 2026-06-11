# 🏕️ CampCheck 개발 노트

> 프로젝트: `projects/campchecklist/`
> 서비스 URL: `https://fn0113.up.railway.app/campchecklist/`

---

## 📅 Day 1 — 2026-05-16

### 구현 기능

| 탭 | 내용 |
|---|---|
| 📅 일정 | 캠핑 일정 생성/수정/삭제 (출발·귀가일, 장소, 참여자, 메모) |
| 👤 참여자 | 사용자 등록/수정/삭제 (이름, 색상) |
| 🎒 품목 | 참여자별 품목 마스터 관리 (10개 카테고리) |
| ✅ 체크리스트 | 일정+참여자별 📋 챙길 예정 / ✅ 실제 챙김 2단계 체크 + 진행률 |
| 🔍 교차점검 | 참여자 진행률 카드 + 중복 경고 + 미예정 카테고리 경고 + 매트릭스 |

### 데이터 구조

```
data/
├── users.json    [{ id, name, color, createdAt }]
├── items.json    [{ id, userId, name, category, quantity, unit, note }]
├── trips.json    [{ id, name, startDate, endDate, location, participants[] }]
└── checks.json   { tripId: { userId: { itemId: { planned, packed } } } }
```

### Google Drive 30초 배치 동기화

- `db.write()` → 로컬 즉시 저장 + `dirty` 마킹
- 30초 인터벌: dirty 파일만 Drive Push (변경 없으면 스킵)
- 서버 기동 시 Drive Pull → 로컬 복원 (재배포 데이터 보존)
- SIGTERM 수신 시 종료 전 강제 동기화

### 모노서버 연동 (loader.js 구조)

```
loader.js:
  app.use('/campchecklist',     express.static('public/'))
  app.use('/campchecklist/api', require('./index.js'))   ← Router export

index.js:
  router.get('/status')    → GET /campchecklist/api/status
  router.get('/users')     → GET /campchecklist/api/users
  ...
```

- 서브경로: `window.location.pathname` 자동 감지 (하드코딩 없음)
- `require()` 시 자동 초기화 (모노서버 코드 수정 불필요)

### 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `/api/status` 404 | `index.js`에서 `/api` 접두사 중복 | loader가 이미 `/api` 붙임 → Router는 `/status`만 등록 |
| 재배포 시 데이터 초기화 | Railway Ephemeral Storage | 기동 시 Drive Pull로 자동 복원 |
| `BASE_PATH` 불일치 | 서브경로 하드코딩 | `window.location.pathname` 자동 감지 |

---

## 📅 Day 2 — 2026-05-17

### 구현 기능

#### 계정 & 권한 시스템

| 파일 | 내용 |
|---|---|
| `accounts.json` | `{ userId, loginId, pwHash, role, createdAt, lastLoginAt }` |
| `bcryptjs` | 비밀번호 해시 (네이티브 컴파일 없는 순수 JS 구현체) |
| `jsonwebtoken` | JWT 30일 만료, localStorage 저장 |

**권한 매트릭스**

| 기능 | 비로그인 | 일반 | 관리자 |
|---|---|---|---|
| 조회 (전체) | ✅ | ✅ | ✅ |
| 일정 생성 | ❌ | ✅ + 이력 | ✅ |
| 일정 수정 | ❌ | ✅ + 이력 | ✅ |
| 일정 삭제 | ❌ | 취소처리 (메모에 [취소됨]) | 실제 삭제 |
| 일정 참여/탈퇴 | ❌ | 본인만 | ✅ |
| 품목 등록/수정 | ❌ | 본인만 | ✅ |
| 체크리스트 수정 | ❌ | 본인만 | ✅ |
| 댓글 작성 | ❌ | ✅ | ✅ |
| 댓글 수정 | ❌ | 본인만 | ✅ |
| 댓글 삭제 | ❌ | ❌ | ✅ (하위 포함) |

- 관리자 지정: `config.js`의 `adminLoginId` (환경변수 `CAMP_ADMIN_ID` 우선)
- 헤더 우측 드롭다운 로그인 UI (ID/PW 입력)
- 이력 추적: 일정 생성/수정 시 `{ userId, name, action, at }` 배열 누적

#### 게시판 (댓글형 후기)

```
comments.json
[{ id, tripId, parentId, depth(0~2), authorId, authorName, content, createdAt, edited }]
```

- 💬 후기 탭 신설 — 일정 선택 후 댓글 스레드 표시
- 3차 대댓글(depth 0→1→2)까지 지원, Flat 구조로 저장
- 댓글 삭제 시 하위 댓글 전체 연쇄 삭제 (admin만)
- 댓글 수정 시 `(수정됨)` 표시

#### Lazy Init (healthcheck 문제 해결)

```
기존: require() 시 pullFromDrive() 즉시 실행 → healthcheck 타임아웃 가능
변경: 첫 API 요청 시 ensureInit() → _driveReady 대기 → pullFromDrive()
```

- Drive 초기화 완료 전에도 서버는 즉시 응답 (healthcheck ✅)
- 실패 시 `_initPromise = null` → 다음 요청에서 자동 재시도

#### Google Drive OAuth2 전환 (서비스 계정 → 개인 계정)

**서비스 계정 문제점 → 해결**

| 문제 | 해결 |
|---|---|
| 저장 쿼터 없음 (403) | OAuth2: 파일 소유권이 본인 구글 계정 |
| clock skew 인증 실패 | OAuth2: googleapis 토큰 자동 갱신 |
| JSON 파싱 오류 | OAuth2: 환경변수 3개로 단순화 |
| top-level await 에러 | Drive 초기화를 IIFE Promise로 감싸 CJS 호환 |

**Railway 환경변수 (현재)**

```
GDRIVE_CLIENT_ID     = xxx.apps.googleusercontent.com
GDRIVE_CLIENT_SECRET = GOCSPX-xxx
GDRIVE_REFRESH_TOKEN = 1//xxx...
GDRIVE_FOLDER_ID     = 폴더ID
CAMP_ADMIN_ID        = 관리자로그인ID
JWT_SECRET           = 랜덤문자열
```

**토큰 발급 (1회)**

```bash
node get-token.js
# 브라우저 인증 → 터미널에 REFRESH_TOKEN 출력
# Google Cloud Console → OAuth 동의 화면 → 테스트 사용자 등록 필수
```

### API 엔드포인트 전체

```
GET    /api/status

POST   /api/auth/register   { name, loginId, password }
POST   /api/auth/login      { loginId, password }
GET    /api/auth/me

GET    /api/users
POST   /api/users           (admin)
PUT    /api/users/:id       (admin)
DELETE /api/users/:id       (admin)

GET    /api/items?userId=
POST   /api/items           (로그인, 본인)
PUT    /api/items/:id       (로그인, 본인 or admin)
DELETE /api/items/:id       (로그인, 본인 or admin)

GET    /api/trips
POST   /api/trips           (로그인)
PUT    /api/trips/:id       (로그인)
DELETE /api/trips/:id       (admin)
PUT    /api/trips/:id/join  (로그인 — 참여)
DELETE /api/trips/:id/join  (로그인 — 탈퇴)

GET    /api/trips/:tripId/checks
PUT    /api/trips/:tripId/checks  (로그인, 본인 or admin)

GET    /api/comments?tripId=
POST   /api/comments        (로그인)
PUT    /api/comments/:id    (로그인, 본인 or admin)
DELETE /api/comments/:id    (admin)
```

### 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `Cannot find module 'bcrypt'` | Railway에서 네이티브 컴파일 실패 | `bcryptjs`(순수 JS)로 교체 |
| `npm ci` 실패 (lock file 불일치) | package.json 변경 후 lock 미갱신 | 로컬 `npm install` 후 lock 파일 push |
| `ERR_REQUIRE_ASYNC_MODULE` | Drive 초기화에 top-level await 사용 | IIFE Promise로 감싸 CJS 호환 |
| `Unexpected end of JSON input` | Railway 환경변수에 JSON 직접 붙여넣기 시 손상 | OAuth2로 전환 (JSON 불필요) |
| 서비스 계정 403 쿼터 오류 | 서비스 계정은 개인 Drive에 파일 생성 불가 | OAuth2 Refresh Token으로 전환 |
| OAuth 403 access_denied | OAuth 동의 화면 테스트 사용자 미등록 | Google Cloud Console → 테스트 사용자 추가 |
| healthcheck 빨간불 | Drive Pull이 서버 시작을 블로킹 | Lazy Init 도입 (첫 요청 시 초기화) |

---

## 🚀 다음 개발 예정

### 🔜 Next — 품목 자동완성

> 같은 품목을 반복 등록하는 중복 데이터 문제 해결

**목표**: 품목명 입력 시 해당 사용자가 과거에 등록했던 품목명을 자동완성으로 제안

**구현 방향**

```
현재 items.json에 이미 품목 마스터가 존재
    ↓
품목명 input에 datalist 또는 드롭다운 연결
    ↓
같은 카테고리 내 기존 품목명 필터링하여 제안
    ↓
선택 시 수량/단위/메모까지 자동 채움 (옵션)
```

**세부 구현 항목**
- [ ] 품목 추가 폼의 `품목명` input에 자동완성 UI 연결
  - 같은 사용자의 기존 품목명 우선
  - 전체 참여자의 품목명 풀도 참고 (카테고리 기준)
- [ ] 기존 품목 선택 시 수량/단위 자동 채움
- [ ] 중복 등록 방지: 같은 이름+카테고리 품목이 이미 있으면 경고
- [ ] API: `GET /api/items/suggestions?userId=&category=&q=` 추가
  - 입력 글자에 맞는 품목명 목록 반환 (prefix 매칭)

**고려 사항**
- HTML `<datalist>` 기본 기능 활용 vs 커스텀 드롭다운 구현
- 자동완성 선택 후 수량/단위까지 채울 경우 UX 흐름 설계 필요
- 전체 참여자 품목 공유 풀을 만들 경우 개인정보 노출 여부 결정

### Phase 3 — Google Calendar 연동

- [ ] 일정 생성 시 Google Calendar 이벤트 자동 추가
- [ ] 출발 D-7, D-1 리마인드 알림
- [ ] 현재 OAuth2 토큰을 Calendar API에도 재사용 (scope 추가)

### Phase 4 — 사진 첨부

- [ ] 후기 댓글에 사진 첨부 (저장소 방식 결정 후 진행)
  - Google Drive 업로드 (현재 OAuth2 재사용 가능)
  - 또는 외부 이미지 호스팅 서비스 연계

---

## 📌 기술 스택

| 구분 | 내용 |
|---|---|
| 백엔드 | Node.js + Express (`express.Router`) |
| 프론트엔드 | Vanilla JS SPA (`public/index.html`) |
| 인증 | JWT (30일) + bcryptjs 해시 |
| 데이터 저장 | 로컬 JSON + Google Drive 30초 배치 동기화 |
| Drive 인증 | OAuth2 Refresh Token (개인 계정) |
| 배포 | Railway (`https://fn0113.up.railway.app`) |
| 모노서버 | `core/loader.js` 자동 마운트 구조 |

## 📁 프로젝트 파일 구조

```
campchecklist/
├── config.js        # loader.js 설정 (prefix, adminLoginId)
├── index.js         # Express Router + 전체 API
├── get-token.js     # OAuth2 refresh_token 발급 (1회 로컬 실행)
├── package.json     # bcryptjs, googleapis, jsonwebtoken
├── .gitignore       # data/ 제외
├── public/
│   └── index.html   # SPA (로그인·권한·댓글 포함)
└── data/            # Git 미포함, Drive 백업
    ├── users.json
    ├── items.json
    ├── trips.json
    ├── checks.json
    ├── accounts.json
    └── comments.json
```
