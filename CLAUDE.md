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

### 프로젝트가 바로 갖다 쓸 수 있는 플랫폼 공용 기능

새 프로젝트를 만들 때 아래 기능들은 직접 구현하지 말고 재사용할 것 — 전부 DB 연결/로깅/admin 콘솔 관리 화면까지 이미 갖춰져 있다. 각 기능의 자세한 사용법은 아래 "플랫폼 공통 인프라" 섹션 참고.

| 기능 | require 경로 | 한 줄 사용법 |
|---|---|---|
| 메일 발송 | `shared/mailer.js` | `await require('../../shared/mailer').sendMail({ to, subject, text, appPrefix: '/myapp' })` |
| 메신저 알림 (텔레그램/디스코드/ntfy/웹푸시) | `shared/notify/` | `const notify = require('../../shared/notify'); await notify.registerCategory('my-cat', '설명', '/myapp'); await notify.send({ category: 'my-cat', title, body });` |
| 배치잡(정기 실행 작업) | `core/jobs/<name>.js` | 이 폴더에 `{ id, name, schedule, description, run(pool) }`를 export하는 파일 하나 추가하면 서버 재시작 시 자동 등록·스케줄링됨 (프로젝트 코드에서 직접 호출하는 게 아니라 파일을 추가하는 방식) |

이 기능들은 `projects/_template/index.js`에도 예시 주석으로 남아있으니 새 프로젝트를 템플릿에서 복사해 시작하면 바로 참고할 수 있다.

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
| `/whiteboard` | 공유 화이트보드 | SPA mode; **PostgreSQL** (`whiteboard_boards`/`whiteboard_layers`/`whiteboard_elements`); 채널형 보드 — 이 앱 접근 권한이 있는 로그인 사용자 전원이 보드 목록 조회·참여(펜 드로잉/스티키노트) 가능, 보드 이름변경·삭제는 소유자/admin만; 참여자별로 `whiteboard_layers` 레이어가 자동 등록되어 누가 그렸는지 색으로 구분되고, 레이어(=참여자) 단위로 삭제 관리 가능(본인·보드소유자·admin); 실시간 협업은 WebSocket이 아닌 2.5초 폴링 |
| `/totalprice` | 종합 시세: 금/은 시세 + 국내 주식 시세 | 금/은: 비공식 외부 API(`koreagoldx.co.kr`) 프록시, 메모리 캐시(10분 TTL)+**PostgreSQL**(`totalprice_gold_cache`) 폴백(파일 캐시 아님 — 배포마다 컨테이너가 새로 뜨는 호스팅에서도 유지); 주식: Npay 증권(`finance.naver.com`) 크롤링(일별/시간별 시세, 현재가 스냅샷, 종목뉴스), **PostgreSQL**(`totalprice_stocks` — 종목코드+명칭 마스터, `totalprice-stocklist-refresh` 배치잡이 주 1회 갱신); `/stocks/:code/insight`는 시세+뉴스를 Claude Haiku 4.5로 요약해 매수/매도 참고 자료 생성(투자자문 아님, `ANTHROPIC_API_KEY` 필요, 종목별 30분 캐시, `lib/insightService.js`); **PostgreSQL**(`totalprice_alerts` — 사용자별 AI 알림 예약: 종목/주기/시간/알림채널, `totalprice-alert-runner` 배치잡이 10분마다 스캔해 `shared/notify`로 발송) |

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
- `core/views/login.html`, `core/views/admin.html` — 로그인 페이지, **관리자 콘솔**(`/admin`, admin 전용, 탭형 단일 페이지: 사용자 관리 / 메일 발송 / 알림 / 버그·개선 / 배치잡 / 시스템 점검)

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

### 플랫폼 공통 인프라: 메일 발송 / 메신저 알림 / 버그·개선요청 / 배치잡 / 관리자 콘솔

