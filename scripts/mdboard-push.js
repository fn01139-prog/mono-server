#!/usr/bin/env node
/**
 * mdboard-push.js — Claude Code에서 md 파일을 mdboard에 바로 등록하는 CLI
 *
 * 사용법:
 *   node scripts/mdboard-push.js <파일경로> [폴더명] [--overwrite]
 *
 * 환경변수:
 *   MDBOARD_URL      기본값: http://localhost:3000
 *   MDBOARD_API_KEY  필수
 *
 * 예시:
 *   node scripts/mdboard-push.js ./notes/summary.md
 *   node scripts/mdboard-push.js ./report.md "월간리포트" --overwrite
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const args     = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.match(/^(--folder|-f)$/));
const folderArg = (() => {
  const fi = args.findIndex(a => a === '--folder' || a === '-f');
  if (fi !== -1 && args[fi + 1]) return args[fi + 1];
  const positional = args.filter(a => !a.startsWith('-'));
  return positional.length >= 2 ? positional[1] : null;
})();
const overwrite = args.includes('--overwrite') || args.includes('-o');

if (!filePath) {
  console.error('사용법: node scripts/mdboard-push.js <파일경로> [폴더명] [--overwrite]');
  process.exit(1);
}

const absPath = path.resolve(filePath);
if (!fs.existsSync(absPath)) {
  console.error(`파일을 찾을 수 없습니다: ${absPath}`);
  process.exit(1);
}

const content   = fs.readFileSync(absPath, 'utf8');
const title     = path.basename(absPath); // .md 포함
const baseUrl   = (process.env.MDBOARD_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiKey    = process.env.MDBOARD_API_KEY || '';

if (!apiKey) {
  console.error('MDBOARD_API_KEY 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const body = JSON.stringify({ title, content, folder: folderArg || undefined, overwrite });
const url  = new URL(`${baseUrl}/mdboard/api/publish`);

const options = {
  hostname: url.hostname,
  port:     url.port || (url.protocol === 'https:' ? 443 : 80),
  path:     url.pathname,
  method:   'POST',
  headers:  {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
    'x-api-key':      apiKey,
  },
};

const lib = url.protocol === 'https:' ? https : http;

const req = lib.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.success) {
        console.log(`✓ 등록 완료: ${json.path}`);
        console.log(`  URL: ${baseUrl}${json.url}`);
      } else {
        console.error(`✗ 실패: ${json.error}`);
        process.exit(1);
      }
    } catch {
      console.error('응답 파싱 오류:', data);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('요청 오류:', e.message);
  process.exit(1);
});

req.write(body);
req.end();
