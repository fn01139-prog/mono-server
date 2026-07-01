# TODO

## 알림 기능 (shared/notify.js) 테스트

`shared/notify.js` 구현 완료. 환경변수 설정 후 테스트 필요.

### Discord
1. Discord 채널 우클릭 → `채널 편집` → `연동` → `웹훅` → `새 웹훅` 생성 → URL 복사
2. `.env`에 추가:
   ```
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```
3. Railway 환경변수에도 동일하게 추가

### Telegram
1. `@BotFather`에서 봇 토큰 발급 (또는 기존 봇 토큰 확인)
2. 알림 받을 채널/그룹에 봇 초대 후 `@userinfobot` 으로 Chat ID 확인
3. `.env`에 추가:
   ```
   TELEGRAM_BOT_TOKEN=1234567890:AAF...
   TELEGRAM_CHAT_ID=@my_channel
   ```
4. Railway 환경변수에도 동일하게 추가

### 테스트 실행
환경변수 설정 후 아래 명령어로 테스트:
```bash
node -e "
require('dotenv').config();
const notify = require('./shared/notify');
notify.send({
  title: '테스트 알림',
  body: 'Discord · Telegram 연동 테스트입니다.',
  url: 'https://fn0113.up.railway.app',
  footer: 'mono-server',
  color: notify.COLOR.SUCCESS,
}).then(() => console.log('완료'));
"
```
