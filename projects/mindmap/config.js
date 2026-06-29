// projects/mindmap/config.js
//
// mono-server의 core/loader.js가 projects/ 폴더를 스캔할 때 읽는 메타 정보입니다.
// 기존 mdboard / portfolio의 config.js와 동일한 형태(name, enabled 등)를
// 그대로 따랐습니다. 실제 loader.js가 기대하는 키 이름이 다르다면
// 이 파일의 키 이름만 거기에 맞춰 바꿔주세요 (구조 자체는 동일합니다).
module.exports = {
  name: 'mindmap',     // 마운트 경로 -> https://fn0113.up.railway.app/mindmap/
  title: '마인드맵',
  enabled: true,
  spa: false,
};
