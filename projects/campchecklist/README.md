# 🏕️ CampCheck

캠핑 참여자별 품목 관리, 체크리스트, 교차 점검 기능을 갖춘 팀 캠핑 짐 관리 도구입니다.  
Node.js + Express 단일 서버 구조로, 데이터는 로컬 JSON에 즉시 저장되고 **30초 배치 주기로 Google Drive에 자동 동기화**됩니다.

---

## 주요 기능

| 탭 | 기능 설명 |
|---|---|
| 📅 **일정** | 캠핑 일정 생성/수정/삭제 (출발·귀가일, 장소, 참여자, 메모) |
| 👤 **참여자** | 사용자 등록 (이름, 색상) / 삭제 |
| 🎒 **품목** | 참여자별 품목 마스터 관리 (카테고리·수량·단위·메모) |
| ✅ **체크리스트** | 일정+참여자별 **📋 챙길 예정 / ✅ 실제 챙김** 2단계 체크, 진행률 표시 |
| 🔍 **교차점검** | 참여자 진행률 카드 + **중복 품목 경고** + **미예정 카테고리 경고** + 전체 매트릭스 |

---

## 동기화 전략 (Google Drive)

```
데이터 변경 발생 (품목 추가, 체크 등)
    │
    ▼
로컬 data/*.json 즉시 저장  ← 응답 지연 없음
    │
    ▼ dirty 플래그 마킹
    │
   30초 인터벌 도달
    │
    ├─ dirty 파일 있음? → Drive Push (변경된 파일만)
    └─ dirty 없음?     → API 호출 없이 스킵
```

### 재배포/장애 복구 흐름

```
Railway 재배포 발생
    │
    ▼
server.js 기동 → pullFromDrive() 실행
    │
    ├─ Drive에 파일 있음 → 로컬 data/ 복원 완료 ✅
    └─ Drive에 파일 없음 → 빈 상태로 신규 시작 (최초 1회)
    │
    ▼
서버 Listen 시작 + 30초 인터벌 등록
```

### Graceful Shutdown

SIGTERM / SIGINT 수신 시 → **종료 전 강제 syncToDrive() 실행** → 미동기화 데이터 없이 종료

---

## 빠른 시작

```bash
git clone <repo>
cd camping-checklist
npm install
npm start
# → http://localhost:3000
```

개발 모드 (파일 변경 시 자동 재시작):
```bash
npm run dev
```

---

## Google Drive 연동 설정

### Step 1. Google Cloud 서비스 계정 생성

1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 생성 또는 선택
2. **API 및 서비스 → 라이브러리 → Google Drive API** 활성화
3. **IAM 및 관리자 → 서비스 계정 → 서비스 계정 만들기**
4. 서비스 계정 상세 → **키 → 키 추가 → JSON** 다운로드

### Step 2. Google Drive 폴더 설정

1. Google Drive에서 `camping-data` 폴더 생성
2. 폴더 공유 → 서비스 계정 이메일 (`...@...iam.gserviceaccount.com`) → **편집자** 권한
3. 폴더 URL에서 ID 복사:
   ```
   https://drive.google.com/drive/folders/1AbCdEfGhIj_FOLDER_ID_HERE
   ```

### Step 3. 환경변수 설정

**로컬 개발 (`.env` 파일)**:
```env
GDRIVE_FOLDER_ID=1AbCdEfGhIj_FOLDER_ID_HERE
GDRIVE_KEY={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com",...}
```

> **팁**: JSON을 환경변수로 저장 시 개행 문제가 발생하면 base64로 인코딩해서 저장 가능합니다.  
> 서버는 raw JSON과 base64 인코딩 모두 자동 감지합니다.
> ```bash
> base64 -i service-account-key.json | tr -d '\n'
> ```

**Railway 배포**:
- Dashboard → 프로젝트 → Variables 탭
- `GDRIVE_FOLDER_ID`, `GDRIVE_KEY` 각각 등록

