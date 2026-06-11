# 🏠 평면도 편집기 서버

## 구조

```
floorplan-server/
├── server.js              # Express 메인
├── config.js              # 환경설정 로더
├── .env                   # 환경변수 (직접 생성)
├── middleware/
│   └── auth.js            # 관리자 토큰 검증
├── routes/
│   ├── floorplans.js      # 평면도 CRUD API
│   └── categories.js      # 가구 카테고리 API
├── services/
│   ├── gdrive.js          # Google Drive 연동
│   ├── local.js           # 로컬 파일 저장 (폴백)
│   └── storage.js         # 저장소 추상화 (Drive/로컬 자동 선택)
└── public/
    └── index.html         # 클라이언트 편집기
```

## 설치 및 실행

```bash
npm install
cp .env.example .env
# .env 파일 편집 후:
npm start
```

## 환경설정 (.env)

```env
PORT=3000

# 관리자 토큰 (쉼표로 여러 개 설정 가능)
ADMIN_TOKENS=my-secret-token-1,another-token-2

# Google Drive (미설정 시 로컬 파일 사용)
GOOGLE_SERVICE_ACCOUNT_KEY=./credentials/gdrive-service-account.json
GDRIVE_FOLDER_ID=your-folder-id-here
```

## 권한 구조

| 기능 | 일반 사용자 | 관리자 |
|------|------------|--------|
| 기본 평면도 조회 | ✅ | ✅ |
| 가구 배치 | ✅ | ✅ |
| localStorage 저장 | ✅ | ✅ |
| 벽/방 그리기 | ❌ | ✅ |
| 서버 평면도 저장 | ❌ | ✅ |
| 카테고리 관리 | ❌ | ✅ |

## Google Drive 설정 방법

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. 새 프로젝트 생성 또는 기존 선택
3. **APIs & Services → Enable APIs** → Google Drive API 활성화
4. **IAM & Admin → Service Accounts** → 서비스 계정 생성
5. 서비스 계정 → **Keys → Add Key → JSON** → 다운로드
6. `credentials/gdrive-service-account.json` 으로 저장
7. Google Drive에서 폴더 생성 → 서비스 계정 이메일에 편집 권한 부여
8. 폴더 URL에서 ID 복사 → `.env`의 `GDRIVE_FOLDER_ID` 설정

## API 엔드포인트

```
GET    /api/floorplans          기본 평면도 목록 (공개)
GET    /api/floorplans/:id      평면도 조회 (공개)
POST   /api/floorplans          평면도 저장 (관리자)
PUT    /api/floorplans/:id      평면도 수정 (관리자)
DELETE /api/floorplans/:id      평면도 삭제 (관리자)

GET    /api/categories          가구 카테고리 목록 (공개)
PUT    /api/categories          전체 교체 (관리자)
POST   /api/categories          카테고리 추가 (관리자)
DELETE /api/categories/:id      카테고리 삭제 (관리자)
POST   /api/categories/:id/items    항목 추가 (관리자)
DELETE /api/categories/:id/items/:itemId  항목 삭제 (관리자)

POST   /api/auth/verify         토큰 검증
```

## Railway 배포

```bash
# Railway CLI
railway login
railway init
railway up
```

Railway 환경변수에 `.env` 내용을 동일하게 설정.  
`GOOGLE_SERVICE_ACCOUNT_KEY` 대신 `GOOGLE_SERVICE_ACCOUNT_JSON` 환경변수에  
서비스 계정 JSON 내용을 직접 붙여넣는 것을 권장 (파일 없이 배포 가능).

## 추후 개발 예정

- [ ] 일반 사용자 로그인 (JWT)
- [ ] 사용자별 저장 공간 분리
- [ ] 실시간 협업 (WebSocket)
