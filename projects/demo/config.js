// projects/demo/config.js
const { DEMO_DIR } = require('./paths');

module.exports = {
  name:        '웹데모',
  prefix:      '/demo',
  description: '간단한 웹화면 데모 모음집',
  icon:        '🧪',
  enabled:     true,
  // 가상 데이터로만 동작하는 정적 화면 설계/데모 모음이라 로그인 없이 전면 공개.
  // 쓰기 API(/demo/api/files/*)는 index.js에서 로그인 + /demo 앱 권한(또는 CLI용 DEMO_API_KEY)을 직접 검사하고,
  // HTML(.html/.htm)만 허용한다.
  public:      true,
  // 볼륨에 업로드한 데모를 /demo/* 로 서빙 — public/ 마운트보다 먼저 등록되어 같은 경로면 볼륨이 우선.
  // express.static은 요청마다 디스크를 읽으므로 업로드 즉시 반영된다(서버 재기동 불필요).
  staticMounts: [{ path: '', dir: DEMO_DIR }],
};
