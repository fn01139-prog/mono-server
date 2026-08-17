# TODO

## 알림 기능 (shared/notify/) — v2 다중 수신자 모듈로 교체됨

2026-07-01에 만들었던 단일 수신자용 `shared/notify.js`(env 변수 기반, 프로젝트 미사용 확인)를
2026-07-31에 다중 수신자·카테고리 구독·발송 로그를 지원하는 `shared/notify/` 모듈로 교체했다.
설계는 `/root/.claude/uploads/.../webpushnotificationdesign.md` 참고. 자세한 사용법은
`CLAUDE.md`의 "메신저 알림" 절 참고.

### 남은 작업

- **카카오톡 미구현** — "나에게 보내기" API는 사용자별 OAuth 토큰 관리가 필요해 범위가 커서 보류.
  채널 어댑터 구조상 `shared/notify/channels/kakao.js` 하나만 추가하면 되는 구조이긴 함.
- **가족/지인 셀프 온보딩 미구현** (플랫폼 계정이 없는 경우만 해당) — 2026-08-01에 플랫폼 계정이 있는
  사용자는 `/notify-settings`("내 알림 설정" 페이지)에서 본인 채널 연결·카테고리 구독을 직접 할 수
  있게 됐음. 하지만 가족/지인이 플랫폼 로그인 계정 자체가 없는 경우(예: 부모님)는 여전히 admin이
  콘솔에서 수동으로 수신자를 만들고 채널(텔레그램 chat_id, 디스코드 webhook URL, ntfy topic)을 직접
  입력해야 함. `notify_invite_tokens` 테이블은 만들어뒀지만 초대 링크 발급 → 텔레그램 봇 웹훅(`/start`
  딥링크) 수신 → 자동 연결 플로우는 미구현.
- 첫 실사용 프로젝트에서 `registerCategory` + `send` 연동 테스트 필요 (아직 어떤 프로젝트도 호출하지 않음)
- **참여자 대상 알림 발송 패턴 준비 완료, 미사용** — campchecklist 등이 트립 참여자에게 "내용
  등록해주세요" 같은 알림을 보내려면 `notifyDb.getOrCreateRecipientForUser(platformUserId, name)`로
  참여자의 platform_user_id → recipient_id를 얻어서 `notify.send({ category, recipientIds: [...],
  title, body })`에 넘기면 됨. 이 패턴은 "내 알림 설정" 셀프서비스 기능을 만들면서 함께 준비해뒀지만
  실제로 호출하는 프로젝트는 아직 없음.

### 셀프서비스 "내 알림 설정" (`/notify-settings`, 2026-08-01 추가)

로그인한 사용자라면 누구나(admin 권한 불필요) `/notify-settings`에서 본인 채널(텔레그램/디스코드/ntfy/
웹푸시)을 직접 연결하고, 등록된 카테고리 목록에서 원하는 것만 골라 채널별로 구독을 켜고 끌 수 있음.
허브 페이지("🔔 알림 설정" 링크)에서 진입. 라우트는 `core/auth-routes.js`의 `/auth/notify/*`, 본인
recipient 외 데이터는 건드릴 수 없도록 소유권 체크(`deleteChannelIfOwned`)가 걸려있음.

### 채널 연결 방법 (admin 콘솔, `/admin` → 알림 탭)

**Discord**: 채널 우클릭 → `채널 편집` → `연동` → `웹훅` → `새 웹훅` 생성 → URL 복사 → 알림 탭에서
수신자에게 채널 추가(디스코드, webhook URL 붙여넣기). 서버 환경변수는 필요 없음(수신자별로 DB에 저장).

**Discord DM** (봇이 개인에게 직접 DM — 채널 게시가 아니라 특정 사람에게 알림을 보내고 싶을 때):
1. `https://discord.com/developers/applications`에서 애플리케이션 생성 → Bot 탭에서 봇 추가 → 토큰 발급
2. OAuth2 → URL Generator에서 `bot` scope만 선택 → 초대 링크 생성 → 본인 전용 비공개 서버를 새로 만들어 그 링크로 봇 초대
3. 알림 받을 사람(친구/가족)도 그 서버에 초대(활동 불필요 — "같은 서버에 있다"는 자격 조건만 충족하면 됨)
4. 각자 개발자 모드 활성화 후 자신을 우클릭 → ID 복사로 Discord User ID 확인
5. 발급받은 봇 토큰을 서버 환경변수 `DISCORD_BOT_TOKEN`에 설정 → 알림 탭에서 수신자에게 채널 추가(디스코드 DM, User ID 입력)

셀프봇(개인 계정 자동화)은 ToS 위반(계정 정지 위험)이라 사용하지 않음 — 항상 봇 계정으로만 발송.

**Telegram**: `@BotFather`에서 봇 토큰 발급 → 서버 환경변수 `TELEGRAM_BOT_TOKEN`에 설정 → 알림 받을
사람이 봇과 대화해서 `@userinfobot`으로 자기 chat_id 확인 → 알림 탭에서 수신자에게 채널 추가(텔레그램,
chat_id 입력).

**ntfy**: 기본 공개 서버(`https://ntfy.sh`) 사용 시 서버 설정 불필요. 알림 탭에서 수신자에게 채널
추가(ntfy, 원하는 topic 이름 입력) → 수신자가 ntfy 앱/웹에서 같은 topic 구독.

**웹푸시** (2026-08-01 구독 UI 추가): `VAPID_SUBJECT`/`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` 환경변수
설정(`node -e "console.log(require('web-push').generateVAPIDKeys())"`로 키 생성) → 알림 탭의
"이 브라우저를 웹푸시로 구독" 패널에서 수신자 선택 후 구독 버튼 클릭(브라우저 알림 권한 허용 필요) →
`GET /sw.js`(서비스워커, 루트 경로로 서빙되어야 스코프가 사이트 전체를 덮음)를 등록하고
`notify_push_subscriptions`에 자동 등록됨. HTTPS(또는 localhost) 환경에서만 동작.
