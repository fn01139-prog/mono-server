/**
 * projects/mdboard/paths.js
 * mdboard 콘텐츠 저장 경로 — 단일 정의(index.js/driveClient.js/스크립트/배치잡 공용)
 *
 * Railway 볼륨(퍼시스턴트 디스크)을 /data 에 마운트해두고 그 하위에 저장한다.
 * 로컬 개발 등 볼륨이 없는 환경에서는 MDBOARD_CONTENTS_DIR 로 다른 경로를 지정할 수 있다.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const CONTENTS_DIR = process.env.MDBOARD_CONTENTS_DIR || '/data/contents/mdboard';
const IMG_DIR = path.join(CONTENTS_DIR, 'img');

// loader.js가 config.js를 통해 이 모듈을 가장 먼저 require하므로, 정적 마운트를
// 등록하기 전에(존재 여부로 마운트를 결정) 디렉토리가 먼저 만들어져 있어야 한다.
try {
  [CONTENTS_DIR, IMG_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
} catch (e) {
  throw new Error(
    `[mdboard] 콘텐츠 디렉토리(${CONTENTS_DIR})를 생성할 수 없습니다 — Railway 볼륨이 마운트돼 있는지, ` +
    `또는 로컬 개발이라면 MDBOARD_CONTENTS_DIR 환경변수로 쓰기 가능한 경로를 지정했는지 확인하세요. (${e.message})`
  );
}

module.exports = { CONTENTS_DIR, IMG_DIR };
