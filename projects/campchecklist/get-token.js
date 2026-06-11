/**
 * get-token.js — Google Drive OAuth2 Refresh Token 발급기
 *
 * 사용법:
 *   1. 아래 CLIENT_ID, CLIENT_SECRET 입력
 *   2. node get-token.js 실행
 *   3. 브라우저에서 구글 계정 인증
 *   4. 터미널에 출력된 값을 Railway 환경변수에 등록
 *
 * Google Cloud Console 설정:
 *   APIs & Services → 사용자 인증 정보 → OAuth 2.0 클라이언트 ID 만들기
 *   애플리케이션 유형: 웹 애플리케이션
 *   승인된 리디렉션 URI 추가: http://localhost:3333/callback
 */

const { google }   = require('googleapis');
const http         = require('http');
const readline     = require('readline');

// ── 여기에 값 입력 (또는 환경변수로 전달) ────────────────────────────
const CLIENT_ID     = process.env.GDRIVE_CLIENT_ID     || '여기에 CLIENT_ID 입력';
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET || '여기에 CLIENT_SECRET 입력';
// ─────────────────────────────────────────────────────────────────

const PORT         = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (CLIENT_ID.startsWith('여기에')) {
  console.error('❌ CLIENT_ID와 CLIENT_SECRET을 스크립트 상단에 입력하거나');
  console.error('   환경변수로 전달하세요:');
  console.error('   GDRIVE_CLIENT_ID=xxx GDRIVE_CLIENT_SECRET=xx	x node get-token.js');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope:       ['https://www.googleapis.com/auth/drive'],
  prompt:      'consent', // refresh_token을 반드시 포함시키기 위해 필수
});

// 토큰 출력 공통 함수
async function exchangeCode(code) {
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error('\n⚠️  refresh_token이 없습니다.');
    console.error('   해결: Google 계정 → 보안 → 타사 앱 액세스');
    console.error('   → 이 앱 액세스 취소 후 다시 실행하세요.\n');
    process.exit(1);
  }
  console.log('\n' + '━'.repeat(60));
  console.log('✅ 인증 완료! Railway Variables에 아래 값을 등록하세요:');
  console.log('━'.repeat(60));
  console.log(`GDRIVE_CLIENT_ID     = ${CLIENT_ID}`);
  console.log(`GDRIVE_CLIENT_SECRET = ${CLIENT_SECRET}`);
  console.log(`GDRIVE_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log('━'.repeat(60));
  console.log('\n📌 기존 GDRIVE_KEY 환경변수는 삭제해도 됩니다.\n');
  process.exit(0);
}

// ── 방법 A: 로컬 서버 자동 수신 ────────────────────────────────────
let serverDone = false;
const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
  if (!code) { res.end('code 없음'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h2 style="font-family:sans-serif;color:green">✅ 인증 완료! 터미널을 확인하세요.</h2>');
  serverDone = true;
  server.close();
  await exchangeCode(code).catch(e => { console.error('❌', e.message); process.exit(1); });
});

server.listen(PORT, () => {
  console.log('\n━'.repeat(60));
  console.log('\n🔗 브라우저에서 아래 URL을 여세요:\n');
  console.log(authUrl);
  console.log('\n━'.repeat(60));
  console.log('\n⏳ 방법 A: 구글 로그인 후 자동으로 코드를 받습니다.');
  console.log('   (리디렉션이 안 되면 방법 B를 사용하세요)\n');
});

// ── 방법 B: 리디렉션 실패 시 URL 직접 붙여넣기 ──────────────────────
// 로컬 서버 리디렉션이 안 될 경우:
//   1. 구글 인증 후 브라우저 주소창 URL 전체를 복사
//   2. 아래 프롬프트에 붙여넣기
//      (예: http://localhost:3333/callback?code=4/0AX4...&scope=...)
setTimeout(() => {
  if (serverDone) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\n방법 B - 브라우저 주소창 URL 전체를 붙여넣으세요\n(자동으로 됐다면 Enter 무시):\n> ', async (input) => {
    rl.close();
    if (!input.trim()) return;
    try {
      const parsed = new URL(input.trim());
      const code   = parsed.searchParams.get('code');
      if (!code) { console.error('❌ URL에서 code를 찾을 수 없습니다.'); process.exit(1); }
      server.close();
      await exchangeCode(code);
    } catch (e) {
      console.error('❌ URL 파싱 실패:', e.message);
      process.exit(1);
    }
  });
}, 3000); // 3초 후에 방법 B 프롬프트 출력