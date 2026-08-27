// projects/memo/config.js
const { IMG_DIR } = require('./lib/paths');

module.exports = {
  name:        '메모 문서함',
  prefix:      '/memo',
  description: '대분류/중분류로 정리한 사내 공유 문서함 — 관리자가 작성, 중분류별 열람 코드로 이중 보호',
  icon:        '🗒️',
  enabled:     true,
  // 문서 본문 이미지는 public/ 밖의 볼륨 경로에 저장되므로(mdboard와 동일한 패턴)
  // /memo/content/img/* 를 별도 정적 마운트해야 CKEditor에 삽입된 이미지가 보인다.
  staticMounts: [{ path: '/content/img', dir: IMG_DIR }],
};