`/admin`(admin 전용)은 6개 탭으로 구성된 탭형 단일 페이지다: 사용자 관리, 메일 발송, 알림, 버그/개선, 배치잡, 시스템 점검. 사용자 관리/메일/알림/배치잡/시스템 점검 API는 모두 `core/auth-routes.js`의 `/auth/admin/*` 아래 있다(기존 `requireRole('admin')` 가드 재사용). 버그/개선요청은 등록·조회가 admin 전용이 아니라서 예외적으로 `/auth/feedback`(로그인 사용자 전체)과 `/auth/admin/feedback/:id`(admin 전용 상태 변경/삭제)로 나뉜다 — 아래 참고.

**메일 발송 (`shared/mailer.js`)**
- 모든 앱/배치잡이 재사용하는 공통 발송 함수: `sendMail({ to, subject, text, html, appPrefix, sentBy })`
- **Brevo REST API(HTTPS)로 발송한다 — raw SMTP가 아님.** Railway 등 일부 호스팅이 아웃바운드 SMTP 포트(25/465/587/2525)를 막아둬서 nodemailer/SMTP 방식은 `Connection timeout`/`ENETUNREACH`로 실패하는 게 실측 확인됨 → HTTPS(443)로 통신하는 Brevo API로 전환. `BREVO_API_KEY` 환경변수 필요(admin 콘솔에서는 편집 불가, 상태 조회만)
- 발신 주소는 `SMTP_FROM` 환경변수 하나로 전 프로젝트가 동일하게 사용(과거 SMTP 시절 변수명을 그대로 유지). Brevo의 Senders에 인증된 주소여야 발송이 성공함. 미설정 시 `SMTP_USER`로 자동 폴백하며 이 경우 시스템 점검 탭에 경고 표시됨
- 모든 발송 시도(성공/실패)는 `app_prefix`/`sent_by`와 함께 `platform_mail_log`에 기록됨
- 프로젝트가 자신의 발송 이력을 직접 보여주고 싶으면 `mailer.mailLogRouter(appPrefix, { scopeToSender? })`를 자기 라우터에 `router.use()`로 마운트 — `GET <prefix>/api/mail-logs` 자동 등록(로그인/앱 권한 가드는 loader.js가 이미 처리)
- admin API(전체 이력, admin 전용): `GET /auth/admin/mail/config`(설정 상태), `POST /auth/admin/mail/test`(테스트 발송), `GET /auth/admin/mail/logs`

**메신저 알림 (`shared/notify/`)**
- 텔레그램/디스코드(웹훅)/디스코드 DM(봇)/ntfy/웹푸시로 다중 수신자(본인·가족·지인)에게 알림 발송. `shared/mailer.js`와 같은 철학(공통 발송 함수 + 항상 로그 기록)이지만 **다중 수신자 + 카테고리 기반 구독**이 추가된 구조
- 핵심 개념: **Recipient**(수신자, `relation`: self/family/friend) → **Channel**(텔레그램/디스코드/디스코드 DM/ntfy/웹푸시, 수신자 1명당 여러 개 연결 가능) → **Category**(어느 프로젝트의 어떤 알림인지 구분하는 키) → **Subscription**(수신자가 특정 카테고리를 어떤 채널로 받을지)
- 프로젝트 사용법:
  ```js
  const notify = require('../../shared/notify');
  await notify.registerCategory('camp-check', '캠핑 체크리스트', '/campchecklist'); // 앱 시작 시 1회, 멱등 — 기존 self 수신자 자동 구독
  await notify.send({ category: 'camp-check', title: '캠핑 3일 전!', body: '텐트 챙기셨나요?' }); // 카테고리 구독자 전체에게
  ```
