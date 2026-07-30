# Railway 환경변수 설정 가이드

> `railway.json`은 빌드/배포 설정(NIXPACKS, start command, healthcheck)만 담당하고 **비밀값은 절대 포함하지 않는다**.
> 환경변수는 Railway 대시보드에서 설정한다 — 코드/git에는 값이 남지 않는다.

## 설정 위치

Railway 대시보드 → 프로젝트 → **mono-server 서비스** 클릭 → **Variables** 탭

- 한 개씩 추가: **New Variable** 버튼
- 여러 개를 한 번에 넣기 (추천): 우측 상단 **Raw Editor** 클릭 → 아래 `KEY=VALUE` 블록을 통째로 붙여넣기 → **Save**
  (`.env` 형식 그대로 지원되고 `#` 주석 줄은 무시됨 — `.env.example`을 거의 그대로 붙여넣을 수 있음)

## 붙여넣기용 템플릿

실제 값으로 채워서 Raw Editor에 붙여넣으면 된다. `PORT`는 Railway가 자동 주입하므로 넣지 않아도 된다.

```env
NODE_ENV=production
ALLOWED_ORIGINS=https://your-domain.up.railway.app

# ── PostgreSQL ──────────────────────────────────────────────
# 이 프로젝트에 Postgres 플러그인을 추가했다면 아래처럼 "변수 참조"로 연결한다.
# (직접 접속 문자열을 입력하지 말 것 — 플러그인 쪽 값이 바뀌어도 자동으로 따라감)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# ── 플랫폼 통합 인증 (필수) ──────────────────────────────────
JWT_SECRET=아래 명령으로 생성한 랜덤 값으로 교체
PLATFORM_ADMIN_ID=admin
PLATFORM_ADMIN_PW=최초 로그인 후 반드시 admin 콘솔에서 변경할 임시 비밀번호

# ── 플랫폼 공통 메일 발송 (선택 — SMTP 쓸 때만) ────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=noreply@your-domain.com

# ── mdBoard programmatic 접근 (선택) ─────────────────────────
MDBOARD_API_KEY=your_api_key_here

# ── travellog Google Drive (선택) ────────────────────────────
GOOGLE_SERVICE_ACCOUNT=base64_encoded_service_account_json
DRIVE_FOLDER_ID=your_drive_folder_id

# ── mdboard/campchecklist Google Drive 동기화 (선택) ─────────
GDRIVE_CLIENT_ID=
GDRIVE_CLIENT_SECRET=
GDRIVE_REFRESH_TOKEN=
GDRIVE_FOLDER_ID=
```

`JWT_SECRET`은 아래처럼 로컬에서 생성해서 붙여넣는다:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 체크리스트

| 변수 | 없으면 어떻게 되나 |
|---|---|
| `DATABASE_URL` | 서버가 DB 마이그레이션/인증을 전부 건너뜀 — **필수** |
| `JWT_SECRET` | 기본값(`campcheck-dev-secret-change-in-prod`)으로 기동되고 시작 로그에 경고 출력, admin 콘솔 "시스템 점검" 탭에도 경고로 표시됨 — 프로덕션에서 반드시 교체 |
| `SMTP_*` | 메일 발송 기능이 항상 실패로 끝나고 `platform_mail_log`에 실패 기록만 쌓임 (서버는 정상 동작) |
| `MDBOARD_API_KEY` / `GOOGLE_SERVICE_ACCOUNT` / `GDRIVE_*` | 해당 기능(Claude 연동, Drive 백업)만 비활성 — 나머지 앱엔 영향 없음 |

## 배포 후 확인

1. `https://<도메인>/health` → `{"status":"ok"}`
2. `admin` 계정으로 로그인 → `/admin` → **시스템 점검** 탭에서 JWT_SECRET/SMTP 설정 상태 확인
3. SMTP를 설정했다면 **메일 발송** 탭에서 본인 이메일로 테스트 발송해서 실제 도착 확인
