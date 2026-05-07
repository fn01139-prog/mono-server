# SAP ABAP MCP 서버 — 구조 및 분석 가이드

---

## 목차

1. [MCP란?](#1-mcp란)
2. [MCP에서 SAP 접속 처리](#2-mcp에서-sap-접속-처리)
3. [파일 구조와 역할](#3-파일-구조와-역할)
4. [Claude에서 SAP 소스 분석 흐름](#4-claude에서-sap-소스-분석-흐름)
5. [Tool 목록 및 ADT 엔드포인트 매핑](#5-tool-목록-및-adt-엔드포인트-매핑)
6. [RFC 접속 방식 비교](#6-rfc-접속-방식-비교)
7. [안전장치 구현 현황](#7-안전장치-구현-현황)
8. [현재 구현된 사항](#8-현재-구현된-사항)
9. [추후 구현할 수 있는 사항](#9-추후-구현할-수-있는-사항)
10. [보완 포인트](#10-보완-포인트)

---

## 1. MCP란?

**MCP(Model Context Protocol)** 는 Anthropic이 정의한 공개 표준으로, AI 모델(Claude)이 외부 시스템의 기능을 **Tool**로 호출할 수 있게 해주는 인터페이스입니다.  
USB-C처럼 "연결 규격"을 통일한 것으로 이해하면 됩니다.

### 구성 계층

```
Claude Code CLI  ←──JSON-RPC (stdio)──→  MCP Server  ←──HTTPS──→  SAP ADT REST API
```

| 계층 | 역할 |
|---|---|
| Host (Claude Code CLI) | 사용자 요청 수신 · Tool 호출 · 응답 표시 |
| MCP Server (index.js) | Tool 목록 선언 · 요청 라우팅 · 실행 |
| External System (SAP) | 실제 데이터 처리 · 소스 반환 |

### 통신 방식

- Claude Code CLI가 `settings.json`에 등록된 `index.js`를 **stdio 방식**으로 기동
- 양방향 **JSON-RPC 2.0** 으로 Tool 목록 조회 및 실행 요청을 주고받음
- MCP Server → SAP 구간은 순수 **HTTPS** 통신 (axios)

### settings.json 등록 예시

```json
{
  "mcpServers": {
    "sap-abap": {
      "command": "node",
      "args": ["D:/claude/abapadt/src/index.js"],
      "env": {
        "SAP_ADT_URL": "https://sap-host:44300/sap/bc/adt",
        "SAP_USER":    "개발계정ID",
        "SAP_PASS":    "비밀번호",
        "SAP_CLIENT":  "300",
        "LOCAL_DIR":   "D:/claude/abapadt/source"
      }
    }
  }
}
```

### CLI 등록 명령

```bash
claude mcp add sap-abap node D:/claude/abapadt/src/index.js \
  -e SAP_ADT_URL=https://sap-host:44300/sap/bc/adt \
  -e SAP_USER=개발계정ID \
  -e SAP_PASS=비밀번호 \
  -e SAP_CLIENT=300 \
  -e LOCAL_DIR=D:/claude/abapadt/source
```

---

## 2. MCP에서 SAP 접속 처리

### 연결 설정 (sapClient.js)

SAP ADT REST API에 HTTP Basic Auth로 접속합니다. RFC 라이브러리(node-rfc, PyRFC)는 사용하지 않습니다.

```js
const CFG = {
  baseURL:  process.env.SAP_ADT_URL,   // https://sap-host:44300/sap/bc/adt
  user:     process.env.SAP_USER,
  pass:     process.env.SAP_PASS,
  client:   process.env.SAP_CLIENT,    // 300 (개발) / 100 (운영 — PUT 차단)
  localDir: process.env.LOCAL_DIR
};

export const http = axios.create({
  baseURL:    CFG.baseURL,
  auth:       { username: CFG.user, password: CFG.pass },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }), // 사내망 SSL 우회
  headers:    { 'sap-client': CFG.client }
});
```

### SAP 시스템 정보

| 항목 | 값 |
|---|---|
| 개발 클라이언트 | 300 (PUT · 활성화 허용) |
| 운영 클라이언트 | 100 (읽기 전용 — 코드로 차단) |
| ABAP 버전 | SAP HANA 2023 |
| SAP BASIS | 758 |
| 소스 로컬 저장 경로 | `D:\claude\abapadt\source` |

---

## 3. 파일 구조와 역할

```
src/
├── index.js       MCP 서버 진입점 — Tool 선언 · 라우팅
├── tools.js       비즈니스 로직 — SAP ADT 호출 함수 구현
└── sapClient.js   공통 레이어 — axios · CSRF · 로컬 파일 I/O
```

### index.js

- `ListToolsRequestSchema` 핸들러: Tool 8종을 JSON Schema로 Claude에 선언
- `CallToolRequestSchema` 핸들러: `switch(name)`으로 tools.js 함수 라우팅
- 결과를 `{ content: [{ type: 'text', text }] }` 형태로 반환

### tools.js

| 함수 | 설명 |
|---|---|
| `getSource` | PROG / INCL / FUNC / FUGR / CLAS 소스 조회 + 로컬 저장 |
| `getDependencies` | Include · CALL FUNCTION · Class 정적 분석 |
| `searchObjects` | 오브젝트명 패턴 검색 |
| `putSource` | 수정 소스 SAP 반영 (개발계 전용) |
| `activateObject` | 오브젝트 활성화 |
| `getLocalSource` | 로컬 캐시 파일 읽기 (SAP 미호출) |
| `readTable` | SE16 방식 테이블 데이터 조회 |
| `getTableSpec` | DD03L + DD03T 병렬 조회로 필드 명세 반환 |

### sapClient.js

- `http`: 인증·헤더 포함 axios 인스턴스
- `getCsrfToken()`: CSRF 토큰 Fetch (쓰기 요청 전 호출)
- `saveLocal()` / `readLocal()`: 로컬 파일 저장·읽기

---

## 4. Claude에서 SAP 소스 분석 흐름

```
① 사용자 요청
   "프로그램 ZMM_ORDER 분석해줘"
        │
        ▼
② Claude Tool 선택
   sap_get_source(objName='ZMM_ORDER', objType='PROG') 호출 결정
        │
        ▼
③ MCP Server → SAP ADT REST 호출
   GET /programs/programs/ZMM_ORDER/source/main
        │
        ▼
④ SAP 서버 내부 처리 후 ABAP 소스 반환
        │
        ▼
⑤ MCP Server → 로컬 저장 + Claude에 소스 전달
   D:\claude\abapadt\source\ZMM_ORDER.prog.abap
        │
        ▼
⑥ Claude AI 분석
   로직 설명 · 버그 탐지 · 개선안 제안 · 성능 문제 확인
```

### 연관 오브젝트 연계 분석

필요 시 추가 Tool을 자동 호출해 연관 오브젝트까지 분석합니다.

```
sap_get_dependencies → Include · FM · Class 목록 확인
        │
        ├─ sap_get_source(각 Include)
        ├─ sap_get_source(FUNC, 각 FM)
        └─ sap_get_source(CLAS, 각 Class)
```

### 소스 수정 표준 절차 (CLAUDE.md 정의)

```
1. sap_get_dependencies   연관 오브젝트 전체 파악
2. sap_get_source         관련 소스 로컬 수집
3. 수정 범위 분석 후 사용자에게 보고 및 확인
4. sap_put_source         승인 후 SAP 반영
5. sap_activate           활성화
6. 수정 내역 요약 리포트 출력
```

> **절대 금지**: 사용자 확인 없이 `sap_put_source` 실행 금지 / `SAP_CLIENT=100` 환경에서 PUT 금지

---

## 5. Tool 목록 및 ADT 엔드포인트 매핑

| MCP Tool | ADT REST 엔드포인트 | HTTP 방식 | 비고 |
|---|---|---|---|
| `sap_get_source` (PROG/INCL) | `/programs/programs/{name}/source/main` | GET | |
| `sap_get_source` (CLAS) | `/oo/classes/{name}/source/main` | GET | |
| `sap_get_source` (FUNC) | `/functions/groups/{fg}/fmodules/{fm}/source/main` | GET | FM 소속 FUGR 자동 검색 |
| `sap_get_source` (FUGR) | 위 FUNC 엔드포인트 반복 | GET | 커스텀 FM 전체 저장 |
| `sap_get_dependencies` | `/programs/programs/{name}/includes` + 소스 정규식 | GET | 정적 분석 병행 |
| `sap_search` | `/repository/informationsystem/search` | GET | 와일드카드 `*` 지원 |
| `sap_get_local` | — (fs.readFileSync) | 로컬 | SAP 미호출 |
| `sap_put_source` | CSRF Fetch → 각 타입별 URL | PUT | 개발계(300) 전용 |
| `sap_activate` | `/activation` (XML body) | POST | `adtcore:objectReferences` |
| `sap_read_table` | `/function/RFC_READ_TABLE` → `/datapreview/freestyle` | POST/GET | fallback 구조 |
| `sap_get_table_spec` | `readTable('DD03L')` + `readTable('DD03T')` | POST/GET | Promise.all 병렬 |

### FUGR 소스 조회 흐름

```
sap_get_source(FUGR)
  │
  ├─ GET /functions/groups/{FUGR}/fmodules        FM 목록 조회 (XML 파싱)
  │
  └─ for each FM (Z* 필터):
       GET /functions/groups/{FUGR}/fmodules/{FM}/source/main
       └─ 로컬 저장: {FUGR}_{FM}.func.abap
```

---

## 6. RFC 접속 방식 비교

이 프로젝트는 **ADT REST API** 방식을 사용합니다. RFC 직접 접속은 대안으로 고려할 수 있는 별개의 방식입니다.

| 항목 | ADT REST API (현재 방식) | RFC 직접 접속 (대안) |
|---|---|---|
| 통신 프로토콜 | HTTPS (axios) | RFC 전용 프로토콜 (port 3300) |
| 라이브러리 | axios (표준 npm) | node-rfc / PyRFC |
| SAP NW RFC SDK | 불필요 | 로컬 설치 필요 |
| 인증 | Basic Auth + CSRF 토큰 | logon ticket / SNC |
| 호출 예시 | `POST /function/RFC_READ_TABLE` | `client.call('RFC_READ_TABLE', params)` |
| 설정 난이도 | 낮음 | 높음 (SDK 설치 · 환경변수 설정) |
| 사용 가능 기능 | ADT가 노출한 기능 범위 | RFC FM 전체 직접 호출 가능 |

### `/function/RFC_READ_TABLE` 오해 포인트

```
MCP Server (axios) ──HTTPS──▶ SAP ADT REST 엔드포인트
                               └─ SAP 서버 내부에서 RFC_READ_TABLE FM 실행
                                        (RFC는 서버 내부에서만 발생)
```

MCP Server 관점에서는 RFC와 무관한 순수 HTTP 호출입니다. URL에 `RFC_READ_TABLE`이 포함되어 있지만, 이는 SAP ADT가 해당 FM을 REST로 래핑한 엔드포인트 이름입니다.

---

## 7. 안전장치 구현 현황

### 운영 클라이언트 차단 (tools.js)

```js
// putSource 함수 내
const client = process.env.SAP_CLIENT;
if (client === '100') {
  throw new Error('🚨 운영 클라이언트(100)에는 PUT 불가. 개발 클라이언트 사용.');
}
```

### CSRF 토큰 처리 (sapClient.js)

쓰기 요청(PUT · POST) 전마다 토큰을 새로 취득해 SAP의 CSRF 보호를 준수합니다.

```js
export async function getCsrfToken() {
  const res = await http.get('/programs/programs', {
    headers: { 'x-csrf-token': 'Fetch' }
  });
  return res.headers['x-csrf-token'];
}
```

### 로컬 파일 자동 동기화

소스 반영(`putSource`) 후 로컬 파일도 자동 갱신해 SAP 서버와 항상 일치시킵니다.

```js
const filepath = saveLocal(objName, objType, modifiedSource);
return { objName, filepath, message: '소스 반영 완료' };
```

---

## 8. 현재 구현된 사항

| 분류 | 내용 |
|---|---|
| 소스 조회 | ABAP Program / Function Module / Function Group / Class / Interface / Include |
| 의존성 분석 | Include 목록 · CALL FUNCTION · PERFORM IN PROGRAM · CLASS(NEW) 정적 추출 |
| 오브젝트 검색 | SE80 수준 패턴 검색 (와일드카드 `*`) |
| 소스 반영 | PUT + 로컬 동기화 (개발계 전용, 운영계 자동 차단) |
| 활성화 | XML objectReferences 방식 POST /activation |
| 테이블 조회 | SE16 방식 데이터 조회 (WHERE · 필드 선택 · 최대 행 수) |
| 필드 명세 | DD03L + DD03T 병렬 조회 (키 여부 · 데이터 타입 · 설명) |
| 로컬 캐시 | 조회된 소스 로컬 저장 · 재조회 없이 로컬에서 읽기 |
| Fallback | RFC_READ_TABLE 실패 시 datapreview/freestyle 자동 전환 |

---

## 9. 추후 구현할 수 있는 사항

| 분류 | 내용 |
|---|---|
| 소스 수정 자동화 | Transport 요청 자동 생성 · CTS 연동 |
| 단위 테스트 | ABAP Unit Test 케이스 자동 생성 후 SUNIT_RUN 실행 |
| 정적 분석 연동 | ATC(ABAP Test Cockpit) / Code Inspector 결과 조회 · 개선 제안 |
| 변경 이력 | gCTS(Git) diff 비교 · CTS 요청 이력 분석 |
| 문서화 자동화 | 소스 기반 기술 사양서 · API 문서 자동 생성 |
| 모니터링 | SM21 로그 · ST22 Dump · SM50 프로세스 조회 |
| Where-Used | `RS_WHERE_USED_ELEMENT` 기반 피호출 오브젝트 역추적 |
| 호출 계층 | Call Hierarchy 트리 시각화 |

---

## 10. 보완 포인트

### XML 파싱 안정화

현재 ADT XML 응답을 정규식(`matchAll`)으로 파싱하고 있어, SAP 버전 업그레이드나 namespace 변경 시 파싱이 깨질 위험이 있습니다.

```js
// 현재 (취약)
const fmNames = [...listRes.data.matchAll(/name="([^"]+)"/g)].map(m => m[1]);

// 권장
import { XMLParser } from 'fast-xml-parser';
const parsed = new XMLParser({ ignoreAttributes: false }).parse(listRes.data);
```

### CSRF 토큰 캐싱

현재 쓰기 요청마다 토큰을 새로 Fetch합니다. 동일 세션 내에서는 토큰을 캐싱하면 불필요한 요청을 줄일 수 있습니다.

```js
let _csrfCache = null;
export async function getCsrfToken() {
  if (_csrfCache) return _csrfCache;
  const res = await http.get('/programs/programs', { headers: { 'x-csrf-token': 'Fetch' } });
  _csrfCache = res.headers['x-csrf-token'];
  return _csrfCache;
}
```

### 언어 코드 외부화

`sap_get_table_spec`의 언어 코드가 `'KO'`로 하드코딩되어 있습니다.

```js
// 현재
readTable('DD03T', { where: [`DDLANGUAGE = 'KO'`] })

// 권장
readTable('DD03T', { where: [`DDLANGUAGE = '${process.env.SAP_LANGU || 'K'}'`] })
```

### 대형 소스 Chunking

수천 라인 이상의 프로그램은 Claude context 한도를 초과할 수 있습니다. 소스를 섹션(FORM, METHOD) 단위로 분할 조회하는 전략이 필요합니다.

### 에러 응답 표준화

RFC/ADT 오류 시 SAP의 `BAPIRET2` 구조나 HTTP 오류 코드를 Claude가 해석하기 좋은 메시지로 변환하는 공통 에러 매핑 레이어를 추가하면 디버깅이 쉬워집니다.

---

*SAP BASIS 758 / SAP HANA 2023 / MCP SDK @modelcontextprotocol/sdk 기준*