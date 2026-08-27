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

# ── 플랫폼 공통 메일 발송 (선택 — 메일 기능 쓸 때만) ─────────────
# Railway는 아웃바운드 SMTP 포트(25/465/587/2525)를 막아둬서 raw SMTP는 항상
# Connection timeout으로 실패한다. Brevo REST API(HTTPS 443)로 발송하므로 SMTP_HOST/PORT
# 등은 필요 없고 아래 두 변수만 있으면 된다.
BREVO_API_KEY=xkeysib-발급받은_API_키
SMTP_FROM=noreply@your-domain.com

# ── 플랫폼 공통 메신저 알림 (선택 — 알림 기능 쓸 때만) ─────────────
# 수신자별 chat_id/webhook URL/Discord User ID/topic은 env가 아니라 admin 콘솔(알림 탭)에서 등록한다.
# 텔레그램/디스코드 DM만 봇 토큰이 전역으로 필요하고, 디스코드(웹훅)/ntfy는 전역 설정 불필요.
TELEGRAM_BOT_TOKEN=123456:ABC-your-bot-token
# DISCORD_BOT_TOKEN=your-bot-token
# 웹푸시는 브라우저 구독 UI가 아직 없어 당장은 설정 안 해도 됨
# VAPID_SUBJECT=mailto:you@example.com
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=

# ── mdBoard programmatic 접근 (선택) ─────────────────────────
MDBOARD_API_KEY=your_api_key_here

# ── mdBoard 콘텐츠 저장 경로 (Railway 볼륨) ───────────────────
# Railway 대시보드 → 서비스 → Volumes 탭에서 마운트 경로를 /data 로 지정해두면 기본값 그대로 쓰면 됨.
# MDBOARD_CONTENTS_DIR=/data/contents/mdboard

# ── travellog Google Drive (선택) ────────────────────────────
GOOGLE_SERVICE_ACCOUNT=base64_encoded_service_account_json
DRIVE_FOLDER_ID=your_drive_folder_id

# ── mdboard Google Drive 백업 (선택 — 월 1회 배치잡용) ────────
GDRIVE_CLIENT_ID=
GDRIVE_CLIENT_SECRET=
GDRIVE_REFRESH_TOKEN=
MDBOARD_FOLDER_ID=
```

`JWT_SECRET`은 아래처럼 로컬에서 생성해서 붙여넣는다:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`BREVO_API_KEY`는 Brevo 대시보드 → **Settings → SMTP & API → API Keys 탭**에서 발급받는다
(SMTP 탭의 "SMTP 키"와는 다른 값이므로 혼동하지 말 것 — HTTP API는 API Keys 탭 값을 쓴다).
`SMTP_FROM`에 넣을 주소는 **Senders, Domains & Dedicated IPs** 메뉴에서 미리 인증해둬야 한다.

`TELEGRAM_BOT_TOKEN`은 텔레그램에서 **@BotFather**와 대화해 `/newbot`으로 봇을 만들면 발급된다.
채널 연결(수신자의 chat_id 등록)은 배포 후 admin 콘솔 → **알림** 탭에서 한다.

`DISCORD_BOT_TOKEN`은 `https://discord.com/developers/applications`에서 애플리케이션 생성 → Bot 탭에서
봇을 추가하면 발급된다. 봇으로 DM을 보내려면 봇과 수신자가 같은 서버(길드)에 있어야 하므로, 본인 전용
비공개 서버를 하나 만들어 봇과 알림 받을 사람들을 함께 초대해둔다(자세한 절차는 `TODO.md` 참고).
채널 연결(수신자의 Discord User ID 등록)은 배포 후 admin 콘솔 → **알림** 탭에서 한다.

## 체크리스트

| 변수 | 없으면 어떻게 되나 |
|---|---|
| `DATABASE_URL` | 서버가 DB 마이그레이션/인증을 전부 건너뜀 — **필수** |
| `JWT_SECRET` | 기본값(`campcheck-dev-secret-change-in-prod`)으로 기동되고 시작 로그에 경고 출력, admin 콘솔 "시스템 점검" 탭에도 경고로 표시됨 — 프로덕션에서 반드시 교체 |
| `BREVO_API_KEY` / `SMTP_FROM` | 메일 발송 기능이 항상 실패로 끝나고 `platform_mail_log`에 실패 기록만 쌓임 (서버는 정상 동작) |
| `TELEGRAM_BOT_TOKEN` | 텔레그램 채널 발송만 항상 실패 (디스코드/ntfy는 무관) |
| `DISCORD_BOT_TOKEN` | 디스코드 DM 채널 발송만 항상 실패 (기존 웹훅 방식 디스코드/텔레그램/ntfy는 무관) |
| `VAPID_*` | 웹푸시 채널만 발송 불가 (브라우저 구독 UI 자체가 아직 없어서 현재는 영향 없음) |
| `MDBOARD_API_KEY` / `GOOGLE_SERVICE_ACCOUNT` / `GDRIVE_*` / `MDBOARD_FOLDER_ID` | 해당 기능(Claude 연동, Drive 백업)만 비활성 — 나머지 앱엔 영향 없음 |
| `MDBOARD_CONTENTS_DIR` (볼륨 미마운트) | 기본값 `/data/contents/mdboard`로 기동되지만 Railway에 볼륨이 마운트돼 있지 않으면 재배포/재기동마다 콘텐츠가 초기화됨 — mdboard를 쓴다면 **필수로 볼륨을 마운트할 것** |

## 배포 후 확인

1. `https://<도메인>/health` → `{"status":"ok"}`
2. `admin` 계정으로 로그인 → `/admin` → **시스템 점검** 탭에서 JWT_SECRET/메일/알림 설정 상태 확인
3. `BREVO_API_KEY`를 설정했다면 **메일 발송** 탭에서 본인 이메일로 테스트 발송해서 실제 도착 확인
4. `TELEGRAM_BOT_TOKEN`을 설정했다면 **알림** 탭에서 본인(self) 수신자에게 텔레그램 chat_id를 연결하고 테스트 발송
5. `DISCORD_BOT_TOKEN`을 설정했다면 **알림** 탭에서 본인(self) 수신자에게 디스코드 DM User ID를 연결하고 테스트 발송
