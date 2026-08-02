#!/usr/bin/env node
/**
 * feedback-sync-issues.js — GitHub Actions 전용: mono-server의 처리 대기 중인
 * 버그/개선요청(platform_feedback)을 읽어와 GitHub Issue로 미러링한다.
 *
 * 이 스크립트가 필요한 이유: Claude Code 세션의 아웃바운드 네트워크 정책이 배포 서버
 * 호스트(Railway 등)를 막아둔 경우가 있어, Claude가 mono-server API를 직접 호출하지
 * 못할 수 있다. GitHub Actions 러너는 인터넷이 열려있으므로 여기서 대신 조회해
 * Issue로 남기면, Claude는 GitHub만 보고도 신고 내용을 파악해 처리할 수 있다.
 * (실제 코드 수정/테스트/push는 원래 GitHub만 거치므로 이 브릿지가 필요 없다 — 이
 * 스크립트는 "읽기" 방향만 담당하고, "처리완료 반영"은 feedback-sync-resolve.js가 맡는다)
 *
 * 실행 환경변수 (GitHub Actions workflow에서 주입):
 *   FEEDBACK_URL      mono-server 배포 주소 (기본 https://fn0113.up.railway.app)
 *   FEEDBACK_API_KEY  mono-server FEEDBACK_API_KEY (Actions secret)
 *   GITHUB_TOKEN      이슈 생성 권한 (Actions 기본 제공 토큰)
 *   GITHUB_REPOSITORY Actions가 자동 주입 (owner/repo)
 */

const https = require('https');

const FEEDBACK_URL     = (process.env.FEEDBACK_URL || 'https://fn0113.up.railway.app').replace(/\/$/, '');
const FEEDBACK_API_KEY = process.env.FEEDBACK_API_KEY || '';
const GITHUB_TOKEN     = process.env.GITHUB_TOKEN || '';
const REPO             = process.env.GITHUB_REPOSITORY || '';
const MARKER_LABEL     = 'feedback';

if (!FEEDBACK_API_KEY) { console.error('FEEDBACK_API_KEY가 설정되지 않았습니다.'); process.exit(1); }
if (!GITHUB_TOKEN)     { console.error('GITHUB_TOKEN이 설정되지 않았습니다.'); process.exit(1); }
if (!REPO)             { console.error('GITHUB_REPOSITORY가 설정되지 않았습니다.'); process.exit(1); }

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

const CATEGORY_LABEL = { bug: '🐛 버그', improvement: '✨ 기능개선' };
const TYPE_LABEL = { ui: '화면구성', error: '시스템 오류', feature: '추가기능' };

async function fetchPendingFeedback() {
  return requestJson(`${FEEDBACK_URL}/auth/feedback/batch/pending`, {
    headers: { 'x-api-key': FEEDBACK_API_KEY },
  });
}

async function fetchSyncedIds() {
  // 이미 미러링된 이슈(라벨=feedback, open)를 모두 훑어 본문의 feedback-id 마커를 수집
  const issues = await requestJson(
    `https://api.github.com/repos/${REPO}/issues?labels=${MARKER_LABEL}&state=open&per_page=100`,
    { headers: ghHeaders }
  );
  const ids = new Set();
  for (const issue of issues) {
    const m = /feedback-id:\s*(\d+)/.exec(issue.body || '');
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

function buildIssueBody(f) {
  return `### ${CATEGORY_LABEL[f.category] || f.category} · ${TYPE_LABEL[f.type] || f.type}

**프로젝트**: \`${f.app_prefix}\`
**요청자**: ${f.requester_name}
**요청일시**: ${new Date(f.created_at).toLocaleString('ko-KR')}
${f.page_url ? `**신고 페이지**: ${f.page_url}` : ''}

**내용**
${f.content}

---
이 이슈를 **닫기 전에 처리 내용을 댓글로 남겨주세요.** 그 댓글이 mono-server의 처리내용(resolution note)으로 저장됩니다.
이슈를 닫으면(Close) \`feedback-resolve\` 워크플로가 자동으로 mono-server API를 호출해 처리완료 상태로 반영합니다.

<!-- feedback-id: ${f.id} -->
<!-- feedback-sync: mono-feedback-batch -->`;
}

async function createIssue(f) {
  const title = `[피드백 #${f.id}] ${CATEGORY_LABEL[f.category] || f.category} · ${TYPE_LABEL[f.type] || f.type} — ${f.content.slice(0, 50)}`;
  const issue = await requestJson(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: ghHeaders,
    body: { title, body: buildIssueBody(f), labels: [MARKER_LABEL] },
  });
  console.log(`✓ #${f.id} → ${issue.html_url}`);
}

async function main() {
  const pending = await fetchPendingFeedback();
  if (!pending.length) { console.log('처리 대기 중인 신고가 없습니다.'); return; }

  const syncedIds = await fetchSyncedIds();
  const toCreate = pending.filter(f => !syncedIds.has(f.id));

  if (!toCreate.length) {
    console.log(`대기 중인 ${pending.length}건 모두 이미 이슈로 동기화되어 있습니다.`);
    return;
  }

  console.log(`신규 ${toCreate.length}건 이슈 생성 중...`);
  for (const f of toCreate) {
    await createIssue(f);
  }
}

main().catch((e) => {
  console.error('✗ 동기화 실패:', e.message);
  process.exit(1);
});
