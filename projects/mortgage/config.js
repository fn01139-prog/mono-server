module.exports = {
  name:        '주택담보대출 상담 준비',
  prefix:      '/mortgage',
  description: '상담 전 소득·대출 정보 정리 + 상환방식별(원리금균등/원금균등/체증식) 비교',
  icon:        '🏦',
  enabled:     true,
  spa:         true,
  // 케이스 데이터는 브라우저 localStorage에만 저장되고 서버로는 전혀 전송되지 않으므로
  // 로그인 게이트를 걸 필요가 없다 — URL로 직접 접속해도 바로 사용할 수 있게 전면 공개.
  public:      true,
};
