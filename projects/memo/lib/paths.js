'use strict';
const fs = require('fs');
const path = require('path');

// mono-server 관례(projects/mdboard/lib/paths.js)를 따라, Railway 볼륨(/data)
// 하위에 프로젝트별 폴더를 격리해서 쓴다 — Railway는 서비스당 볼륨 1개만 붙일 수
// 있어 다른 프로젝트(mdboard 등)와 같은 볼륨을 공유하기 때문. 로컬 개발처럼 볼륨이
// 없는 환경에서는 MEMO_CONTENTS_DIR 로 다른 경로를 지정할 수 있다.
const CONTENTS_ROOT = process.env.MEMO_CONTENTS_DIR || '/data/contents/memo';

const DATA_DIR    = path.join(CONTENTS_ROOT, 'data');
const CONTENT_DIR = path.join(CONTENTS_ROOT, 'content');
const IMG_DIR      = path.join(CONTENT_DIR, 'img');
const LOG_DIR      = path.join(CONTENTS_ROOT, 'logs');
const TREE_FILE    = path.join(DATA_DIR, 'tree.json');
const ACCESS_LOG   = path.join(LOG_DIR, 'access.log');

// loader.js가 config.js를 통해 이 모듈을 가장 먼저 require하므로, staticMounts
// 등록 여부(디렉토리 존재 여부로 판단)보다 먼저 디렉토리가 만들어져 있어야 한다.
try {
  [DATA_DIR, CONTENT_DIR, IMG_DIR, LOG_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
} catch (e) {
  throw new Error(
    `[memo] 콘텐츠 디렉토리(${CONTENTS_ROOT})를 생성할 수 없습니다 — Railway 볼륨이 마운트돼 있는지, ` +
    `또는 로컬 개발이라면 MEMO_CONTENTS_DIR 환경변수로 쓰기 가능한 경로를 지정했는지 확인하세요. (${e.message})`
  );
}

module.exports = {
  CONTENTS_ROOT,
  DATA_DIR,
  CONTENT_DIR,
  IMG_DIR,
  LOG_DIR,
  TREE_FILE,
  ACCESS_LOG,
};
