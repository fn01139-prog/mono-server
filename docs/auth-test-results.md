# 통합 인증 시스템 — 테스트 결과

> 작성일: 2026-07-17
> 대상: [auth-design.md](auth-design.md)에 따라 구현된 통합 인증·권한·데이터 격리 시스템
> 방법: 실행 중인 서버(localhost:3000, Railway PostgreSQL 연결)에 대해 실제 브라우저(Chrome DevTools 기반 프리뷰)와 curl로 종단간(end-to-end) 검증. 유닛테스트가 아닌 **실제 서버 + 실제 DB에 대한 라이브 검증**이며, 사용한 테스트 계정은 전부 검증 직후 삭제 완료.

## 결과 요약

**28개 테스트 항목 전부 통과.** 검증 과정에서 실제 버그 4건을 발견해 수정했고, 재검증까지 완료했다.

| 구분 | 항목 수 | 결과 |
|---|---|---|
| Phase 1 — 플랫폼 인증 기반 | 4 | ✅ 전체 통과 |
| Phase 2 — 앱 접근 제어 | 3 | ✅ 전체 통과 |
| Phase 3 — 데이터 격리 (mindmap/travellog/portfolio/floorplan) | 10 | ✅ 전체 통과 |
| Phase 4 — 컨셉 변경 (campchecklist 초대 모델, mdboard 파일 권한) | 6 | ✅ 전체 통과 |
| Phase 5 — 관리자 페이지 | 3 | ✅ 전체 통과 |
| 회귀 확인 — 7개 앱 콘솔 에러 없음 | 7 | ✅ 전체 통과 |

---

## Phase 1 — 플랫폼 인증 기반

| # | 테스트 | 방법 | 결과 |
|---|---|---|---|
| 1-1 | admin 계정으로 로그인 성공 | 브라우저에서 `admin`/`admin1234`로 로그인 폼 제출 | ✅ PASS |
| 1-2 | 허브 페이지가 admin에게 전체 앱(7개) 노출 | 로그인 후 `/` 접근, 카드 개수 확인 | ✅ PASS |
| 1-3 | 신규 사용자 생성 후 허브가 권한 있는 앱만 노출 | `/mdboard`만 권한 부여한 테스트 계정으로 `/` 접근 → mdBoard 카드만 표시, CampCheck 등은 숨김 확인 | ✅ PASS |
| 1-4 | `/auth/me`가 로그인 사용자 정보를 반환 | 로그인 상태에서 fetch, `role` 필드 확인 | ✅ PASS |

## Phase 2 — 앱 접근 제어 (loader 가드)

| # | 테스트 | 방법 | 결과 |
|---|---|---|---|
| 2-1 | 비로그인 상태로 보호된 앱 API 접근 시 401 | `fetch('/travellog/api/trips')` (쿠키 없음) | ✅ PASS (401 JSON) |
| 2-2 | 비로그인 상태로 보호된 앱 페이지 접근 시 `/login` 리다이렉트 | 브라우저로 `/mdboard/` 직접 이동 | ✅ PASS (302 → `/login`) |
| 2-3 | 권한 없는 앱에 로그인 상태로 접근 시 403 | `/campchecklist` 권한 없는 계정으로 `/campchecklist/api/trips` 호출 | ✅ PASS (403 JSON) |

## Phase 3 — 데이터 격리

| # | 앱 | 테스트 | 결과 |
|---|---|---|---|
| 3-1 | mindmap | DB 표준화 후 API 정상 동작 (`mindmap_boards` 등 신규 테이블명) | ✅ PASS |
| 3-2 | mindmap | 신규 사용자는 기존 보드(7개, admin 소유) 안 보이고 본인이 만든 보드만 보임 | ✅ PASS |
| 3-3 | mindmap | admin은 전체 보드(8개, 테스트 보드 포함) 조회 가능 | ✅ PASS |
| 3-4 | travellog | 신규 사용자는 기존 여행 안 보이고, admin 소유 여행을 PUT으로 수정 시도 시 404 | ✅ PASS |
| 3-5 | portfolio | 신규 사용자는 본인 페이지 목록만 조회 (`GET /pages`) | ✅ PASS |
| 3-6 | portfolio | `status='published'` 페이지는 **비로그인 상태로도** 조회 가능 | ✅ PASS |
| 3-7 | portfolio | `status='draft'` 페이지는 비로그인 시 404 (소유자 외 비공개) | ✅ PASS |
| 3-8 | portfolio | `studio.html`은 정적 경로로 직접 요청해도 로그인 필요 (publicPaths 우회 방지) | ✅ PASS |
| 3-9 | floorplan | 로그인 사용자는 **전체 템플릿 목록** 조회 가능 (소유자 무관) | ✅ PASS |
| 3-10 | floorplan | 타인 템플릿은 `canEdit: false`로 표시되고 PUT 시도 시 403 | ✅ PASS |

## Phase 4 — 컨셉 변경

| # | 앱 | 테스트 | 결과 |
|---|---|---|---|
| 4-1 | campchecklist | 생성자(owner)가 만든 일정에 특정 사용자만 초대 가능 | ✅ PASS |
| 4-2 | campchecklist | 초대받은 사용자는 일정 조회 가능, 초대 안 된 사용자(outsider)는 조회 목록에서 제외 | ✅ PASS |
| 4-3 | campchecklist | 참여자(비소유자)는 일정 수정(PUT) 및 참여자 관리(PUT participants) 시도 시 404 | ✅ PASS |
| 4-4 | mdboard | 소유자가 저장한 파일은 목록/조회 API에서 타 사용자에게 노출되지 않음 (404) | ✅ PASS |
| 4-5 | mdboard | 소유자가 `read` 권한 공유 시 대상 사용자는 조회 가능해지지만 쓰기(PUT)는 여전히 403 | ✅ PASS |
| 4-6 | mdboard | 소유자가 `write` 권한으로 승격 시 대상 사용자의 쓰기 성공 | ✅ PASS |

