# TODO

## 알림 기능 (shared/notify/) — v2 다중 수신자 모듈로 교체됨

2026-07-01에 만들었던 단일 수신자용 `shared/notify.js`(env 변수 기반, 프로젝트 미사용 확인)를
2026-07-31에 다중 수신자·카테고리 구독·발송 로그를 지원하는 `shared/notify/` 모듈로 교체했다.
설계는 `/root/.claude/uploads/.../webpushnotificationdesign.md` 참고. 자세한 사용법은
`CLAUDE.md`의 "메신저 알림" 절 참고.

### 남은 작업

- **카카오톡 미구현** — "나에게 보내기" API는 사용자별 OAuth 토큰 관리가 필요해 범위가 커서 보류.
  채널 어댑터 구조상 `shared/notify/channels/kakao.js` 하나만 추가하면 되는 구조이긴 함.
- **가족/지인 셀프 온보딩 미구현** — 지금은 admin이 콘솔에서 수동으로 수신자를 만들고 채널(텔레그램
  chat_id, 디스코드 webhook URL, ntfy topic)을 직접 입력해야 함. `notify_invite_tokens` 테이블은
  만들어뒀지만 초대 링크 발급 → 텔레그램 봇 웹훅(`/start` 딥링크) 수신 → 자동 연결 플로우는 미구현.
- 첫 실사용 프로젝트에서 `registerCategory` + `send` 연동 테스트 필요 (아직 어떤 프로젝트도 호출하지 않음)

### 채널 연결 방법 (admin 콘솔, `/admin` → 알림 탭)

**Discord**: 채널 우클릭 → `채널 편집` → `연동` → `웹훅` → `새 웹훅` 생성 → URL 복사 → 알림 탭에서
수신자에게 채널 추가(디스코드, webhook URL 붙여넣기). 서버 환경변수는 필요 없음(수신자별로 DB에 저장).

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
