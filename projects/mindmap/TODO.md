# 마인드맵 추가 개발 목록

## 완료 ✅ (2026-07-01)

### 관계 연결 버그 수정
- `handleRelationClick()` 함수가 존재했지만 `mousedown` 핸들러에 연결되지 않아 관계 생성 불가
- `mousedown` 핸들러 내 `state.relationMode` 분기에 `handleRelationClick(obj.id)` 호출 추가

### PNG 이미지 내보내기
- Canvas 2D API로 직접 렌더링 (외부 라이브러리 없음)
- HiDPI 2× 스케일로 선명한 출력
- 배경 도트 패턴, 관계선(베지어 곡선 + 화살표 + 라벨), 노드(사각형/타원/다이아몬드), 텍스트 줄바꿈 모두 포함
- 보드 제목으로 파일명 자동 지정 (`보드명.png`)
- 상단 `⬇ PNG` 버튼 추가

### 자동 레이아웃 정렬
- DFS 서브트리 너비 계산 기반 트리 레이아웃 (루트 → 자식 방향)
- 관계가 없는 독립 노드는 하단 격자 배치
- 순환 참조 방지 (`seen` Set 사용)
- Undo 지원 (`move` 타입 undo 스냅샷)
- 상단 `⊞ 정렬` 버튼 추가

### 관계 라벨 편집
- 우측 패널 관계 목록 각 항목에 라벨 입력란(`.relation-label-input`) 추가
- Enter / blur 시 `PUT /api/relations/:id` 호출로 DB 저장
- SVG 관계선 중간에 라벨 텍스트 렌더링 (베지어 t=0.5 좌표, `paint-order: stroke`)
- 백엔드 `PUT /relations/:relationId` 라우트 추가

### 노드 검색/필터
- 좌측 패널 상단 검색 입력창 (`#searchInput`) 추가
- 매칭 노드: amber glow 하이라이트 (`.search-match`)
- 비매칭 노드: 25% 투명도 dim 처리 (`.search-dim`)
- 좌측 패널 목록도 실시간 필터링
- 첫 번째 매칭 노드로 뷰포트 자동 팬

---

## 3순위 (고급)

### 보드 복제
- 현재 보드를 복사해 새 마인드맵으로 생성
- `POST /api/boards/:id/duplicate` 백엔드 라우트 필요 (객체·관계 일괄 복사)

### 보드 삭제
- 보드 선택 드롭다운 옆에 삭제 버튼 추가
- 백엔드 `DELETE /api/boards/:id` 라우트는 이미 존재
- 삭제 후 남은 보드 중 첫 번째로 자동 전환 (없으면 새 보드 생성)

### 터치 / 모바일 지원
- 현재 `mousedown` 이벤트만 사용
- `touchstart / touchmove / touchend` 이벤트 추가
- 핀치 줌 지원 (`Touch.targetTouches` 두 손가락 거리)

### 노드 이모지 / 아이콘
- 노드에 이모지 접두어 설정 기능 (이름 앞에 붙여 저장)
- 우측 패널에 이모지 피커 또는 빠른 선택 팔레트 추가
