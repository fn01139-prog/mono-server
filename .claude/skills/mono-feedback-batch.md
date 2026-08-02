---
name: mono-feedback-batch
description: mono-server에 Ctrl+H로 등록된 버그/개선요청(platform_feedback)을 조회해 코드로 반영하고, 테스트 후 GitHub에 push하고, 처리완료 상태로 갱신합니다. "피드백 처리해줘", "개선요청 반영해줘", "버그 리스트 처리해줘", "신고된 거 고쳐줘" 등을 요청하면 이 스킬을 실행합니다.
---

# mono-feedback-batch 스킬

`/admin`(버그/개선 탭)이나 허브 페이지에 쌓인 사용자 신고를 이 스킬로 일괄 확인·수정·반영합니다.
배치잡(자동 스케줄)이 아니라 **사용자가 요청할 때마다 수동으로 실행**하는 워크플로입니다.

## 두 가지 경로 — 세션의 네트워크 상황에 따라 자동 선택

Claude Code 세션에 따라 배포 서버(예: `https://fn0113.up.railway.app`)로 나가는 아웃바운드
네트워크가 조직 정책으로 막혀있을 수 있습니다 (증상: curl/node가 `CONNECT` 단계에서 거부됨,
`/root/.ccr/README.md`의 "403 from the proxy" 항목). 반면 **GitHub는 거의 항상 열려있습니다**
(git push, GitHub MCP 도구가 정상 동작하면 열려있는 것). 그래서 이 스킬은 두 경로를 지원합니다.

- **경로 A (직접 API)** — `FEEDBACK_URL`에 네트워크가 닿는 경우. `scripts/feedback-batch.js`로
  mono-server API를 직접 호출합니다. 가장 단순하고 즉시 반영됩니다.
- **경로 B (GitHub Issue 브릿지)** — 네트워크가 막혀 경로 A가 실패하는 경우. `.github/workflows/feedback-sync.yml`이
  GitHub Actions(인터넷이 열려있음)에서 대신 mono-server를 조회해 대기 중인 신고를 라벨 `feedback`
  이슈로 미러링해둡니다. Claude는 그 이슈들을 읽어 처리하고, 처리내용을 댓글로 남긴 뒤 이슈를
  닫으면 `.github/workflows/feedback-resolve.yml`이 자동으로 mono-server에 처리완료를 반영합니다.

**0단계에서 먼저 경로를 판별**하고, 이후 단계는 판별된 경로를 따릅니다.

## 사전 조건

- `FEEDBACK_API_KEY` 환경변수 필요 (mono-server의 `FEEDBACK_API_KEY`와 동일한 값, 경로 A에서 사용). 없으면 사용자에게 먼저 요청합니다.
- 경로 B가 동작하려면 저장소에 GitHub Actions secret `FEEDBACK_API_KEY`가 이미 등록되어 있어야 합니다 (Settings → Secrets and variables → Actions → New repository secret). Claude는 이 값을 직접 등록할 수 없으므로, 등록이 안 되어 있으면 사용자에게 안내만 하고 진행합니다.
- 대상 서버 URL은 `FEEDBACK_URL` 환경변수로 지정합니다. 생략하면 `http://localhost:3000`. 배포 서버 대상: `FEEDBACK_URL=https://fn0113.up.railway.app`

## 실행 절차

**0. 스킬 실행 + 경로 판별**
```bash
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 8 "${FEEDBACK_URL:-http://localhost:3000}/health"
```
정상 응답(200)이면 **경로 A**로 진행합니다. 연결 자체가 실패하면(타임아웃, `CONNECT` 거부 등) 재시도하지 말고 바로 **경로 B**로 전환합니다.

---

### 경로 A — 직접 API

**1. 피드백 리스트 조회**
```bash
FEEDBACK_URL=${FEEDBACK_URL:-http://localhost:3000} \
FEEDBACK_API_KEY=$FEEDBACK_API_KEY \
node scripts/feedback-batch.js list
```

**5. 완료 처리 및 처리내용 작성**
```bash
FEEDBACK_URL=${FEEDBACK_URL:-http://localhost:3000} \
FEEDBACK_API_KEY=$FEEDBACK_API_KEY \
node scripts/feedback-batch.js resolve <id> "<무엇을 어떻게 고쳤는지, 커밋/브랜치 정보 포함>"
```
되돌려야 할 경우 `--reopen` 플래그로 다시 대기 상태로 바꿀 수 있습니다.

