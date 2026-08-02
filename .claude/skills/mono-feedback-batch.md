---
name: mono-feedback-batch
description: mono-server에 Ctrl+H로 등록된 버그/개선요청(platform_feedback)을 조회해 코드로 반영하고, 테스트 후 GitHub에 push하고, 처리완료 상태로 갱신합니다. "피드백 처리해줘", "개선요청 반영해줘", "버그 리스트 처리해줘", "신고된 거 고쳐줘" 등을 요청하면 이 스킬을 실행합니다.
---

# mono-feedback-batch 스킬

`/admin`(버그/개선 탭)이나 허브 페이지에 쌓인 사용자 신고를 이 스킬로 일괄 확인·수정·반영합니다.
배치잡(자동 스케줄)이 아니라 **사용자가 요청할 때마다 수동으로 실행**하는 워크플로입니다.

## 사전 조건

- `FEEDBACK_API_KEY` 환경변수 필요 (mono-server의 `FEEDBACK_API_KEY`와 동일한 값). 없으면 사용자에게 먼저 요청합니다.
- 대상 서버 URL은 `FEEDBACK_URL` 환경변수로 지정합니다. 생략하면 `http://localhost:3000`.
  - 배포 서버 대상: `FEEDBACK_URL=https://fn0113.up.railway.app`
  - **이 세션의 아웃바운드 네트워크 정책이 배포 서버 호스트를 막고 있으면 curl/node가 `CONNECT` 단계에서 거부됩니다.** 이 경우 재시도해도 소용없으니 사용자에게 네트워크 정책이 열린 환경에서 실행해달라고 안내하고 중단합니다 (원인 진단은 `/root/.ccr/README.md` 참고).

## 실행 절차

**0. 스킬 실행**
사용자 요청을 받으면 이 절차를 시작합니다. 여러 건이 대기 중이면 건별로 1~5를 반복하되, 모두 처리한 뒤 한 번에 요약 보고해도 됩니다.

**1. 피드백 리스트 조회 (mono-server API)**
```bash
FEEDBACK_URL=${FEEDBACK_URL:-http://localhost:3000} \
FEEDBACK_API_KEY=$FEEDBACK_API_KEY \
node scripts/feedback-batch.js list
```
각 항목의 `app_prefix`(어느 프로젝트인지), `category`(bug/improvement), `type`(ui/error/feature), `content`(요청 내용), `page_url`을 확인합니다. 내용이 모호하면 추측하지 말고 `content`와 `page_url`, 관련 프로젝트 코드를 직접 읽어 원인을 파악합니다.

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

**5. 완료 처리 및 처리내용 작성 (mono-server API)**
```bash
FEEDBACK_URL=${FEEDBACK_URL:-http://localhost:3000} \
FEEDBACK_API_KEY=$FEEDBACK_API_KEY \
node scripts/feedback-batch.js resolve <id> "<무엇을 어떻게 고쳤는지, 커밋/브랜치 정보 포함>"
```
처리내용에는 반드시 브랜치명 또는 커밋 해시를 남겨서 나중에 추적 가능하게 합니다.
되돌려야 할 경우 `--reopen` 플래그로 다시 대기 상태로 바꿀 수 있습니다.

## 완료 후 보고

사용자에게 처리한 항목별로 "무엇을 신고했고 → 어떻게 고쳤고 → 어느 브랜치/커밋으로 반영했는지"를 짧게 요약합니다. 원인 파악이 안 되거나 재현이 안 되는 항목은 완료 처리하지 말고 사용자에게 추가 정보를 요청합니다.