- 채널 어댑터는 플러그인 구조: `shared/notify/channels/<name>.js`에 `{ name, send(config, {title, body, url}) }` export → `shared/notify/index.js`의 `channels` 레지스트리와 `shared/notify/db.js`의 `CHANNEL_TABLES`, DB 마이그레이션에 테이블 추가
- 텔레그램은 `TELEGRAM_BOT_TOKEN` 환경변수(전역), 디스코드(웹훅, `discord` 채널)는 수신자별 webhook URL을 그대로 저장(전역 설정 불필요), 디스코드 DM(봇, `discord_dm` 채널)은 `DISCORD_BOT_TOKEN` 환경변수(전역)로 수신자별 Discord User ID에게 직접 DM 발송 — 봇이 초대된 서버(길드)에 수신자도 함께 있어야 발송 가능(Discord 정책), Gateway 연결 없이 REST(`POST /users/@me/channels` → `POST /channels/:id/messages`)만으로 구현, ntfy는 기본 공개 서버 사용, 웹푸시는 `VAPID_SUBJECT`/`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` 필요
- **웹푸시 구독**: `shared/public/sw.js`(서비스워커, `GET /sw.js`로 루트 경로 서빙 — 스코프가 사이트 전체를 덮으려면 필수)로 브라우저가 직접 구독. 구독은 생성 시점의 VAPID 공개키에 영구적으로 묶이므로 재구독 시 기존 구독을 먼저 `unsubscribe()`해야 함(안 그러면 키를 재발급해도 예전 구독이 재사용됨). 한 수신자가 여러 기기(PC+모바일 등)를 구독하면 발송 시 전부에게 보냄(`getChannelConfigs`가 활성 상태 전부 반환 → `sendToChannel`이 `Promise.allSettled`로 병렬 발송, 하나가 죽어도 나머지는 계속 시도). 404/410 응답을 받은 구독은 자동으로 `is_active=FALSE` 처리됨
- **카카오톡은 미구현** — "나에게 보내기" API는 사용자별 OAuth 토큰 관리가 필요해 범위가 커서 보류
- 모든 발송 시도(성공/실패)는 `notify_log`에 기록됨

**셀프서비스 "내 알림 설정" (`/notify-settings`, 로그인한 사용자 누구나 — admin 권한 불필요)**
- `notify_recipients.platform_user_id`로 플랫폼 계정과 1:1 연결(NULL 허용 — admin이 수동으로 만든 가족/지인 수신자는 계속 연결 없이 존재 가능). 사용자 삭제 시 `ON DELETE SET NULL`이라 recipient 자체는 안 지워지고 연결만 끊김
- `core/auth-routes.js`의 `myRecipient(req)` 헬퍼가 `req.user.userId`로 본인 recipient를 조회/자동생성(`notifyDb.getOrCreateRecipientForUser`) — admin 콘솔의 recipient CRUD와 달리 **자기 것만** 만지므로 채널 삭제 시 소유권 검사 필수(`notifyDb.deleteChannelIfOwned`, recipient_id 불일치면 404)
- `GET /auth/notify/me`(내 recipient+채널+구독 한 번에), `GET /auth/notify/categories`(등록된 카테고리 전체 — 읽기 전용, admin 아니어도 됨), `POST /auth/notify/channels`, `DELETE /auth/notify/channels/:type/:id`, `PUT /auth/notify/subscriptions/:categoryId`, `POST /auth/notify/test`, `GET /auth/notify/logs`, `GET /auth/notify/vapid-public-key`
- `core/views/notify-settings.html`: 카테고리+채널 목록에서 체크박스로 선택해 구독(연결 안 한 채널은 비활성화 표시), 이 브라우저 웹푸시 구독, 테스트 발송. 허브 페이지(`/`)에 전 사용자 대상 "🔔 알림 설정" 링크 있음
- **다른 프로젝트가 참여자에게 알림 보낼 때 패턴**: `notifyDb.getOrCreateRecipientForUser(platformUserId, name)`로 platform_user_id → recipient_id를 얻어 `notify.send({ category, recipientIds: [...], title, body })`에 넘기면 됨 (예: campchecklist가 트립 참여자들에게 "내용 등록해주세요" 알림 — 아직 미구현, 이 패턴만 준비되어 있음)
- 가족/지인처럼 로그인 계정이 없는 사람은 이 방식을 못 씀 — admin 콘솔(알림 탭)에서 수동으로 채널 등록해야 함. 초대 링크로 스스로 연결하는 플로우(`notify_invite_tokens` 테이블은 존재)는 여전히 미구현
- admin API(모든 recipient 대상, admin 전용): `GET /auth/admin/notify/recipients`(+POST/PUT/DELETE), `GET/POST /auth/admin/notify/recipients/:id/channels`, `DELETE /auth/admin/notify/channels/:type/:id`, `GET /auth/admin/notify/categories`, `GET/PUT /auth/admin/notify/recipients/:id/subscriptions(/:categoryId)`, `POST /auth/admin/notify/test`, `GET /auth/admin/notify/logs`
- 최초 부트스트랩 시 `relation='self'` 수신자 1명이 자동 생성됨(`scripts/migrate-auth.js`) — admin 콘솔에서 채널만 연결하면 바로 사용 가능

