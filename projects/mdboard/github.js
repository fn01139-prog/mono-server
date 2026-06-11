/**
 * projects/mdboard/github.js
 * GitHub Contents API를 이용한 mdboard 콘텐츠 자동 백업
 *
 * 필요 환경변수:
 *   GITHUB_TOKEN   Personal Access Token (repo 쓰기 권한)
 *   GITHUB_REPO    owner/repo 형식 (예: username/mono-server)
 *   GITHUB_BRANCH  대상 브랜치 (기본값: main)
 */

const BASE_PATH = 'projects/mdboard/public/contents';
const API_BASE  = 'https://api.github.com';

function getConfig() {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) return null;
  return { token, repo, branch };
}

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function getFileSha(token, repo, filePath, branch) {
  const url = `${API_BASE}/repos/${repo}/contents/${filePath}?ref=${branch}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

/**
 * 파일 업서트 (없으면 생성, 있으면 업데이트)
 * @param {string} filename  .md 파일명
 * @param {string} content   파일 내용
 */
async function upsertFile(filename, content) {
  const cfg = getConfig();
  if (!cfg) return;
  const { token, repo, branch } = cfg;
  const filePath = `${BASE_PATH}/${filename}`;
  try {
    const sha = await getFileSha(token, repo, filePath, branch);
    const body = {
      message: `docs: update ${filename}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;
    const url = `${API_BASE}/repos/${repo}/contents/${filePath}`;
    const res = await fetch(url, { method: 'PUT', headers: headers(token), body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[github] upsertFile 오류 (${filename}):`, err);
    } else {
      console.log(`[github] ${sha ? '업데이트' : '생성'}: ${filename}`);
    }
  } catch (e) {
    console.error(`[github] upsertFile 오류 (${filename}):`, e.message);
  }
}

/**
 * 파일 삭제
 * @param {string} filename  .md 파일명
 */
async function deleteFile(filename) {
  const cfg = getConfig();
  if (!cfg) return;
  const { token, repo, branch } = cfg;
  const filePath = `${BASE_PATH}/${filename}`;
  try {
    const sha = await getFileSha(token, repo, filePath, branch);
    if (!sha) return;
    const body = { message: `docs: delete ${filename}`, sha, branch };
    const url = `${API_BASE}/repos/${repo}/contents/${filePath}`;
    const res = await fetch(url, { method: 'DELETE', headers: headers(token), body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[github] deleteFile 오류 (${filename}):`, err);
    } else {
      console.log(`[github] 삭제: ${filename}`);
    }
  } catch (e) {
    console.error(`[github] deleteFile 오류 (${filename}):`, e.message);
  }
}

module.exports = { upsertFile, deleteFile };
