#!/usr/bin/env node
/**
 * demo-push.js — 웹데모(/demo)에 HTML 등을 재배포 없이 바로 게시하는 CLI
 *
 * 사용법:
 *   node scripts/demo-push.js <로컬파일> [원격경로]
 *   node scripts/demo-push.js --delete <원격경로>
 *
 *   원격경로를 생략하면 파일명 그대로 루트에 올린다. 폴더로 묶으려면 "폴더/파일명.html" 형식.
 *   같은 경로가 있으면 덮어쓴다.
 *
 * 환경변수:
 *   DEMO_URL      기본값: http://localhost:3000   (운영: https://fn0113.up.railway.app)
 *   DEMO_API_KEY  필수 (Railway 서비스 변수와 동일한 값)
 *
 * 예시:
 *   node scripts/demo-push.js ./schedule.html sap/schedule.html
 *   node scripts/demo-push.js --delete sap/schedule.html
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const BASE = (process.env.DEMO_URL || 'http://localhost:3000').replace(/\/+$/, '');
const KEY  = process.env.DEMO_API_KEY;
const args = process.argv.slice(2);

if (!KEY) { console.error('DEMO_API_KEY 환경변수가 필요합니다.'); process.exit(1); }

(async () => {
  const del = args[0] === '--delete';
  const local  = del ? null : args[0];
  const remote = (del ? args[1] : args[1] || (local && path.basename(local)) || '').replace(/^\/+/, '');
  if (!remote || (!del && !local)) {
    console.error('사용법: node scripts/demo-push.js <로컬파일> [원격경로] | --delete <원격경로>');
    process.exit(1);
  }
  const url = `${BASE}/demo/api/files/${remote.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, del
    ? { method: 'DELETE', headers: { 'x-api-key': KEY } }
    : { method: 'PUT', headers: { 'x-api-key': KEY, 'content-type': 'application/octet-stream' }, body: fs.readFileSync(local) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) { console.error(`❌ ${res.status} ${body.error || ''}`); process.exit(1); }
  console.log(del ? `🗑  삭제: ${remote}` : `✅ 게시${body.overwritten ? '(덮어씀)' : ''}: ${BASE}${body.url}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
