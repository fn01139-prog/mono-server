// projects/mdboard/config.js
const { CONTENTS_DIR } = require('./paths');

module.exports = {
  name:        'mdBoard',
  prefix:      '/mdboard',
  description: 'Markdown 기반 웹 문서 플랫폼',
  icon:        '📝',
  enabled:     true,
  // 콘텐츠(md/html/이미지)는 Railway 볼륨(paths.js)에 저장되므로 public/ 바깥의
  // 이 경로를 /mdboard/contents/* 로 정적 서빙해야 이미지/HTML 뷰어가 동작한다.
  staticMounts: [{ path: '/contents', dir: CONTENTS_DIR }],
};
