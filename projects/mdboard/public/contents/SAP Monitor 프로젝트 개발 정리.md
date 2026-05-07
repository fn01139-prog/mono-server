# SAP Monitor 프로젝트 개발 정리

> SAP 표준 TCode(SU53 / SM37 / ST22) 오류를 주기적으로 점검하고 알람을 발송하는 백그라운드 모니터링 시스템

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택 변경 이력](#2-기술-스택-변경-이력)
3. [최종 구성 (Node.js + node-rfc)](#3-최종-구성-nodejs--node-rfc)
4. [SAP 테이블 및 RFC 매핑](#4-sap-테이블-및-rfc-매핑)
5. [서버 설정 (servers.properties)](#5-서버-설정-serversproperties)
6. [프로젝트 디렉토리 구조](#6-프로젝트-디렉토리-구조)
7. [각 체커 상세](#7-각-체커-상세)
8. [주요 트러블슈팅](#8-주요-트러블슈팅)
9. [SAP 권한 설정](#9-sap-권한-설정)
10. [대시보드 API](#10-대시보드-api)
11. [미해결 과제](#11-미해결-과제)

---

## 1. 프로젝트 개요

### 목적
SAP 시스템의 3가지 오류 항목을 Node.js 백그라운드 프로세스로 주기적으로 점검하여 이상 발생 시 OS 알람(Notification)으로 통보

### 점검 항목
| TCode | 설명 | 점검 내용 |
|-------|------|---------|
| **SU53** | 권한 실패 평가 | 사용자 권한 실패 이력 |
| **SM37** | 배치잡 모니터링 | Aborted 잡, 장시간 Running 잡(지연) |
| **ST22** | ABAP 런타임 에러 | ABAP 덤프 발생 이력 |

### 주요 기능
- 여러 SAP 서버를 단일 프로그램에서 동시 점검
- 서버별 / 항목별 점검 주기 개별 설정
- 재알람 방지 쿨다운 기능
- 웹 대시보드 (http://localhost:3000)
- OS 네이티브 알림 (node-notifier)

---

## 2. 기술 스택 변경 이력

### Node.js (node-rfc) → Python (pyrfc) → Java (JCo) → Node.js (node-rfc) 최종 채택

| 시도 | 언어 | 문제점 | 결과 |
|------|------|--------|------|
| 1차 | Node.js + node-rfc | Node v24 미지원, Python/VS Build Tools 필요 | ❌ 설치 실패 |
| 2차 | Python 3.14 + pyrfc | Python 3.14 pyrfc 미지원 | ❌ |
| 3차 | Python 3.11 + pyrfc | PyPI 배포 중단 (yanked) | ❌ |
| 4차 | Java + SAP JCo3 | sapjco3.dll 보유, JCo 공식 지원 | ✅ 구현 완료 |
| **최종** | **Node.js + node-rfc** | **NW RFC SDK 연동 후 설치 성공** | ✅ **채택** |

### node-rfc 설치 성공 조건
- Python 3.x + Visual Studio Build Tools (C++ 빌드 도구) 필요
- SAP NW RFC SDK 설치 후 환경변수 설정
  ```
  SAPNWRFC_HOME = C:\nwrfcsdk
  PATH에 C:\nwrfcsdk\lib 추가
  ```

---

## 3. 최종 구성 (Node.js + node-rfc)

### 실행
```bash
node index.js
```

### 접속
- 대시보드: `http://localhost:3000`
- API: `http://localhost:3000/api/status`

### servers.properties 핵심 설정
```properties
server.HQ1.enabled=true
server.HQ1.name=품질계 (HQ1)
server.HQ1.connection_type=direct
server.HQ1.host=192.168.1.10       ← SAP AS 서버 IP
server.HQ1.instance_number=00      ← 인스턴스 번호 (SM51 확인)
server.HQ1.system_id=HQ1
server.HQ1.client=100
server.HQ1.user=RFC_MONITOR
server.HQ1.password=비밀번호
server.HQ1.language=KO
server.HQ1.saprouter=              ← 외부망이면 /H/IP/S/PORT/H/

# 점검 주기 (분)
server.HQ1.interval.su53=5
server.HQ1.interval.sm37=10
server.HQ1.interval.st22=10

# 알람 임계값 (건수)
server.HQ1.threshold.su53=1
server.HQ1.threshold.sm37=1
server.HQ1.threshold.st22=1

# 재알람 쿨다운 (분)
server.HQ1.notification.cooldown_minutes=30
server.HQ1.notification.level=warning
```

---

## 4. SAP 테이블 및 RFC 매핑

### SU53 - 권한 실패

| 방법 | FM/테이블 | 비고 |
|------|----------|------|
| **RFC (채택)** | `SUSR_USER_SU53_READ` | Remote-Enabled, Shared Memory 직접 접근 |
| Fallback | `UST12` | 현재 권한값 (실패 이력 아님) |

**SUSR_USER_SU53_READ 파라미터**
```
IMPORT:
  IV_BNAME              : 사용자ID (공백=전체)
  IV_FROM               : 조회 시작 UTC 타임스탬프 (TIMESTAMPL)
  IV_TO                 : 조회 종료 UTC 타임스탬프
  IV_ALL_SERVERS        : 전체 앱서버 조회 ← 반드시 ' '(공백) 사용
                          'X' 사용 시 SAP 내부 재귀 RFC → "device or resource busy" 오류
  IV_CONVERT_APP_NAME   : 앱명 변환 여부
  IV_MAX_SERVER_ENTRIES : 최대 건수

EXPORT:
  ET_USR07_EXT : 권한 실패 목록 (USR07_EXT_TT)
  ES_RETURN    : 리턴 메시지 (BAPIRET2)
  ET_RFC_ERROR : RFC 오류 목록
```

**ET_USR07_EXT 주요 필드**
```
BNAME     : 사용자 ID
OBJCT     : 권한 오브젝트 (예: S_TCODE)
FIELD     : 권한 필드명
VALUE     : 체크된 값
RC        : 리턴코드 (0=성공, 4/8/12=실패)
TCODE     : 트랜잭션 코드
PROGNAME  : 프로그램명
TIMESTAMP : UTC 타임스탬프
INSTANCE  : 앱서버 인스턴스명
```

---

### SM37 - 배치잡 실패/지연

| 방법 | FM/테이블 | 비고 |
|------|----------|------|
| ~~RFC~~ | ~~`BP_JOB_SELECT`~~ | JOBSELECT_EXPORT 없음, 파라미터 구조 불일치 |
| ~~RFC~~ | ~~`BP_JOB_SELECT_SM37B`~~ | **Normal FM - RFC 호출 불가** |
| ~~테이블~~ | ~~`TBTCO`~~ | **Pool Table - RFC_READ_TABLE 불가** |
| **커스텀 FM 필요** | `Z_GET_SM37_JOBS` | BASIS 1회 작업 필요 |

**BP_JOB_SELECT 파라미터 오류 내역**
- 실제 반환 테이블: `JOBSELECT_JOBLIST` (Tables 파라미터)
- 잘못된 코드의 반환 참조: `JOBSELECT_EXPORT` (존재하지 않음)
- `JOBSEL_PARAM_IN` 구조체(BTCSELECT) 내 필드 구성이 node-rfc와 맞지 않음

**커스텀 FM 코드 (BASIS 요청용)**
```abap
FUNCTION z_get_sm37_jobs.
*"  IMPORTING  VALUE(IV_DATE_FROM) TYPE DATS
*"             VALUE(IV_MAX_ROWS)  TYPE I DEFAULT 200
*"  TABLES     ET_JOBS STRUCTURE TBTCO

  CALL FUNCTION 'BP_JOB_SELECT_SM37B'
    EXPORTING
      jobselect_dialog = 'N'
      jobsel_param_in  = VALUE btcselect(
        jobname   = '*'
        username  = '*'
        from_date = IV_DATE_FROM
        to_date   = sy-datum
        aborted   = 'X'
        running   = 'X'
      )
    TABLES
      jobselect_joblist_b = ET_JOBS
    EXCEPTIONS
      no_jobs_found = 1
      OTHERS        = 2.

  IF lines( ET_JOBS ) > iv_max_rows.
    DELETE ET_JOBS FROM iv_max_rows + 1.
  ENDIF.

ENDFUNCTION.
```

---

### ST22 - 런타임 에러 (ABAP Dump)

| 방법 | FM/테이블 | 비고 |
|------|----------|------|
| ~~테이블~~ | ~~`SNAP`~~ | **Pool Table - RFC_READ_TABLE 불가** (`TABLE_NOT_AVAILABLE`) |
| **테이블 (채택)** | `SNAP_ADT` | 투명 테이블, RFC_READ_TABLE 가능 |
| 커스텀 FM | `Z_GET_ST22_DUMPS` | BASIS 작업 시 SNAP 직접 접근 가능 |

**SNAP vs SNAP_ADT 차이**
| 항목 | SNAP | SNAP_ADT |
|------|------|---------|
| 테이블 유형 | Pool Table | 투명 테이블 |
| RFC_READ_TABLE | ❌ 불가 | ✅ 가능 |
| 저장 내용 | 덤프 전체 (헤더+상세+소스) | 덤프 헤더 요약만 |
| 모니터링 적합성 | - | ✅ 충분 |

**SNAP_ADT 주요 필드**
```
DATUM         : 덤프 날짜
UZEIT         : 덤프 시간
UNAME         : 사용자 이름
AHOST         : 애플리케이션 서버명
MANDT         : 클라이언트
TIMESTAMP     : UTC 타임스탬프
RUNTIME_ERROR : 런타임 에러 유형 (예: SYNTAX_ERROR)
MAINPROG      : 메인 프로그램명
OBJECT_NAME   : 오브젝트명
COMPONENT     : 컴포넌트
```

**ST22 조회 기준 시간**
- `lookback` 설정값 기준 → **실행 주기(`interval.st22`) 기준**으로 변경
- 마지막 점검 이후 발생한 덤프만 조회 (중복 방지)

---

## 5. 서버 설정 (servers.properties)

### ConfigLoader 파싱 규칙
```
server.{서버ID}.{키} = {값}
```

### SapConnection.js 파라미터 매핑
| properties 키 | node-rfc 파라미터 | 설명 |
|--------------|-----------------|------|
| `host` | `ashost` | SAP AS 서버 IP |
| `instance_number` | `sysnr` | 인스턴스 번호 |
| `client` | `client` | 클라이언트 번호 |
| `user` | `user` | RFC 전용 계정 |
| `password` | `passwd` | 비밀번호 |
| `language` | `lang` | 언어 |
| `saprouter` | `saprouter` | SAP Router (외부망) |
| `message_host` | `mshost` | Message Server IP |
| `system_id` | `r3name` | 시스템 SID |

### connection_type
- `direct`: Application Server 직접 접속 (`ashost` + `sysnr`)
- `message`: Message Server 경유 로드밸런싱 (`mshost` + `r3name`)

---

## 6. 프로젝트 디렉토리 구조

```
sapmonitoring_node/
├── index.js                              ← 메인 (Express API 서버 포함)
├── package.json
├── dashboard.html                        ← 웹 대시보드
├── config/
│   └── servers.properties               ← 서버 접속 설정
├── logs/                                ← 자동 생성
└── src/
    ├── ServerMonitor.js                 ← 서버별 스케줄러
    ├── checkers/
    │   ├── Su53Checker.js               ← SU53: SUSR_USER_SU53_READ
    │   ├── Sm37Checker.js               ← SM37: TBTCO (임시, FM 대기중)
    │   └── St22Checker.js               ← ST22: SNAP_ADT
    ├── notifications/
    │   └── NotificationManager.js       ← 알람 (쿨다운 포함)
    └── utils/
        ├── ConfigLoader.js              ← Properties 파서
        ├── SapConnection.js             ← node-rfc 래퍼
        └── Logger.js                    ← 로그 유틸
```

---

## 7. 각 체커 상세

### Su53Checker.js
```javascript
// RFC 호출
connection.callRfc('SUSR_USER_SU53_READ', {
  IV_BNAME:              '',     // 전체 사용자
  IV_FROM:               fromTs, // UTC 타임스탬프
  IV_TO:                 toTs,
  IV_ALL_SERVERS:        ' ',    // ← 반드시 공백! 'X' 사용 시 오류
  IV_CONVERT_APP_NAME:   'X',
  IV_MAX_SERVER_ENTRIES: 200,
});

// TIMESTAMPL 변환 (UTC 기준)
// 형식: YYYYMMDDHHmmss.0000000
```

### Sm37Checker.js
```javascript
// TBTCO 직접 조회 (커스텀 FM 생성 전 임시)
connection.readTable('TBTCO', fields, [
  "STATUS = 'A'",                      // Aborted
  `AND SDLSTRTDT >= '${dateStr}'`,
], 200);

// Running 잡은 sm37DelayThreshold 초과 시 지연으로 판단
```

### St22Checker.js
```javascript
// SNAP_ADT 조회
// 조회 기준: Date.now() - interval.st22 (실행주기 기준)
connection.readTable('SNAP_ADT', [
  'DATUM', 'UZEIT', 'MANDT', 'UNAME', 'AHOST',
  'TIMESTAMP', 'RUNTIME_ERROR', 'MAINPROG', 'OBJECT_NAME', 'COMPONENT'
], [
  `DATUM >= '${dateStr}'`,
  `AND UZEIT >= '${timeStr}'`,  // 같은 날짜일 때만
], 200);
```

---

## 8. 주요 트러블슈팅

### ① node-rfc 설치 오류 (Python 미설치)
```
gyp ERR! find Python - Could not find any Python installation
```
**해결:** Visual Studio Build Tools 설치 + Python 설치

### ② 경로 오류 (`Cannot find module './utils/ConfigLoader'`)
**원인:** `index.js`를 `src/` 안에 두지 않고 루트에서 실행  
**해결:** `require('./src/utils/ConfigLoader')` 로 경로 수정

### ③ SNAP 테이블 조회 불가 (`TABLE_NOT_AVAILABLE`)
**원인:** SNAP은 Pool Table → RFC_READ_TABLE 원천 불가  
**해결:** `SNAP_ADT` (투명 테이블) 로 변경

### ④ TBTCO 조회 불가 (`ID:AD Type:E Number:718`)
**원인:** TBTCO도 Pool Table  
**해결 예정:** 커스텀 FM `Z_GET_SM37_JOBS` 생성 (BASIS 작업 필요)

### ⑤ SU53 `device or resource busy`
**원인:** `IV_ALL_SERVERS='X'` 설정 시 SAP 내부에서 모든 앱서버에 RFC 재귀 호출 → node-rfc 연결 풀 점유 중 충돌  
**해결:** `IV_ALL_SERVERS=' '` (공백) 으로 변경 → 로컬 서버만 조회

### ⑥ BP_JOB_SELECT 파라미터 오류
**원인:**
- 반환 테이블명 오류: `JOBSELECT_EXPORT` → 실제는 `JOBSELECT_JOBLIST` (Tables 파라미터)
- `BP_JOB_SELECT_SM37B`는 Normal FM → RFC 호출 불가

### ⑦ BP_JOB_SELECT_SM37B RFC 불가
**원인:** `처리 유형: Normal Function Module` (Remote-Enabled 아님)  
**해결:** 커스텀 RFC FM 내부에서 호출하는 방식으로 우회

---

## 9. SAP 권한 설정

RFC_MONITOR 사용자에게 필요한 최소 권한:

```
S_RFC:
  ACTVT: 16
  RFC_TYPE: FUGR
  RFC_NAME: SUSE        ← SU53 (SUSR_USER_SU53_READ)
             SYST        ← ST22 (RFC_READ_TABLE)
             SDTX        ← RFC_READ_TABLE 함수 그룹

S_USER_GRP:
  CLASS: *
  ACTVT: 03             ← 다른 사용자 SU53 조회 시 필요

S_TABU_DIS:
  DICBERCLS: SS
  ACTVT: 03             ← SNAP_ADT 조회

S_BTCH_JOB:
  JOBACTION: SHOW
  JOBGROUP: *           ← SM37 (커스텀 FM 사용 시)
```

---

## 10. 대시보드 API

### 엔드포인트
| URL | 설명 |
|-----|------|
| `GET /` | dashboard.html 서빙 |
| `GET /api/status` | 전체 상태 + 이슈 목록 |
| `GET /api/issues?type=ST22&server=HQ1` | 필터링된 이슈 목록 |

### /api/status 응답 구조
```json
{
  "issues": [
    {
      "type": "ST22",
      "severity": "error",
      "serverId": "HQ1",
      "serverName": "품질계 (HQ1)",
      "description": "런타임 에러: [ZTEST] SYNTAX_ERROR",
      "detail": "덤프유형: SYNTAX_ERROR | 사용자: TEST_USER",
      "time": "2026-04-27 12:30:00",
      "_id": "HQ1_ST22_1714xxx_abc12",
      "_time": 1714200600000
    }
  ],
  "statusMap": {
    "HQ1": {
      "su53": { "lastCheck": "2026. 4. 27. PM 12:30:00", "lastCount": 0, "error": null, "interval": "5분" },
      "sm37": { "lastCheck": "2026. 4. 27. PM 12:30:00", "lastCount": 0, "error": null, "interval": "10분" },
      "st22": { "lastCheck": "2026. 4. 27. PM 12:30:00", "lastCount": 0, "error": null, "interval": "10분" }
    }
  },
  "updatedAt": "2026-04-27T03:30:00.000Z"
}
```

### 포트 변경
```cmd
set PORT=8080 && node index.js
```

---

## 11. 미해결 과제

### SM37 - 커스텀 FM 생성 필요

BASIS 담당자에게 아래 FM 생성 요청:

**SE37 생성 정보**
```
함수명:   Z_GET_SM37_JOBS
함수그룹: (기존 Z 그룹 또는 신규)
속성:     Remote-Enabled Module 체크 ← 필수
```

**ABAP 소스코드**
```abap
FUNCTION z_get_sm37_jobs.
*"----------------------------------------------------------------------
*"*"로컬 인터페이스:
*"  IMPORTING
*"     VALUE(IV_DATE_FROM) TYPE  DATS
*"     VALUE(IV_MAX_ROWS)  TYPE  I DEFAULT 200
*"  TABLES
*"     ET_JOBS STRUCTURE TBTCJOB
*"----------------------------------------------------------------------

  DATA: ls_sel TYPE btcselect.

  ls_sel-jobname   = '*'.
  ls_sel-username  = '*'.
  ls_sel-from_date = IV_DATE_FROM.
  ls_sel-to_date   = sy-datum.
  ls_sel-aborted   = 'X'.
  ls_sel-running   = 'X'.

  CALL FUNCTION 'BP_JOB_SELECT_SM37B'
    EXPORTING
      jobselect_dialog    = 'N'
      jobsel_param_in     = ls_sel
    TABLES
      jobselect_joblist_b = ET_JOBS
    EXCEPTIONS
      no_jobs_found       = 1
      OTHERS              = 2.

  IF lines( ET_JOBS ) > IV_MAX_ROWS.
    DELETE ET_JOBS FROM IV_MAX_ROWS + 1.
  ENDIF.

ENDFUNCTION.
```

**SE37 테스트**
```
IV_DATE_FROM: 20240101
IV_MAX_ROWS:  10
→ ET_JOBS에 데이터 나오면 성공
```

FM 생성 완료 후 `Sm37Checker.js`를 `callRfc('Z_GET_SM37_JOBS', ...)` 방식으로 수정 예정.

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|---------|
| 초기 | Node.js + node-rfc 기반 설계 |
| - | node-rfc 설치 실패 → Python 전환 시도 |
| - | pyrfc PyPI 배포 중단 → Java JCo 전환 |
| - | node-rfc NW RFC SDK 연동으로 설치 성공 → Node.js 채택 |
| - | SNAP Pool Table 문제 발견 → SNAP_ADT 전환 |
| - | TBTCO Pool Table 문제 발견 → 커스텀 FM 대기 |
| - | BP_JOB_SELECT 파라미터 오류 수정 → TBTCO 직접 조회로 전환 |
| - | SU53: SUSR_USER_AUTH_FOR_OBJ_GET → SUSR_USER_SU53_READ 전환 |
| - | SU53 `device or resource busy` → `IV_ALL_SERVERS=' '` 수정 |
| - | ST22 조회 기준: lookback → interval(실행주기) 기준으로 변경 |
| - | 대시보드: Mock 데이터 → 실제 API 연동으로 전환 |
