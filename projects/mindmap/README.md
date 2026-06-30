# mindmap (mono-server 서브 프로젝트)

기존 mono-server 컨벤션(`config.js + index.js + public/`)을 그대로 따른
마인드맵 기능입니다. Railway PostgreSQL을 데이터 저장소로 사용합니다.

## 1. 설치

```bash
cd mono-server
cp -r <이 폴더>/mindmap projects/mindmap

# pg 드라이버 추가 (mono-server 루트 package.json에)
npm install pg
```

`core/loader.js`가 `projects/` 를 스캔해서 `config.js`(enabled: true)를 보면
자동으로 마운트합니다. 기존 mdboard/portfolio가 동작하는 방식과 동일합니다.

> `index.js`가 `../../shared/utils`(asyncHandler, ok, fail)를 require합니다.
> 경로나 시그니처가 다르면 `index.js` 상단의 try/catch 블록만 맞춰 수정하면 됩니다.
> (없어도 자체 fallback 구현이 동작하므로 당장 깨지지는 않습니다.)

## 2. Railway PostgreSQL 추가

1. Railway 프로젝트 → **New → Database → PostgreSQL** 추가
2. 같은 프로젝트의 mono-server 서비스에 `DATABASE_URL` 환경변수가 자동으로 연결되어 들어옵니다
   (Railway가 서비스 간 변수 참조를 자동 주입해줍니다. 안 들어오면 Variables 탭에서
   `${{Postgres.DATABASE_URL}}` 형태로 직접 reference 추가)
3. 스키마 생성 (로컬에서 Railway DB로 1회 실행):

```bash
# Railway CLI 사용 시
railway run psql "$DATABASE_URL" -f projects/mindmap/db/schema.sql

# 또는 DATABASE_URL을 Railway 대시보드에서 복사해서 직접
psql "postgresql://..." -f projects/mindmap/db/schema.sql
```

## 3. 접속

```
https://fn0113.up.railway.app/mindmap/
```

## 4. 데이터 구조

| 테이블 | 역할 |
|---|---|
| `mindmap_board` | 화면 상단의 "주제(제목)". 마인드맵을 여러 개 만들 수 있게 최상위로 분리 |
| `object_header` | 항목의 명칭 / 내용 |
| `object_detail` | 항목의 위치(x,y) / 색상 / 크기 / 모양 (1:1) |
| `relation` | 항목 간 부모-자식 연결 (`parent_id`, `child_id`) |
| `object_memo` | 확장 예시 테이블. `object_header.id`를 참조하는 보조 테이블 |

### 확장하는 법

메모 외에 더 기록하고 싶은 정보가 생기면, `object_memo`처럼
**`object_id → object_header(id)`를 참조하는 새 테이블**을 추가하면 됩니다.
예: 첨부파일을 달고 싶다면

```sql
CREATE TABLE object_attachment (
    id         SERIAL PRIMARY KEY,
    object_id  INTEGER NOT NULL REFERENCES object_header(id) ON DELETE CASCADE,
    file_url   TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

그리고 `index.js`에 `GET/POST /api/objects/:objectId/attachments` 같은 라우트만 추가하면
기존 헤더/디테일/관계 구조를 건드리지 않고 확장됩니다.

## 5. 화면 구성

- **상단**: 현재 마인드맵 제목(주제) 입력 + 보드 선택 + 새 보드/새 항목/관계 연결 버튼
- **좌측**: 현재 보드의 항목(object) 목록 — 클릭해서 선택
- **중앙**: 캔버스 — 항목을 드래그로 이동, 부모→자식 곡선으로 관계 표시
- **우측**: 선택된 항목의 명칭/내용/색상/모양/크기 편집, 연결된 관계 목록, 메모

**관계 연결 사용법**: 상단 "관계 연결" 버튼을 누르면 모드 진입 →
부모가 될 항목 클릭 → 자식이 될 항목 클릭 → 자동으로 연결선 생성.
다시 누르면 모드 종료.

## 5-1. 키보드 단축키

해당 버튼에 마우스를 올리면 단축키가 툴팁으로 표시됩니다.

| 단축키 | 동작 |
|---|---|
| `Ctrl+1` | 새 보드 |
| `Ctrl+2` | 새 항목 |
| `Ctrl+3` | 관계 연결 모드 토글 |
| `Ctrl+4` | 선택된 항목의 "명칭" 입력란으로 포커스 이동 |
| `Ctrl+5` | "메모" 입력란으로 포커스 이동 |
| `Ctrl+6` | 선택된 항목 삭제 |
| `Esc` | 관계 연결 모드에서 첫 번째로 클릭한 항목 선택 취소 |

> ⚠️ `Ctrl(⌘)+1~9`는 Chrome/Edge/Firefox 등에서 브라우저 탭 전환 단축키로도 쓰입니다.
> 일반 브라우저 탭으로 열어두면 브라우저가 먼저 가져가서 막상 안 눌릴 수 있어요.
> 이 경우 `public/js/app.js`의 `bindShortcutEvents()` 안 숫자(`case '1'` 등)만
> `Alt+숫자` 조합 등으로 바꿔서 쓰는 걸 추천합니다.

## 6. API 요약

```
GET    /api/boards
POST   /api/boards                       { title }
PUT    /api/boards/:boardId               { title }
DELETE /api/boards/:boardId

GET    /api/boards/:boardId/objects
POST   /api/boards/:boardId/objects       { name, content, pos_x, pos_y, color, width, height, shape }
PUT    /api/objects/:objectId             { name, content }
PUT    /api/objects/:objectId/detail      { pos_x, pos_y, color, width, height, shape }
DELETE /api/objects/:objectId

GET    /api/boards/:boardId/relations
POST   /api/boards/:boardId/relations     { parent_id, child_id, label }
DELETE /api/relations/:relationId

GET    /api/objects/:objectId/memos
POST   /api/objects/:objectId/memos       { memo_type, memo_text }
DELETE /api/memos/:memoId
```

프론트엔드(`public/js/app.js`)는 상대경로(`api/...`)로만 호출하므로
어느 경로에 마운트돼도(`/mindmap` 등) BASE_PATH 이중 적용 문제 없이 동작합니다.

## 7. 알려진 버그 수정 기록

- **`POST /api/boards/null/objects` 404 (수정됨)**: 페이지가 보드 목록을 다 불러오기 전에
  "새 항목"을 누르면(또는 `Ctrl+2`) `state.boardId`가 아직 `null`이라 URL에 `null`이
  그대로 들어가는 문제가 있었습니다. 이제 보드를 다 불러오기 전까지는 "새 항목" /
  "관계 연결" 버튼이 비활성화되고, `createObject()` 내부에도 `state.boardId`가
  없으면 토스트 메시지만 띄우고 멈추는 가드를 추가했습니다.