### 경로 B — GitHub Issue 브릿지

**1. 피드백 리스트 조회**
GitHub 이슈 중 라벨 `feedback`이면서 열려있는 것을 조회합니다(GitHub MCP 도구의 `list_issues`/`search_issues` 사용, 또는 `gh` 대신 제공된 GitHub 도구로). 아직 동기화가 안 됐다면(라벨 `feedback` 이슈가 하나도 없는데 사용자가 방금 신고했다고 하는 경우) `.github/workflows/feedback-sync.yml`을 `workflow_dispatch`로 즉시 1회 실행해 최신 상태로 맞춥니다(`mcp__github__actions_run_trigger`, method `run_workflow`).
각 이슈 본문에서 `<!-- feedback-id: N -->` 마커로 원본 신고 ID를 확인하고, 신고 내용(분류/종류/내용/프로젝트)을 파악합니다.

**5. 완료 처리 및 처리내용 작성**
- 코드 수정을 push한 뒤, 해당 이슈에 **처리내용을 댓글로 남깁니다** (무엇을 어떻게 고쳤는지 + 브랜치/커밋 정보 — 이 댓글 내용이 그대로 mono-server의 처리내용으로 저장됩니다).
- 그 다음 이슈를 **Close** 합니다. `feedback-resolve.yml` 워크플로가 자동으로 트리거되어 mono-server API를 호출하고, 완료되면 이슈에 확인 댓글이 자동으로 달립니다.
- 되돌려야 하면 이슈를 다시 열고, 관리자 콘솔(`/admin` → 버그/개선 탭)에서 수동으로 "대기로 되돌리기"를 눌러야 합니다(경로 B는 재오픈 자동화가 없습니다).

---

## 공통 절차 (경로 무관)

**2. 프로그램 변경**
- 항목이 속한 프로젝트(`projects/<app_prefix>/`)를 `CLAUDE.md`의 아키텍처 설명에 따라 파악한 뒤 최소 범위로 수정합니다.
- 여러 건이 서로 다른 프로젝트에 걸쳐 있으면 항목별로 커밋을 분리하는 걸 기본으로 하되, 같은 근본 원인이면 묶어도 됩니다.
- 이 저장소는 `no test or lint scripts configured` 상태이므로 새로 테스트 프레임워크를 도입하지 말고 기존 스타일(플러그인 로딩 구조, `shared/utils.js` 헬퍼 등)을 따릅니다.

**3. 변경사항 테스트**
자동화된 테스트 스위트가 없으므로 다음을 상황에 맞게 수행합니다:
- 수정한 모든 `.js` 파일에 `node --check <file>`로 구문 검증
- 서버 부팅 가능 여부 확인: 로컬 Postgres가 있으면 `DATABASE_URL`을 그 DB로 지정해 `node app.js`를 띄우고, 변경된 API를 `curl`로 직접 호출해 실제 응답을 확인합니다 (이 세션에서 로컬 Postgres를 쓰는 방법은 앞선 작업 기록 참고: `service postgresql start`, `sudo -u postgres psql -c "CREATE DATABASE ..."`)
- 화면(HTML/JS) 변경이면 `run` 스킬로 브라우저에서 실제 동작을 확인합니다
- 테스트를 마치면 반드시 임시로 띄운 서버/DB를 정리합니다 (`kill`, `DROP DATABASE`, `service postgresql stop`)

**4. GitHub push**
- 이미 작업 중인 feature 브랜치가 있으면 그 브랜치에 커밋합니다.
- `main`/`master`에 있다면 새 브랜치를 만듭니다 (예: `claude/feedback-<id>-<짧은-설명>`).
- 커밋 메시지에 처리한 신고 내용을 명확히 남깁니다. PR 생성은 사용자가 명시적으로 요청한 경우에만 합니다(기본 지침 유지).
- `git push -u origin <branch>` 실행.

## 완료 후 보고

사용자에게 처리한 항목별로 "무엇을 신고했고 → 어떻게 고쳤고 → 어느 브랜치/커밋으로 반영했는지"와 **어느 경로(A/B)로 처리했는지**를 짧게 요약합니다. 원인 파악이 안 되거나 재현이 안 되는 항목은 완료 처리하지 말고 사용자에게 추가 정보를 요청합니다.
