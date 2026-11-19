/**
 * projects/demo/paths.js
 * 웹데모 런타임 게시 경로 — Railway 볼륨(/data)에 저장해 재배포 없이 게시한다.
 *
 * - 저장소의 public/ : 코드와 함께 배포되는 고정 데모 (변경 시 재배포 필요)
 * - 볼륨(DEMO_DIR)   : /demo/api/files/* 로 업로드한 데모 (즉시 반영, 재기동 없음)
 *
 * 로컬 개발 등 볼륨이 없는 환경에서는 DEMO_CONTENTS_DIR 로 다른 경로를 지정할 수 있다.
 * mdboard와 달리 디렉토리를 만들 수 없어도 서버 기동을 막지 않는다 — 이 경우
 * 볼륨 게시 기능만 비활성화되고 저장소 public/ 데모는 그대로 서빙된다.
 */
'use strict';

const fs = require('fs');

const DEMO_DIR = process.env.DEMO_CONTENTS_DIR || '/data/contents/demo';

let DEMO_DIR_READY = false;
try {
  if (!fs.existsSync(DEMO_DIR)) fs.mkdirSync(DEMO_DIR, { recursive: true });
  DEMO_DIR_READY = true;
} catch (e) {
  console.warn(`  ⚠️  [demo] 게시 디렉토리(${DEMO_DIR})를 만들 수 없어 볼륨 게시를 비활성화합니다. (${e.message})`);
}

module.exports = { DEMO_DIR, DEMO_DIR_READY };
