#!/usr/bin/env node
/**
 * feedback-batch.js — Claude Code에서 platform_feedback(버그/개선요청)을 배치로 조회·처리하는 CLI
 * mdboard-push.js와 동일한 스타일(외부 의존성 없이 http/https 내장 모듈만 사용)
 *
 * 사용법:
 *   node scripts/feedback-batch.js list
 *   node scripts/feedback-batch.js resolve <id> "<처리내용>" [--reopen]
 *
 * 환경변수:
 *   FEEDBACK_URL      기본값: http://localhost:3000
 *   FEEDBACK_API_KEY  필수 (mono-server의 FEEDBACK_API_KEY와 동일한 값)
 *
 * 예시:
 *   FEEDBACK_URL=https://fn0113.up.railway.app node scripts/feedback-batch.js list
 *   FEEDBACK_URL=https://fn0113.up.railway.app node scripts/feedback-batch.js resolve 3 "버튼 z-index 수정, PR #21로 반영"
 */

const http  = require('http');
const https = require('https');

const baseUrl = (process.env.FEEDBACK_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiKey  = process.env.FEEDBACK_API_KEY || '';

if (!apiKey) {
  console.error('FEEDBACK_API_KEY 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const payload = body ? JSON.stringify(body) : null;
    const lib = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'x-api-key': apiKey,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(`HTTP ${res.statusCode}: ${json?.error || data}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === 'list') {
    const list = await request('GET', '/auth/feedback/batch/pending');
    console.log(JSON.stringify(list, null, 2));
    console.error(`\n대기 중인 요청 ${list.length}건`);
    return;
  }

  if (cmd === 'resolve') {
    const [id, note] = rest.filter(a => !a.startsWith('--'));
    const reopen = rest.includes('--reopen');
    if (!id) {
      console.error('사용법: node scripts/feedback-batch.js resolve <id> "<처리내용>" [--reopen]');
      process.exit(1);
    }
    const result = await request('PUT', `/auth/feedback/batch/${id}`, {
      status: reopen ? 'pending' : 'done',
      resolutionNote: note || undefined,
      resolvedBy: 'claude-batch',
    });
    console.log(`✓ #${id} → ${result.feedback.status}${note ? ` (${note})` : ''}`);
    return;
  }

  console.error('사용법:\n  node scripts/feedback-batch.js list\n  node scripts/feedback-batch.js resolve <id> "<처리내용>" [--reopen]');
  process.exit(1);
}

main().catch((e) => {
  console.error('✗ 실패:', e.message);
  process.exit(1);
});
