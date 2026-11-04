// projects/babylog/config.js
// 음성 육아 기록 (baby-log). 원본 저장소는 따로 있고 lib/ 는 `npm run sync-mono`로 복사된 것.
module.exports = {
  name:        '아기 기록',
  prefix:      '/babylog',
  description: '음성으로 수유·기저귀·수면·투약 기록, 가족 공유, 알림',
  icon:        '👶',
  enabled:     true,
  // 플랫폼 로그인 가드를 쓰지 않는다: 가족이 초대 코드로 직접 가입하고, 모바일 앱이 Bearer 토큰으로
  // 접속하는 구조라 자체 인증(lib/auth.js, BABYLOG_JWT_SECRET)을 유지한다. 모든 API는 lib 안에서 인증 검사.
  public:      true,
};