**버그/개선요청 신고 (`shared/public/feedback-widget.js`, `platform_feedback`)**
- 모든 프로젝트 화면(허브 페이지 포함)에서 `Ctrl+H`(또는 우하단 플로팅 버튼 — 브라우저에 따라 `Ctrl+H`가 예약 단축키라 가로채지지 않을 수 있어 항상 병행 제공)를 누르면 신고 모달이 뜬다. 각 프로젝트 진입 HTML에 `<script src="/shared-assets/feedback-widget.js">`를 `auth-guard.js`와 나란히 추가해서 활성화한다 — 새 프로젝트를 만들 때도 잊지 말 것
- 등록 항목: 분류(`category`: `bug` 버그 / `improvement` 기능개선), 종류(`type`: `ui` 화면구성 / `error` 시스템 오류 / `feature` 추가기능), 내용(`content`), 요청자·요청일시는 로그인 사용자 정보로 자동 기록(`requester_id`/`requester_name`/`created_at`), 신고 당시 URL(`page_url`)과 프로젝트(`app_prefix`)도 함께 저장
- `POST /auth/feedback`(등록)·`GET /auth/feedback`(전체 목록, `?limit=`)는 admin 여부와 무관하게 **로그인 사용자 누구나** 호출 가능 — 허브 페이지(`/`)가 이 API로 전체 신고 현황(요청내용/처리내용/요청시간/요청자/완료여부/완료시간/처리구분)을 공개 표시해서 추후 우수 신고자 베네핏 산정에 활용할 예정이기 때문
- **Claude 배치 처리용 API** (로그인 없이 `x-api-key` 헤더로 접근, `FEEDBACK_API_KEY` 필요 — `MDBOARD_API_KEY`/`/publish`와 동일 패턴): `GET /auth/feedback/batch/pending`(처리 대기 중인 개선 리스트 조회), `PUT /auth/feedback/batch/:id`(`{ status: 'done', resolutionNote, resolvedBy? }`로 처리 완료 반영 — `resolvedBy` 생략 시 `'claude-batch'`로 기록)
- admin 전용 수동 관리: `PUT /auth/admin/feedback/:id`(`{ status?, resolutionNote?, category?, type? }`), `DELETE /auth/admin/feedback/:id` — admin 콘솔 "버그/개선" 탭에서 완료 처리/되돌리기/삭제 가능
- 처리구분 표시 규칙: `resolved_by === 'claude-batch'`면 "🤖 Claude 자동처리", 그 외 `platform_users.id`면 LEFT JOIN으로 이름을 가져와 "🙋 이름 (수동)"으로 표시(`GET /auth/feedback`/`/auth/feedback/batch/pending` 응답에 `resolved_by_name` 포함)
- **Claude Code 스킬**: `.claude/skills/mono-feedback-batch.md` — "피드백 처리해줘" 등을 요청하면 조회(`scripts/feedback-batch.js list`) → 코드 수정 → 테스트 → GitHub push → 완료 처리(`scripts/feedback-batch.js resolve <id> "<처리내용>"`)까지 수행. 배치잡(자동 스케줄)이 아니라 수동 실행 워크플로다. `scripts/feedback-batch.js`는 `scripts/mdboard-push.js`와 동일한 스타일의 무의존성 CLI(`FEEDBACK_URL`/`FEEDBACK_API_KEY` 환경변수 사용)
- **GitHub Issue 브릿지** (Claude Code 세션의 아웃바운드 네트워크 정책이 배포 서버 호스트를 막아서 API를 직접 호출 못 하는 경우용 — GitHub는 대체로 열려있다는 전제): `.github/workflows/feedback-sync.yml`(30분마다 + 수동 실행, `scripts/feedback-sync-issues.js`로 처리 대기 신고를 라벨 `feedback` GitHub Issue로 미러링, 본문에 `<!-- feedback-id: N -->` 마커 포함) / `.github/workflows/feedback-resolve.yml`(이슈가 Close되면 `scripts/feedback-sync-resolve.js`가 닫기 직전 마지막 댓글을 처리내용으로 삼아 `PUT /auth/feedback/batch/:id` 호출, 완료되면 이슈에 확인 댓글 자동 등록). 두 워크플로 모두 GitHub Actions repository secret `FEEDBACK_API_KEY`(mono-server의 값과 동일) 필요 — Settings → Secrets and variables → Actions에서 수동 등록해야 하며 Claude Code가 대신 등록할 수 없다. `mono-feedback-batch` 스킬이 0단계에서 `FEEDBACK_URL` 접속 가능 여부를 먼저 판별해 이 브릿지 사용 여부를 자동 결정한다