### Step 4. 동기화 상태 확인

헤더 우측 배지에서 실시간 상태 확인 (10초 폴링):

| 배지 | 의미 |
|---|---|
| `☁️ HH:MM 동기화됨` | 마지막 동기화 성공 시각 |
| `🕐 대기 N건` | 30초 이내 동기화 예정 |
| `↻ 동기화 중...` | Drive Push 진행 중 |
| `⚠️ 동기화 오류` | Push 실패 (다음 주기 재시도) |

또는 API로 직접 확인:
```
GET /api/status
→ { driveEnabled, syncStatus, pendingChanges, lastSyncAt, syncIntervalSec }
```

---

## 프로젝트 구조

```
camping-checklist/
├── server.js           # Express API + Drive 동기화 로직
├── package.json
├── .gitignore          # data/ 폴더 GitHub 제외
├── public/
│   └── index.html      # SPA 프론트엔드 (Vanilla JS)
├── data/               # ← .gitignore 처리 / Drive 백업
│   ├── users.json
│   ├── items.json
│   ├── trips.json
│   └── checks.json
└── README.md
```

---

## 데이터 구조

```jsonc
// users.json
[{ "id": "uuid", "name": "홍길동", "color": "#3a5a40", "createdAt": "ISO" }]

// items.json
[{ "id": "uuid", "userId": "uuid", "name": "텐트", "category": "텐트/거처",
   "quantity": 1, "unit": "개", "note": "", "createdAt": "ISO" }]

// trips.json
[{ "id": "uuid", "name": "여름 계곡 캠핑", "startDate": "2025-07-25",
   "endDate": "2025-07-27", "location": "가평", "note": "",
   "participants": ["userId1", "userId2"], "createdAt": "ISO" }]

// checks.json
{
  "tripId": {
    "userId": {
      "itemId": { "planned": true, "packed": false }
    }
  }
}
```

---

## API 엔드포인트

```
GET    /api/status                         동기화 상태 조회
GET    /api/users                          참여자 목록
POST   /api/users                          참여자 등록
PUT    /api/users/:id                      참여자 수정
DELETE /api/users/:id                      참여자 삭제 (품목 연동 삭제)

GET    /api/items?userId=                  품목 목록 (userId 필터)
POST   /api/items                          품목 등록
PUT    /api/items/:id                      품목 수정
DELETE /api/items/:id                      품목 삭제

GET    /api/trips                          일정 목록
POST   /api/trips                          일정 등록
PUT    /api/trips/:id                      일정 수정
DELETE /api/trips/:id                      일정 삭제 (체크 데이터 연동 삭제)

GET    /api/trips/:tripId/checks           일정별 체크 상태 조회
PUT    /api/trips/:tripId/checks           체크 상태 업데이트
```

---

## Railway 배포

```bash
# Railway CLI
railway login
railway init
railway up
```

**환경변수 필수 등록** (Variables 탭):
```
PORT             → Railway 자동 주입
GDRIVE_FOLDER_ID → Google Drive 폴더 ID
GDRIVE_KEY       → 서비스 계정 JSON 전체 (또는 base64)
```

> **⚠️ 주의**: Railway Volume을 별도 마운트하지 않으면 Ephemeral Storage로 동작합니다.  
> 이 프로젝트는 서버 기동 시 Drive에서 자동 복원하므로 **Volume 없이도 데이터 보존이 가능합니다.**
> 단, SIGTERM 없이 강제 종료 시 마지막 30초 이내 변경사항이 유실될 수 있습니다.

---

## 로컬 전용 모드

`GDRIVE_KEY`/`GDRIVE_FOLDER_ID` 환경변수 없이 실행하면 Drive 연동 없이 로컬 파일만 사용합니다.  
헤더 동기화 배지가 표시되지 않으며, 모든 기능은 정상 작동합니다.