## Phase 5 — 관리자 페이지 (`/admin`)

| # | 테스트 | 방법 | 결과 |
|---|---|---|---|
| 5-1 | 사용자 생성 (이름/아이디/비번/앱 권한) | 실제 UI 폼 입력 → 제출 → 목록에 즉시 반영 확인 | ✅ PASS |
| 5-2 | 앱 권한 편집 모달에서 체크박스 변경 후 저장 | UI 클릭으로 `/travellog` 권한 추가 → API로 저장 값 확인 | ✅ PASS |
| 5-3 | 사용자 삭제 (confirm 다이얼로그 포함) | UI에서 삭제 버튼 클릭 → confirm 승인 → 목록에서 제거 확인 | ✅ PASS |

## 회귀 확인 — 전체 앱 콘솔 에러 없음

7개 앱(`mdboard`, `portfolio`(+studio), `floorplan`, `travellog`, `mindmap`, `campchecklist`, `aptloan`) 전부 브라우저로 직접 로드해 콘솔 에러 0건 확인. `Auth`/`localStorage` 토큰 기반 구코드 제거 후에도 페이지가 깨지지 않음을 확인.

---

## 검증 중 발견해 수정한 실제 버그

구현 직후 자체 검증 과정에서 아래 4건을 발견했고, 전부 수정 후 재검증까지 완료했다.

### 1. 로그아웃 시 쿠키가 실제로 지워지지 않음
`res.clearCookie()`를 옵션 없이 호출하면 브라우저가 `httpOnly`/`sameSite`/`secure` 속성이 다른 쿠키로 인식해 삭제하지 않는다. 로그아웃 후에도 `/auth/me`가 200을 반환하던 문제. → `clearAuthCookie()`에 로그인 시와 동일한 옵션을 명시해 해결 (`core/auth.js`).

### 2. floorplan 이름 재사용으로 소유권 검사 우회 가능
`POST /floorplans`가 이름에서 파생된 id로 항상 upsert했는데, 기존 파일 존재 여부·소유권을 확인하지 않아 **다른 사용자가 같은 이름으로 저장하면 소유권 검사 없이 덮어쓸 수 있었다**. → 저장 전 기존 id 존재 확인 + 소유권 검사 추가 (`projects/floorplan/index.js`).

### 3. `publicPaths`가 API/정적 마운트에서 서로 다른 의미인데 하나의 목록을 공유
API 마운트(`/portfolio/api`)와 정적 마운트(`/portfolio`)는 `req.path`가 서로 다른 상대경로 체계를 쓰는데, 초기 구현은 `config.publicPaths` 하나만 두 곳에 동시 적용했다. 그 결과 `/*` 와일드카드가 정적 마운트뿐 아니라 API 마운트의 `GET /pages`(목록, 로그인 필요)까지 공개해버리는 문제가 있었다. → `publicPaths`(API용)와 `publicStaticPaths`(정적/SPA용)로 분리 (`core/loader.js`, `projects/portfolio/config.js`).

### 4. `req.path`가 라우터 마운트 깊이에 따라 잘려서 JSON/HTML 응답 분기가 무력화됨
`wantsJson()`이 `req.path.startsWith('/auth')`, `req.path.includes('/api/')`로 판단했는데, Express는 `app.use(mountPath, router)`로 마운트된 라우터 내부에서 `req.path`를 마운트 경로 기준 상대경로로 잘라낸다. 그 결과 `/auth/me` 같은 라우트 내부에서는 이 조건이 항상 거짓이 되어, **비로그인 상태로 `fetch('/auth/me')`를 호출하면 401 JSON 대신 `/login`으로 302 리다이렉트되고, `fetch()`가 이를 자동으로 따라가 로그인 페이지 HTML을 200으로 반환**하는 문제가 있었다 (API 소비자 입장에서는 세션이 살아있는 것처럼 보이는 혼란스러운 동작). → 마운트 깊이와 무관하게 항상 전체 경로를 유지하는 `req.originalUrl` 기준으로 변경 (`core/auth.js`).

---

## 확인된 한계 / 의도적으로 보류한 사항

- **`camp_users`/`camp_accounts` 테이블 미삭제**: 설계 문서는 이 테이블들의 제거를 명시했으나, 라이브 프로덕션 DB에 대한 `DROP TABLE`은 되돌리기 어려운 작업이라 이번 구현에서는 보류했다. 데이터는 `platform_*` 테이블로 전부 이관되었고 애플리케이션 코드에서는 더 이상 참조하지 않는다 (FK도 `platform_users`로 재지정 완료) — 운영 확인 후 별도로 정리 권장.
- **로그인 rate limiter의 부작용**: `express-rate-limit`이 인메모리 저장소를 쓰기 때문에 서버 재시작 시 초기화된다. 이번 검증 중 반복 로그인/로그아웃으로 실제로 rate limit(15분/10회)에 걸린 것을 확인했다 — 설계대로 동작하는 것이지만, 다중 프로세스로 배포 시 인스턴스별로 카운터가 분리된다는 점은 참고할 것.
- **부트스트랩 admin 비밀번호**: `admin` / `admin1234`가 기본값으로 생성되어 있다. **최초 로그인 후 반드시 `/admin` 페이지 또는 `PUT /auth/admin/users/:id`로 비밀번호를 변경해야 한다.**
