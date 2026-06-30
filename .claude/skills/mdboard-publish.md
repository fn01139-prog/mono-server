---
name: mdboard-publish
description: 현재 대화에서 정리한 내용을 mdboard에 마크다운 파일로 등록합니다.
---

# mdboard-publish 스킬

사용자가 "mdboard에 등록해줘", "mdboard에 저장해줘", "정리한 내용 올려줘" 등을 요청하면 이 스킬을 실행합니다.

## 실행 절차

1. **파일명 결정**: 사용자가 파일명을 지정하지 않으면 내용에서 H1 제목을 추출하거나 주제에 맞는 한국어 파일명을 제안합니다. (예: `claude-api-정리.md`)

2. **폴더 선택**: 사용자가 폴더를 지정하지 않으면 현재 mdboard 폴더 목록을 조회한 후 적합한 폴더를 제안합니다.
   ```
   curl -s ${MDBOARD_URL:-http://localhost:3000}/mdboard/api/folders
   ```

3. **임시 파일 작성**: 등록할 마크다운 내용을 `/tmp/<파일명>.md`에 씁니다.

4. **등록 실행**:
   ```bash
   MDBOARD_URL=${MDBOARD_URL:-http://localhost:3000} \
   MDBOARD_API_KEY=$MDBOARD_API_KEY \
   node scripts/mdboard-push.js /tmp/<파일명>.md [폴더명] [--overwrite]
   ```

5. **결과 보고**: 등록된 URL과 경로를 사용자에게 알립니다.

## 주의사항

- `MDBOARD_API_KEY` 환경변수가 없으면 먼저 설정을 안내합니다.
- 같은 파일명이 이미 존재하면 사용자에게 덮어쓸지 확인 후 `--overwrite` 플래그를 추가합니다.
- 배포 서버 등록 시: `MDBOARD_URL=https://fn0113.up.railway.app`
