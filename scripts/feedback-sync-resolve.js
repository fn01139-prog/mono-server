#!/usr/bin/env node
/**
 * feedback-sync-resolve.js — GitHub Actions 전용: feedback-sync-issues.js가 미러링한
 * 이슈가 닫히면(Close), 닫기 직전 마지막 댓글을 처리내용으로 삼아 mono-server의
 * platform_feedback을 처리완료 상태로 갱신한다. ("쓰기" 방향 브릿지 — 조회는
 * feedback-sync-issues.js 참고)
 *
 * 트리거: .github/workflows/feedback-resolve.yml (on: issues.closed)
 *
 * 실행 환경변수:
 *   FEEDBACK_URL       mono-server 배포 주소 (기본 https://fn0113.up.railway.app)
 *   FEEDBACK_API_KEY   mono-server FEEDBACK_API_KEY (Actions secret)
 *   GITHUB_TOKEN       댓글 조회/작성 권한 (Actions 기본 제공 토큰)
 *   GITHUB_REPOSITORY  Actions가 자동 주입 (owner/repo)
 *   GITHUB_EVENT_PATH  Actions가 자동 주입 (issues.closed 이벤트 payload 경로)
 */

const fs    = require('fs');
const https = require('https');

const FEEDBACK_URL     = (process.env.FEEDBACK_URL || 'https://fn0113.up.railway.app').replace(/\/$/, '');
const FEEDBACK_API_KEY = process.env.FEEDBACK_API_KEY || '';
const GITHUB_TOKEN     = process.env.GITHUB_TOKEN || '';
const REPO             = process.env.GITHUB_REPOSITORY || '';
const EVENT_PATH       = process.env.GITHUB_EVENT_PATH || '';

if (!FEEDBACK_API_KEY) { console.error('FEEDBACK_API_KEY가 설정되지 않았습니다.'); process.exit(1); }
if (!GITHUB_TOKEN)     { console.error('GITHUB_TOKEN이 설정되지 않았습니다.'); process.exit(1); }
if (!REPO)             { console.error('GITHUB_REPOSITORY가 설정되지 않았습니다.'); process.exit(1); }
if (!EVENT_PATH)       { console.error('GITHUB_EVENT_PATH가 설정되지 않았습니다 (issues.closed 이벤트에서만 동작).'); process.exit(1); }

function requestJson(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(u, {
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json;
        try { json = data ? JSON.parse(data) : null; } catch { json = data; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(`HTTP ${res.statusCode} ${url}: ${typeof json === 'string' ? json : JSON.stringify(json)}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ghHeaders = {
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'mono-server-feedback-sync',
};

async function main() {
  const event = JSON.parse(fs.readFileSync(EVENT_PATH, 'utf8'));
  const issue = event.issue;
  if (!issue) { console.error('issues.closed 이벤트가 아닙니다.'); process.exit(1); }

  const m = /feedback-id:\s*(\d+)/.exec(issue.body || '');
  if (!m) {
    console.log(`이슈 #${issue.number}는 feedback-sync로 생성된 게 아니라 스킵합니다.`);
    return;
  }
  const feedbackId = m[1];

  const comments = await requestJson(
    `https://api.github.com/repos/${REPO}/issues/${issue.number}/comments?per_page=100`,
    { headers: ghHeaders }
  );
  const lastComment = comments.length ? comments[comments.length - 1] : null;
  const resolutionNote = lastComment
    ? lastComment.body.trim()
    : `이슈 #${issue.number} 종료로 처리완료 (${issue.html_url})`;

  const result = await requestJson(`${FEEDBACK_URL}/auth/feedback/batch/${feedbackId}`, {
    method: 'PUT',
    headers: { 'x-api-key': FEEDBACK_API_KEY },
    body: { status: 'done', resolutionNote, resolvedBy: 'claude-batch' },
  });
  console.log(`✓ feedback #${feedbackId} → done`);

  await requestJson(`https://api.github.com/repos/${REPO}/issues/${issue.number}/comments`, {
    method: 'POST',
    headers: ghHeaders,
    body: { body: `✅ mono-server에 처리완료로 반영되었습니다 (feedback #${feedbackId}, 상태: \`${result.feedback.status}\`).` },
  });
}

main().catch((e) => {
  console.error('✗ 처리 반영 실패:', e.message);
  process.exit(1);
});