**배치잡 (`core/batch.js`)**
- `core/jobs/*.js`를 자동 스캔해 `node-cron`으로 등록 (projects/ 자동 로딩과 동일한 패턴). 각 파일은 `{ id, name, schedule, description, run(pool) }`을 export
- 실행 이력은 `platform_batch_log`에, 활성화 여부/마지막 실행 상태는 `platform_batch_jobs`에 저장
- 활성화 스위치는 "자동 스케줄 실행"만 제어 — admin 콘솔의 "지금 실행"은 비활성 상태여도 항상 동작
- 기본 등록된 잡: `mail-log-cleanup`(90일 지난 메일 로그 정리), `batch-log-cleanup`(180일 지난 배치 로그 정리)
- admin API: `GET/PUT /auth/admin/batch/jobs(/:id)`, `POST /auth/admin/batch/jobs/:id/run`, `GET /auth/admin/batch/logs`

**시스템 점검 (`GET /auth/admin/system/check`)**
- 로그인/권한 제어(`core/auth.js`) 상태를 점검: `JWT_SECRET` 기본값 여부, 활성 admin 수, 비활성 계정 수, 와일드카드(`*`) 권한 수, 앱 권한이 하나도 없는 사용자, 메일 발송(Brevo API)/텔레그램 봇 토큰/웹푸시 VAPID 키 설정 여부, 등록된 알림 수신자 수
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
| `ANTHROPIC_API_KEY` | (없음) | Claude API 키. travellog(장소 추천), totalprice(종목 AI 참고 자료 생성)에서 사용. 미설정 시 해당 AI 기능만 에러 응답 |
| `BREVO_API_KEY` | (없음) | 플랫폼 공통 메일 발송(`shared/mailer.js`)용 Brevo API 키. 미설정 시 발송 시도는 실패로 로그만 남음 |
| `SMTP_FROM` | `SMTP_USER` 값 | 발신자 주소 — Brevo Senders에 인증된 주소여야 함 (변수명은 과거 SMTP 시절 그대로 유지) |
| `TELEGRAM_BOT_TOKEN` | (없음) | 플랫폼 공통 메신저 알림(`shared/notify/`)용 텔레그램 봇 토큰. 미설정 시 텔레그램 채널만 발송 실패 |
| `DISCORD_BOT_TOKEN` | (없음) | 플랫폼 공통 메신저 알림(`shared/notify/`)용 디스코드 봇 토큰(`discord_dm` 채널 — 개인 DM 발송). `https://discord.com/developers/applications`에서 발급. 미설정 시 디스코드 DM 채널만 발송 실패(기존 웹훅 방식 `discord` 채널은 무관) |
| `VAPID_SUBJECT` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | (없음) | 웹푸시 채널용 VAPID 키 (`node -e "console.log(require('web-push').generateVAPIDKeys())"`로 생성). admin 콘솔 알림 탭에서 브라우저 구독 가능 |
| `FEEDBACK_API_KEY` | (없음) | 버그/개선요청 신고(`platform_feedback`) 배치 처리 API 키. `GET/PUT /auth/feedback/batch/*`에 `x-api-key` 헤더로 접근할 때 필요 (Claude 배치 등 programmatic 접근용, `MDBOARD_API_KEY`와 동일한 패턴) |

### Deployment

Deployed on [Railway.app](https://railway.app) via NIXPACKS builder. Health check endpoint: `GET /health`. Start command: `node app.js`.
