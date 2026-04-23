# SAPMZHR0009 ~ SAPMZHR0014 프로그램 분석

> **분석일자**: 2026-04-20  
> **프로그램 유형**: Module Pool (모듈풀)  
> **업무 도메인**: HCM – 복지기금 대출 관리 (HR Loan Management)

---

## 목차

1. [SAPMZHR0009 – 신규대출 승인 관리](#1-sapmzhr0009--신규대출-승인-관리)
2. [SAPMZHR0010 – 중도상환 승인 관리](#2-sapmzhr0010--중도상환-승인-관리)
3. [SAPMZHR0011 – 대출 상환 내역 관리](#3-sapmzhr0011--대출-상환-내역-관리)
4. [SAPMZHR0012 – 대출 집계 현황 조회](#4-sapmzhr0012--대출-집계-현황-조회)
5. [SAPMZHR0013 – 대출 전체 현황 조회 (보증보험 포함)](#5-sapmzhr0013--대출-전체-현황-조회-보증보험-포함)
6. [SAPMZHR0014 – 월별 대출 상환 현황 조회](#6-sapmzhr0014--월별-대출-상환-현황-조회)
7. [공통 사항 정리](#7-공통-사항-정리)

---

## 1. SAPMZHR0009 – 신규대출 승인 관리

### 1.1 개요

| 항목 | 내용 |
|---|---|
| 프로그램 ID | `SAPMZHR0009` |
| T-CODE | `ZHRD0009` (대상), `ZHRF0009` (대상식품) |
| 목적 | 신규 대출 신청 건에 대한 **진행상태 변경 및 대출 완료 처리** |
| Message Class | `ZMHR` |

### 1.2 INCLUDE 구조

| Include | 역할 |
|---|---|
| `MZHR0009TOP` | 전역 데이터 선언 (테이블, 내부 테이블, 클래스) |
| `MZHR0009O01` | PBO 모듈 (화면 초기화, ALV 그리드 생성) |
| `MZHR0009I01` | PAI 모듈 (사용자 명령 처리 – 조회/저장/전체선택/해제) |
| `MZHR0009F01` | FORM 서브루틴 |

### 1.3 주요 전역 데이터

| 변수/테이블 | 설명 |
|---|---|
| `GT_ITAB` | 메인 출력 테이블 (`ZHRT8011` 기반 + 추가 필드) |
| `GT_ITAB_2` | `PA0045` 보험 정보 테이블 |
| `GT_BUKRS`, `GT_WERKS`, `GT_BTRTL`, `GT_ORGEH` | 권한 체크용 범위 테이블 |
| `GS_SELECT` | 조회 조건 (기간, 진행상태, 인원) |
| `LCL_EVENT_RECEIVER` | ALV 툴바 이벤트 (전체선택/해제) 클래스 |

### 1.4 화면 구성 (Screen 0100)

- **조회조건**: 신청일자(FROM~TO), 진행상태
- **ALV Grid**: `CL_GUI_ALV_GRID` 사용, 편집 가능 셀 구성
- **툴바 버튼**: 조회(EXEC), 저장(SAVE), 전체선택(SALL), 전체해제(DALL)

### 1.5 주요 기능

#### 조회 (EXEC_BUTTON)
```
ZHRT8011 조회 (REQID='1' : 신규대출)
→ PA0045 조회 (보험 정보 조인)
→ 권한 체크 (GT_BUKRS, GT_WERKS, GT_BTRTL, GT_ORGEH)
→ PA0001 (성명/부서), HRP1000 (부서명), PA0002 (자격등급)
→ T591S (대출유형), PA0539 (주민번호 앞자리만)
→ PA0009 (급여계좌), PA0105 (연락처)
→ 주민번호 접근 LOG 기록 (Z_RECO_CBO_LOG)
```

#### 저장 (SAVE_BUTTON)
```
선택된 행의 진행상태 CODE 변환 (Text→Code)
→ 상태='5'(대출완료) 이면:
    - 기존 PA0045 삭제 BDC (DELETE_0045)
    - 새 PA0045 삽입 BDC (INSERT_0045) → PA30 트랜잭션
→ 그외 상태: ZHRT8011 테이블 UPDATE만 (UPDATE_ZHRT8011)
```

#### PA0045 BDC 처리 (INSERT_0045)
- 거치기간(GRAPR) 있으면 `MONTH_PLUS_DETERMINE`으로 상환 시작일 계산
- `SAPMP50A` → `MP004500` 화면 시퀀스로 Infotype 0045 신규 등록
- 보험 관련 커스텀 필드 (ZZSECOM, ZZSENUM, ZZSEAMT, ZZSEBET, ZZSEBEG, ZZSEEND, ZZHWG) 포함

#### DELETE_0045 (기존 대출 데이터 삭제)
1. PA0698 지급조건 삭제 (`=DELPAY`)
2. PA0045 삭제 (`=UPDL`)

### 1.6 사용 테이블

| 테이블 | 용도 |
|---|---|
| `ZHRT8011` | 복지기금 대출 신청 (커스텀) |
| `PA0045` | Infotype 0045 – 대출 |
| `PA0001` | Infotype 0001 – 조직배정 |
| `PA0002` | Infotype 0002 – 인적사항 |
| `PA0009` | Infotype 0009 – 급여계좌 |
| `PA0105` | Infotype 0105 – 연락처 |
| `PA0539` | Infotype 0539 – 주민번호 |
| `PA0000` | Infotype 0000 – 입사일 |
| `HRP1000` | 조직 오브젝트 텍스트 |
| `T591S` | Infotype 하위유형 텍스트 |
| `BNKA` | 은행 정보 |

### 1.7 사용 Function Module

| FM | 용도 |
|---|---|
| `ZHR_GET_ORGIN` | 권한 체크 (커스텀) |
| `TB_DOMAINVALUE_GET_TEXT` | 도메인 값 텍스트 변환 |
| `TB_DOMAINVALUES_GET` | 도메인 값 목록 조회 (Dropdown) |
| `DATE_STRING_CONVERT` | 날짜 계산 |
| `MONTH_PLUS_DETERMINE` | 개월 수 더하기 |
| `POPUP_TO_CONFIRM` | 확인 팝업 |
| `Z_RECO_CBO_LOG` | 개인정보 접근 로그 (커스텀) |

### 1.8 변경 이력

| 날짜 | 내용 |
|---|---|
| 2008.07.07 | 대상↔대상식품 이동 사원 처리 BDC 수정 (BY KI) |
| 2009.01.09 | 대상/대상식품 통합 조회 (박성원 요청, BY KI) |
| 2009.09.29 | 급여/상여 원금 수정 가능하도록 변경 (박성원 요청, BY LHS) |
| 2012.01.06 | 급여계좌 컬럼 추가 (정수정 요청, BY LEJ) |
| 2012.04.12 | 전체선택/해제 버튼 추가 (BY LEJ) |
| 2012.08.03 | 표준보안 – 개인정보 접근 LOG 기록 추가 (BY LEJ) |
| 2012.10.31 | 입사일 컬럼 추가 (박성원 요청, BY LEJ) |
| 2015.04.01 | 연락처 컬럼 추가 (박성원 요청, BY JHW) |
| W-IT 프로젝트 | 권한 체크 로직 추가 (GT_BUKRS/WERKS/BTRTL/ORGEH) |

---

## 2. SAPMZHR0010 – 중도상환 승인 관리

### 2.1 개요

| 항목 | 내용 |
|---|---|
| 프로그램 ID | `SAPMZHR0010` |
| T-CODE | `ZHRD0010`, `ZHRF0010` |
| 목적 | 복지기금 대출 **중도상환 신청 건의 진행상태 변경 및 전표 생성** |
| Message Class | `ZMHR` |
| 특이사항 | 2025.09.11 RFC 변경: `ZFI_HR_CLEAN_LOAN` → `ZHR_FI_CLEAN_LOAN` (CTS: HD1K900041) |

### 2.2 INCLUDE 구조

| Include | 역할 |
|---|---|
| `MZHR0010TOP` | 전역 데이터 (EXCEL 출력 관련 타입 포함) |
| `MZHR0010O01` | PBO 모듈 |
| `MZHR0010I01` | PAI 모듈 |
| `MZHR0010F01` | FORM 서브루틴 |

### 2.3 주요 전역 데이터

| 변수/테이블 | 설명 |
|---|---|
| `GT_ITAB` | 중도상환 목록 (ZHRT8011 + PA0001 조인) |
| `GS_SELECT` | 조회 조건 (중도상환일 기간, 진행상태) |
| `G_REPYMT1`, `G_REPYMT2` | 대출잔액 계산용 상환 합계 |
| `GS_8012`, `GS_8012_TEMP` | ZHRT8012 레코드 |
| Excel 관련 | `I_OI_DOCUMENT_PROXY`, `I_OI_SPREADSHEET` – 증빙첨부서 출력 |
| `GT_DD07V` | ZZFLAG 도메인 Dropdown 값 |

### 2.4 주요 기능

#### 조회 (EXEC_BUTTON)
```
ZHRT8011 + PA0001 INNER JOIN (REQID='2' : 중도상환)
→ 권한 체크 (GT_BUKRS/WERKS/BTRTL/ORGEH)
→ PA0045 BEGDA 조회 (대출 시작일)
→ 대출잔액 계산 (CALC_REMAINDER)
→ 진행상태 = '1'(입금확인)이면 TEMP에 저장 (수정 대비)
```

#### 대출잔액 계산 (CALC_REMAINDER)
```
기준일 기준으로:
- 급여/이자 상환 (PAYID='A','C') : 월말일 기준 ZHRT8012 SUM
- 상여 상환 (PAYID='B') : 10일 기준 ZHRT8012 SUM
잔액 = 대출금(DARBT) - 정기상환합계 - 중도상환합계
```

#### 저장 (SAVE_BUTTON)
| 진행상태 | 처리 내용 |
|---|---|
| `'1'` (입금확인) | ROLLBACK_0078 → INSERT_0078 (IT0078 BDC) → UPDATE_ZHRT8011 → MODIFY_ZHRT8012 |
| `'2'` (입금미확인) | ROLLBACK_0078 → UPDATE_ZHRT8011만 |

#### ROLLBACK_0078
- 기존 입금확인 상태를 수정하는 경우 기존 IT0078 삭제
- 급여 계산 여부 확인 (PA0003-ABRDT): 이미 계산됐으면 경고 팝업 후 진행

#### 전표 생성 (CREATE_BUTTON)
```
ZHR_FI_CLEAN_LOAN (RFC) 호출
→ 성공 시 ZHRT8011.MIDBNR 업데이트
→ 대출유형(DLART)에 따라 G/L 계정 매핑 (GET_HKONT)
```

**G/L 계정 매핑표:**

| 대출유형 | G/L 계정 | 설명 |
|---|---|---|
| 9A01, 9F01 | 13000010 | 대출(일반가계) |
| 9A02, 9A14, 9F02 | 13000020 | 대출(입원가계) |
| 9A04, 9A05, 9A15 | 13000030 | 대출(주택구입) |
| 9A08, 9A16, 9A21, 9A22, 9F05 | 13000040 | 대출(주택전세) |
| 9A11, 9A12, 9A19, 9A20, 9F03, 9F04, 9F06 | 13000050 | 대출(협의회지정) |

#### 증빙첨부서 출력 (PRINT_BUTTON)
- BDS(`ZHR_BDS12`)에서 Excel 템플릿 로드
- `I_OI_SPREADSHEET` 인터페이스로 데이터 삽입 후 화면 300에서 출력
- 인사영역(WERKS)에 따라 담당자 정보 분기 (DS05 vs 기타)

### 2.5 사용 테이블

| 테이블 | 용도 |
|---|---|
| `ZHRT8011` | 복지기금 대출 신청 (커스텀) |
| `ZHRT8012` | 복지기금 상환 내역 (커스텀) |
| `PA0045` | Infotype 0045 – 대출 |
| `PA0001` | Infotype 0001 – 조직배정 |
| `PA0078` | Infotype 0078 – 대출상환 |
| `PA0003` | Infotype 0003 – 급여계산일 |
| `SKAT` | G/L 계정 텍스트 |

### 2.6 사용 Function Module / RFC

| FM/RFC | 용도 |
|---|---|
| `ZHR_FI_CLEAN_LOAN` | FI 중도상환 전표 생성 (RFC, 구 `ZFI_HR_CLEAN_LOAN`) |
| `ZHR_GET_ORGIN` | 권한 체크 |
| `TB_DOMAINVALUES_GET` | 진행상태 Dropdown |
| `POPUP_TO_CONFIRM` | 확인 팝업 |

### 2.7 변경 이력

| 날짜 | 내용 |
|---|---|
| 2009.07.29 | 대상/대상식품 통합 조회 (박성원 요청, BY LHS) |
| 2019.07.22 | G_ERRIF 초기화 추가 |
| 2020.04.13 | 사원대여금 전표발생 불가 처리 추가 |
| 2022.04.13 | 사원대여금(9A50, 9A51) 제외 |
| 2022.06.29 | ZHRT8012 중도상환금액 이중 적재 버그 수정 (월별 합산 로직 변경) |
| 2025.09.11 | `ZFI_HR_CLEAN_LOAN` → `ZHR_FI_CLEAN_LOAN` RFC 변경 (CTS: HD1K900041) |

---

## 3. SAPMZHR0011 – 대출 상환 내역 관리

### 3.1 개요

| 항목 | 내용 |
|---|---|
| 프로그램 ID | `SAPMZHR0011` |
| T-CODE | `ZHRD0011`, `ZHRF0011` |
| 목적 | 사원별 대출 현황 조회 및 **상환 내역 등록/수정/삭제** |
| Message Class | `ZMHR` |
| 화면 구성 | 상단 Grid1(대출 목록) + 하단 Grid2(상환 내역) + 팝업 200(등록/수정) |

### 3.2 INCLUDE 구조

| Include | 역할 |
|---|---|
| `MZHR0011TOP` | 전역 데이터, 이벤트 클래스 |
| `MZHR0011O01` | PBO 모듈 |
| `MZHR0011I01` | PAI 모듈 |
| `MZHR0011F01` | FORM 서브루틴 |

### 3.3 주요 전역 데이터

| 변수/테이블 | 설명 |
|---|---|
| `GT_ITAB` | 사원 대출 목록 (PA0045 기반) |
| `GT_DETAIL` | 상환 내역 (ZHRT8012 기반) |
| `GS_SELECT` | 조회 조건 (사번, 성명, 만기포함 여부) |
| `GS_ZSOLL` | 이자 계산 구조체 (시작일, 종료일, 잔액, 이자율, 이자) |
| `G_ABRDT` | 급여 계산일 (급여 처리 여부 체크) |

### 3.4 이벤트 클래스 (LCL_EVENT_RECEIVER)

| 이벤트 | 버튼 | 기능 |
|---|---|---|
| HANDLE_TOOLBAR | 등록(CRET), 수정(CHAN), 삭제(DELE) | 툴바 커스텀 버튼 |
| HANDLE_USER_COMMAND | - | 버튼 클릭 이벤트 OK_CODE 전달 |
| HANDLE_DOUBLE_CLICK | - | Grid1 더블클릭 시 Grid2 상환내역 조회 |

### 3.5 주요 기능

#### 조회 (EXEC_BUTTON)
```
PA0045 + PA0001 INNER JOIN (사원번호 기준)
→ 권한 체크 적용
→ 대출유형 TEXT (T591S)
→ ZHRT8012 합계로 대출잔액 계산
→ 만기포함 여부(GS_SELECT-ZERO): 잔액≤0 제외/포함
→ T506D에서 이자율 조회
```

#### 상환 내역 조회 (DATA_DETAIL – Grid2)
- ZHRT8012에서 선택된 대출 건의 상환 내역 전체 조회
- IT0078 등록 건수 카운트 (COUNT_0078)
- 상환항목 TEXT 변환 (ZZPAYID 도메인)

#### 등록 (CRET_BUTTON) / 수정 (CHAN_BUTTON) / 삭제 (DELE_BUTTON)
- 화면 200 팝업에서 입력 후 SAVE_BUTTON 호출
- 급여 계산 여부 사전 체크 (CHECK_RGDIR → PA0003-ABRDT 조회)
- 이미 급여 계산된 월이면 경고 팝업 후 계속 진행 가능

#### 상환 구분별 처리

| PAYID | 구분 | 처리 로직 |
|---|---|---|
| `A` | 급여 | ZHRT8012 INSERT/MODIFY만 (BDC 없음) |
| `B` | 상여 | 등록/수정 불가 |
| `C` | 중도상환 | IT0078 BDC(PA30) + ZHRT8012 처리 |
| `D` | 퇴직금 | IT0267 BDC(PA30) + ZHRT8012 처리 |

#### 이자 계산 (CALC_ZSOLL)
```
이자 = 잔액 × (이자율/100) × (계산일수) / 365
10원 절사 (FIMA_NUMERICAL_VALUE_ROUND, RTYPE='-', RUNIT='0.1')
```

### 3.6 사용 테이블

| 테이블 | 용도 |
|---|---|
| `PA0045` | 대출 Infotype |
| `ZHRT8012` | 상환 내역 (커스텀) |
| `PA0078` | Infotype 0078 – 대출상환 |
| `PA0267` | Infotype 0267 – 추가비정기지급 |
| `PA0003` | 급여 계산일 |
| `T506D` | 이자율 |
| `T591S` | 하위유형 텍스트 |

### 3.7 사용 Function Module

| FM | 용도 |
|---|---|
| `ZHR_GET_ORGIN` | 권한 체크 |
| `RP_LAST_DAY_OF_MONTHS` | 월 말일 계산 |
| `FIMA_NUMERICAL_VALUE_ROUND` | 이자 절사 |
| `POPUP_TO_CONFIRM` | 확인 팝업 |
| `TB_DOMAINVALUE_GET_TEXT` | 도메인 텍스트 |

### 3.8 변경 이력

| 날짜 | 내용 |
|---|---|
| 2006.02.28 | 대출유형, 차수 추가 (BY KI) |
| 2006.11 | 첫 개발 |
| 2020.03.06 | 상여(B) 수정/삭제 불가 처리 추가 |
| 2020.03.09 | 상환금 없이 이자만 등록 가능하도록 수정 |
| W-IT 프로젝트 | 권한 체크 로직 추가 |

---

## 4. SAPMZHR0012 – 대출 집계 현황 조회

### 4.1 개요

| 항목 | 내용 |
|---|---|
| 프로그램 ID | `SAPMZHR0012` |
| T-CODE | 별도 T-CODE (복지기금 집계 조회) |
| 목적 | 기간별 대출 **집계 현황 조회** (대출 건수/금액 집계) |
| Message Class | `ZMHR` |

### 4.2 INCLUDE 구조

| Include | 역할 |
|---|---|
| `MZHR0012TOP` | 전역 데이터 |
| `MZHR0012O01` | PBO 모듈 |
| `MZHR0012I01` | PAI 모듈 |
| `MZHR0012F01` | FORM 서브루틴 |

### 4.3 주요 전역 데이터

| 변수/테이블 | 설명 |
|---|---|
| `GT_SUBTY` | 대출 유형 목록 (T591S) |
| `GT_ITAB` | 집계 결과 (PERNR, 대출유형, 년월, 금액, 건수) |
| `GT_0045` | PA0045 데이터 |
| `GT_8012` | ZHRT8012 데이터 |
| `GT_PERNR` | 대상 사번 목록 |
| `GS_SELECT` | 조회 조건 (FROM년월~TO년월, 라디오버튼: 대출/상환/이자) |

### 4.4 조회 조건

| 라디오 버튼 | 조회 대상 |
|---|---|
| RAD01 (대출) | PA0045에서 대출 지급 금액 집계 |
| RAD02 (상환) | ZHRT8012 PAYID='A','B','C'별 상환 합계 |
| RAD03 (이자) | ZHRT8012 이자(INTMT) 합계 |

### 4.5 주요 기능 상세

#### 동적 ALV 테이블 구성 (MAKE_TABLE_AND_ALV)
```
T591S에서 IT0045 대출 SUBTY 목록 조회
→ T582L에서 비활성 SUBTY 제외 (MOLGA='41', STATU='E')
→ SUBTY별 컬럼 동적 생성 (FILL_FIELD_CATEGORY)
→ CL_ALV_TABLE_CREATE=>CREATE_DYNAMIC_TABLE로 런타임 테이블 생성
→ FIELD-SYMBOLS <GT_TABLE>로 동적 바인딩
```

#### 조회 처리 (EXEC_BUTTON) 공통 패턴
```
1) 조회: 각 FORM에서 GT_ITAB에 SUBTY/PAYDT/BETRG 집계 (COLLECT)
2) FIELD-SYMBOLS로 <GT_TABLE> 순회:
   - PAYDT별 행 생성
   - SUBTY 컬럼에 금액 SET (ASSIGN COMPONENT … OF STRUCTURE)
   - TOTAL 컬럼에 누계
3) 인원체크(CHECK='X'): SUBTY_CNT, TOTAL_CNT 컬럼 추가
```

#### 대출 조회 (GET_PA0045_DARBT)
- PA0045 + PA0001 INNER JOIN, 권한 체크 적용
- 동일 대출 건의 최초 시작일 기준으로 중복 제거 (MIN BEGDA)
- 금액은 원화 환산 (×100)

#### 상환 조회 (GET_ZHRT8012_REPYMT)
- ZHRT8012 + PA0001 INNER JOIN
- REPYMT ≠ 0 조건

#### 이자 조회 (GET_ZHRT8012_INTMT)
- ZHRT8012 + PA0001 INNER JOIN
- INTMT ≠ 0 조건

#### 년월 F4 도움말 (OPUP_TO_SELECT_MONTH)
- `POPUP_TO_SELECT_MONTH` FM으로 달력 팝업 제공

### 4.6 사용 테이블

| 테이블 | 용도 |
|---|---|
| `PA0045` | 대출 Infotype |
| `ZHRT8012` | 상환 내역 |
| `PA0001` | 권한 체크용 조직 정보 |
| `T591S` | 대출유형 텍스트 |
| `T582L` | Infotype 필드 레이블 |

---

## 5. SAPMZHR0013 – 대출 전체 현황 조회 (보증보험 포함)

### 5.1 개요

| 항목 | 내용 |
|---|---|
| 프로그램 ID | `SAPMZHR0013` |
| T-CODE | `ZHRD0013`, `ZHRF0013` |
| 목적 | 사원별 대출 **전체 현황 조회** (보증보험, 잔액, 상환완료일 포함) + **SmartForm 출력** |
| Message Class | `ZMHR` |
| ALV 클래스 | `ZCL_GUI_ALV_GRID` (커스텀 ALV) |

### 5.2 INCLUDE 구조

| Include | 역할 |
|---|---|
| `MZHR0013TOP` | 전역 데이터 (SmartForm, HTML Viewer 포함) |
| `MZHR0013O01` | PBO 모듈 |
| `MZHR0013I01` | PAI 모듈 |
| `MZHR0013F01` | FORM 서브루틴 |

### 5.3 주요 전역 데이터

| 변수/테이블 | 설명 |
|---|---|
| `GT_ITAB` | 대출 현황 목록 (PA0045 기반 + 다수 추가 필드) |
| `GS_SELECT` | 조회 조건 (보증보험환급대상, 진행상태: 전체/진행중/완료) |
| `GS_PRINT` | SmartForm 출력용 데이터 구조체 |
| `G_HTML_CONTAINER`, `G_HTML_CONTROL` | HTML Viewer (PDF 미리보기) |

### 5.4 주요 기능 상세

#### 조회 (EXEC_BUTTON)
```
PA0045 전체 조회 (ENDDA='99991231')
→ 루프에서 PA0001 권한 체크 (BUKRS/WERKS/BTRTL/ORGEH)
→ ZHRT8012 SUM으로 잔액 계산
    - 잔액 = 0 → '완료', 잔액 > 0 → '진행중'
→ 완료건: PA0078에서 최종 상환일(FINAL) 조회
→ 진행중/완료 필터 (GS_SELECT-RAD02/RAD03)
→ 보증보험 환급대상 필터 (GS_SELECT-CHECK='X'):
    - ZZSEEND > SY-DATUM AND ZZHWG ≠ 'Y'인 건만 유지
→ PA0001/PA0002/HRP1000/T591S/T506D/PA0698/PA0000/PA0009/PA0105 순차 조회
```

#### 진행상태 판별 로직
| 조건 | GUBUN | 처리 |
|---|---|---|
| 대출금(DARBT) = 상환합계(REPYMT) | '완료' | 최종상환일 = PA0078 MAX(BEGDA) |
| 대출금 > 상환합계 | '진행중' | 잔액 = DARBT - REPYMT |

#### SmartForm 출력 (PRNT_BUTTON → CALL_FUNCTION_SMART_FORM)
```
조건 체크: FINAL 날짜 있고 잔액=0인 건만 출력 허용
→ SSF_FUNCTION_MODULE_NAME ('ZHRSF001')으로 FM명 조회
→ SmartForm 호출 (CONTROL_PARAMETERS-GETOTF='X')
→ OTF → PDF 변환 (CONVERT_OTF)
→ 화면 400에서 HTML Viewer로 PDF 미리보기
```

#### SmartForm 출력 데이터 (GS_PRINT)
| 필드 | 내용 |
|---|---|
| ENAME | 사원성명 + 연락처 |
| REGNO | 주민번호 (PA0539, CONVERSION_EXIT_REGNO_OUTPUT) |
| ZZSENUM | 보험가입번호 |
| ZZSEAMT / DARBT | 보험가입금액 / 대출금 (CURRENCY WRITE, '원' 접미) |
| PERIOD | 보험계약기간 (ZZSEBEG ~ ZZSEEND) |
| BANK | 은행명 + 계좌번호 (2016.02.05 이후 대출: ZHRT0009 코드에서 회사 수령) |
| FINAL | 상환완료일 |
| ADDR1/ADDR2 | T-CODE별 주소 분기 (ZHRD0013: 대상, ZHRF0013: 대상식품) |

#### 주소/기금명 분기 (2022.04.06)
- 대출유형 `9A50`, `9A51` (사원대여금): `대상(주)` 표기
- 그 외: `대상(주) 사내근로복지기금` 표기

### 5.5 주요 출력 컬럼

| 컬럼 | 설명 |
|---|---|
| 상태(GUBUN) | 진행중 / 완료 |
| 상환완료일(FINAL) | 완료건, 직접 입력 가능 |
| 사번/성명/부서/자격등급 | 사원 기본 정보 |
| 대출유형(SBTXT), 차수(OBJPS) | 대출 종류 |
| 대출신청금액(DARBT), 대출잔액(REMAIN) | 금액 정보 |
| 대출일자(DATBW), 이자율(ZSOLL) | 날짜/이자 정보 |
| 급여상환액(TILBT), 상여상환액(TIBBT) | 월별 상환 정보 |
| 보증보험사(ZZSECOM), 보험가입금액(ZZSEAMT), 보험료(ZZSEBET), 가입일(ZZSEBEG), 종료일(ZZSEEND), 보험번호(ZZSENUM), 환급여부(ZZHWG) | 보증보험 정보 |
| 퇴사일(RETDA) | 완료 정보 |
| 연락처(USRID), 메모(ZZMEMO) | 기타 |

### 5.6 사용 Function Module

| FM | 용도 |
|---|---|
| `ZHR_GET_ORGIN` | 권한 체크 |
| `SSF_FUNCTION_MODULE_NAME` | SmartForm FM명 조회 |
| `CONVERT_OTF` | OTF → PDF 변환 |
| `CONVERSION_EXIT_REGNO_OUTPUT` | 주민번호 포맷 변환 |
| `POPUP_TO_CONFIRM` | 확인 팝업 |

### 5.7 변경 이력

| 날짜 | 내용 |
|---|---|
| 2009.07.28 | ZHRF0013, ZHRD0013 통합 조회 (박성원 요청, BY LHS) |
| 2012.03.15 | 대출상환일 컬럼 추가 (정수정 요청, BY LEJ) |
| 2014.04.02 | 성명 옆 연락처 추가, 본사 주소 도로명 변경 (BY JHW) |
| 2016.02.05 | 2016.02.05 이후 대출: 보증보험료 회사 대납 → 계좌 ZHRT0009 코드 기준 변경 |
| 2019.02.08 | HTML Viewer PDF 미리보기 기능 추가 |
| 2020.05.06 | SmartForm 날짜 기준 시스템일→대출일자로 변경 (BY CSA) |
| 2022.04.06 | 사원대여금(9A50/9A51) T-CODE별 기금명 분기 처리 추가 |

---

## 6. SAPMZHR0014 – 월별 대출 상환 현황 조회

### 6.1 개요

| 항목 | 내용 |
|---|---|
| 프로그램 ID | `SAPMZHR0014` |
| T-CODE | 복지기금 월별 상환 현황 조회 |
| 목적 | 기준년월 기준 사원별 **대출 상환 현황** 조회 (RT 잔액 비교 포함) |
| Message Class | `ZMHR` |
| 특이사항 | 급여 RT(Retro-active) 데이터 연계, 연체이자 현황 |

### 6.2 INCLUDE 구조

| Include | 역할 |
|---|---|
| `mzhr0014top` | 전역 데이터 (급여 클러스터 포함) |
| `mzhr0014o01` | PBO 모듈 |
| `mzhr0014i01` | PAI 모듈 |
| `mzhr0014f01` | FORM 서브루틴 |
| `pctypkr0` | 급여 타입 정의 (KR) |
| `pcclskr1` | 클러스터 정의 (KR) |
| `rpcfvp09` | Retro-active 관련 |
| `pcfvpkr0` | Retro-active 관련 |

### 6.3 주요 전역 데이터

| 변수/테이블 | 설명 |
|---|---|
| `GT_ITAB` | 월별 상환 현황 목록 |
| `GS_SELECT` | 조회 조건 (기준년월, 라디오버튼: 실적/미공제자/전체/연체이자) |
| `RT_2` | RT 클러스터 데이터 (PC207 기반) |
| `GV_FIRST` | 최초 조회 여부 플래그 |

### 6.4 조회 조건 (라디오 버튼)

| 라디오 | 조회 대상 |
|---|---|
| RAD01 (실적) | 당월 실제 상환이 있는 건 (ZHRT8012 PAYDT=기준년월) |
| RAD02 (미공제자) | 잔액 있는 대출자 중 당월 상환이 없는 건 |
| RAD03 (전체) | 실적 + 미공제자 합집합 |
| RAD04 (연체이자) | 급여 RT 클러스터 ARRRS(연체) 데이터 (2019.04.29 추가) |

### 6.5 주요 기능 상세

#### 실적 조회 (GET_REPAYMENT)
```
ZHRT8012 + PA0001 INNER JOIN (권한 체크)
→ 기준년월(PAYDT) 상환 건 DISTINCT 조회
→ PA0045에서 대출 최신 BEGDA 재조회
→ CALC_THIS_REPAYMENT 호출
```

#### 당월 잔액 계산 로직 (CALC_THIS_REPAYMENT)
```
당월급여(PAY_KY)  = ZHRT8012 SUM(REPYMT) WHERE PAYID='A'
당월상여(PAY_SY)  = ZHRT8012 SUM(REPYMT) WHERE PAYID='B'
중도원금(PAY_CDE) = ZHRT8012 SUM(REPYMT) WHERE PAYID IN ('C','D','E')
당월이자(INT_AB)  = ZHRT8012 SUM(INTMT)  WHERE PAYID='A'
당월계   = PAY_KY + PAY_SY + INT_AB + PAY_CDE
전월잔액 = DARBT - ZHRT8012 SUM(REPYMT) WHERE PAYDT < 기준년월
당월잔액 = 전월잔액 - (PAY_KY + PAY_SY + PAY_CDE)  ← 이자는 잔액에서 제외
```

#### 미공제자 조회 (GET_NOT_REPAYMENT)
- PA0045 + PA0001 INNER JOIN (기준년월 말일 기준 유효 대출)
- 당월 ZHRT8012에 REPYMT≠0 또는 INTMT≠0 존재 시 제외
- 전월잔액 = 0이면 제외 (대출 완료 건)

#### 전체 조회 (GET_ALL)
- GET_REPAYMENT 결과를 GT_TEMP에 저장
- GET_NOT_REPAYMENT 실행 후 GT_TEMP 결과를 GT_ITAB에 APPEND

#### RT 잔액 비교 (GET_PAY) – CKBOX 체크 시 실행
```
1. CU_READ_RGDIR → 사원별 RGDIR 조회
2. 기준년월 PAYDT 범위에서 RGDIR 검색 (없으면 전월 재시도)
3. PCL2(kr) DATABASE에서 RT, V0 테이블 IMPORT
4. READ_V0_VOZNR: VINFO(대출유형4자+차수2자) 일치하는 V0ZNR 반환
5. READ_RT_BETRG: LGART='/LLB' + V0ZNR → 대출잔액(LLB) 반환
6. THIS ≠ LLB → COMPARE='X' (불일치 표시)
```

#### 연체이자 현황 (GET_ARRRS) – RAD04
```
PA0045 + PA0001 INNER JOIN → 권한 체크 후 대출자 사번 목록
→ PYXX_READ_PAYROLL_RESULT로 급여 결과 읽기
→ inter-arrrs (연체 테이블) 순회
→ inter-v0에서 vinfo 매핑 (대출유형 + 차수 확인)
→ GT_ITAB에 사번/대출유형/차수/연체금액 적재
```

#### 휴직 정보 조회 (2019.04.29 추가)
- PA2001에서 결근유형 조회: 0371, 0372, 0380, 0520, 0550, 0900, 0970, 0980
- 전월(ATEXT_1/PERIOD_1), 당월(ATEXT_2/PERIOD_2) 휴직 현황 표시
- T554T에서 MOABW='41' 기준 휴직유형 텍스트 조회 (RE_T554T)

#### 이자율 조회 (GET_T506D_ZSOLL) 특이사항
- T506D: DLART + DKOND + 기준년월 말일 조회
- **PA0045-INDIN(개인이자율) 설정 시 T506D보다 우선 적용**

#### 변동내역(MEMO) 자동 설정
| 조건 | MEMO |
|---|---|
| 당월잔액(THIS) = 0 | '당월완료' |
| 대출일자(DATBW) 년월 = 기준년월 | '당월대출' |

#### ALV 정렬 (BUILD_SORT)
- **RAD04**: PERNR → SUBTY → OBJPS 오름차순
- **RAD01~03**: SUBTY → SBTXT → GRAPR 오름차순, GRAPR에 소계(SUBTOT='X')

### 6.6 주요 출력 컬럼

| 컬럼 | 설명 |
|---|---|
| 대출유형(SBTXT/SUBTY), 거치기간(GRAPR), 건수(COUNT) | 대출 기본 정보 |
| 차수(OBJPS), 소속(OTEXT), 자격등급(TITL2), 사번/성명 | 사원 정보 |
| 대출금액(DARBT), 대출일자(DATBW), 이자율(ZSOLL) | 대출 조건 |
| 전월잔액(LAST) | 기준년월 이전 누적 잔액 |
| 당월급여(PAY_KY), 당월상여(PAY_SY) | PAYID 'A'/'B' 공제액 |
| 당월이자(INT_AB), 중도원금(PAY_CDE), 당월계(TOTAL) | 당월 납부 내역 |
| 당월잔액(THIS) | 기준년월 말 잔액 |
| 전월/당월 휴직(ATEXT_1/2, PERIOD_1/2) | 휴직 현황 (색상 강조) |
| RT잔액(LLB), 차이(COMPARE) | 급여 클러스터 잔액 비교 (선택적) |
| 퇴사일(RETDA), 변동내역(MEMO), 보험종료일(ZZSEEND) | 기타 |

### 6.7 사용 테이블

| 테이블 | 용도 |
|---|---|
| `PA0045` | 대출 Infotype |
| `ZHRT8012` | 상환 내역 (커스텀) |
| `ZHRT8011` | 대출 신청 / 거치기간 (커스텀) |
| `PA0001` | 조직배정 (권한 체크 포함) |
| `PA0002` | 자격등급 |
| `PA2001` | 결근/휴직 |
| `PCL2` | 급여 클러스터 (RT, V0, ARRRS) |
| `T554T` | 결근유형 텍스트 (MOABW='41') |
| `T506D` | 대출이자율 |
| `T591S` | 대출 하위유형 텍스트 |
| `T500L` | 국가 그룹핑 (RELID 조회) |

### 6.8 사용 Function Module

| FM | 용도 |
|---|---|
| `ZHR_GET_ORGIN` | 권한 체크 (커스텀) |
| `CU_READ_RGDIR` | 급여 디렉토리 조회 |
| `PYXX_READ_PAYROLL_RESULT` | 급여 결과 읽기 (연체이자 탭) |
| `RP_LAST_DAY_OF_MONTHS` | 월 말일 계산 |
| `POPUP_TO_CONFIRM` | 확인 팝업 |

### 6.9 변경 이력

| 날짜 | 내용 |
|---|---|
| 2009.01.09 | 대상/대상식품 통합 조회 (박성원 요청, BY KI) |
| 2009.09.04 | RT 대출잔액 비교 필드 추가 (박성원 요청, BY LHS) |
| 2009.10.09 | 대출유형코드 컬럼 출력 추가 (BY LHS) |
| 2009.10.12 | RT잔액비교 체크박스 추가 (BY LHS) |
| 2009.10.16 | 마지막일 FORM 분리, RT 해당월 조회 로직 추가 (BY LHS) |
| 2018.01.08 | 거치기간 조회 기준: 신청문서번호→대출순번(OBJPS)으로 변경 (BY JHW) |
| 2018.01.23 | 권한 체크 로직 추가 (W-IT 프로젝트) |
| 2019.04.29 | 연체이자 현황 탭(RAD04) 추가, GV_FIRST 플래그 추가 |
| 2020.02.20 | 산전무급 결근유형 0372 추가 |

---

## 7. 공통 사항 정리

### 7.1 공통 아키텍처

모든 6개 프로그램은 동일한 **Module Pool 4-레이어 구조**를 따릅니다:

```
SAPMZHR00XX (메인)
  ├── MZHR00XXTOP  : 전역 데이터, 테이블, 클래스 선언
  ├── MZHR00XXO01  : PBO – 화면 출력 모듈 (ALV 초기화)
  ├── MZHR00XXI01  : PAI – 사용자 입력 처리 (OK_CODE별 PERFORM)
  └── MZHR00XXF01  : FORM 서브루틴 (실제 비즈니스 로직)
```

### 7.2 공통 권한 체크 (W-IT 프로젝트)

모든 프로그램에 동일하게 적용. GV_FLAG로 최초 1회만 실행:

```abap
CALL FUNCTION 'ZHR_GET_ORGIN'
  EXPORTING
    PI_TCODE     = SY-TCODE
    PI_SAPID     = SY-UNAME
    PI_DATUM     = SY-DATUM
  IMPORTING
    PE_SIGN      = GV_SIGN
    PE_MSG       = GV_MSG
  TABLES
    PT_ZHRT99999 = GT_ZHRT99999
    PT_UST12     = GT_UST12
    PT_BUKRS     = GT_BUKRS    " 허용 회사코드 범위
    PT_WERKS     = GT_WERKS    " 허용 인사영역 범위
    PT_BTRTL     = GT_BTRTL    " 허용 인사하위영역 범위
    PT_ORGEH     = GT_ORGEH.   " 허용 조직단위 범위
```

- GT_BUKRS 또는 GT_WERKS가 비어있으면 `CONFIRM_AUTH_MESSAGE(SAPMZHR0073)` 호출
- 권한 범위는 EFG_RANGES 타입의 SAP Range 구조 (SIGN/OPTION/LOW/HIGH)

### 7.3 공통 사용 커스텀 테이블

| 테이블 | 설명 | 사용 프로그램 |
|---|---|---|
| `ZHRT8011` | 복지기금 대출 신청 | 0009, 0010, 0011, 0014 |
| `ZHRT8012` | 복지기금 대출 상환 내역 | 0010, 0011, 0012, 0013, 0014 |
| `ZHRT99999` | 사용자별 권한 관리 | 전체 |
| `ZHRT0009` | 코드성 마스터 (기금명 등) | 0013 |

### 7.4 프로그램 간 업무 흐름

```
[사원: 신규 대출 신청]
         │
         ▼
  SAPMZHR0009  ─── 신규대출 승인
  (신규대출)         ZHRT8011 STATUS 변경
                     PA30 BDC → PA0045 등록
         │
         ▼
  SAPMZHR0011  ─── 대출 상환 내역 관리
  (상환관리)         ZHRT8012 등록/수정/삭제
                     PA30 BDC → PA0078(중도상환) / PA0267(퇴직금)
         │
         ▼
  SAPMZHR0010  ─── 중도상환 승인
  (중도상환)         PA30 BDC → IT0078 등록
                     RFC ZHR_FI_CLEAN_LOAN → FI 전표 생성
                     ZHRT8012 midbnr 업데이트

  ────────────────── 조회 전용 ──────────────────
  SAPMZHR0012  : 기간별 대출/상환/이자 집계 (동적 피벗 ALV)
  SAPMZHR0013  : 대출 전체 현황 + 보증보험 + SmartForm 출력
  SAPMZHR0014  : 월별 상환 현황 + RT 잔액 비교 + 연체이자 현황
```

### 7.5 공통 ALV 패턴

모든 프로그램은 `CL_GUI_ALV_GRID`를 사용하며 공통 FORM 패턴을 따릅니다:

| FORM | 기능 |
|---|---|
| `EXCLUDE_TB_FUNCTIONS` | 불필요한 ALV 표준 툴바 버튼 제거 |
| `GRID_LAYOUT` | `FILL_FIELD_CATEGORY`로 컬럼 속성 동적 정의 |
| `BUILD_LAYOUT` | `GS_LAYOUT` 설정 (STYLEFNAME, BOX_FNAME) |
| `BUILD_VARIANT` | 레이아웃 Variant 저장 (REPORT + USERNAME) |
| `SET_CURRENT_CELL` | 새로고침 시 스크롤 위치 유지 |

#### FILL_FIELD_CATEGORY 동작 원리
```abap
" 'S': 새 컬럼 시작 (GS_FIELDCAT CLEAR)
" ' ': 속성 추가 (FIELD-SYMBOLS로 동적 필드 SET)
" 'E': 컬럼 완료 (GT_FIELDCAT에 APPEND)
CONCATENATE 'GS_FIELDCAT-' P_FNAME INTO L_COL.
ASSIGN (L_COL) TO <FS>.
MOVE P_CON TO <FS>.
```

#### IS_STABLE 패턴 (0011/0013/0014 적용)
```abap
LS_STABLE-ROW = 'X'.
LS_STABLE-COL = 'X'.
CALL METHOD G_GRID->REFRESH_TABLE_DISPLAY
  EXPORTING IS_STABLE = LS_STABLE.
```

### 7.6 BDC 사용 트랜잭션 정리

| Infotype | PA30 화면 시퀀스 | 사용 프로그램 | 처리 |
|---|---|---|---|
| 0045 (대출) | SAPMP50A(1000) → MP004500(2000) | SAPMZHR0009 | INS(등록), DEL+UPDL(삭제) |
| 0078 (대출상환) | SAPMP50A(1000) → MP007800(0100→2000) | SAPMZHR0010, 0011 | INS, MOD, DEL+UPDL |
| 0267 (추가비정기지급) | SAPMP50A(1000) → MP026700(2000) | SAPMZHR0011 | INS, MOD, DEL+UPDL |

#### 공통 BDC DYNPRO FORM 패턴
```abap
FORM DYNPRO USING DYNBEGIN FNAM FVAL.
  CLEAR G_BDCDATA_WA.
  IF DYNBEGIN = 'X'.          " 새 화면 전환
    G_BDCDATA_WA-PROGRAM  = FNAM.
    G_BDCDATA_WA-DYNPRO   = FVAL.
    G_BDCDATA_WA-DYNBEGIN = 'X'.
  ELSE.                       " 필드 입력
    G_BDCDATA_WA-FNAM = FNAM.
    G_BDCDATA_WA-FVAL = FVAL.
  ENDIF.
  APPEND G_BDCDATA_WA TO G_BDCDATA_TAB.
ENDFORM.
" CALL TRANSACTION 'PA30' ... MODE 'N' UPDATE 'L'
```

### 7.7 공통 Helper FORM 정리

다음 FORM들은 전 프로그램에서 동일한 로직으로 반복 사용됩니다:

| FORM | 기능 |
|---|---|
| `GET_PA0001` | PA0001에서 ORGEH, ENAME 조회 |
| `GET_HRP1000_STEXT` | HRP1000에서 조직단위 텍스트 조회 |
| `GET_PA0002` | PA0002에서 TITL2(자격등급) 조회 |
| `GET_T591S_STEXT` | T591S에서 대출 하위유형 텍스트 조회 |
| `DOMAINVALUE` | TB_DOMAINVALUE_GET_TEXT FM 래핑 |
| `POPUP_CONFIRM` | POPUP_TO_CONFIRM FM 래핑 |
| `DESCRIBE_TABLE_ITAB` | GT_ITAB 건수 0 시 메시지 + G_ERRIF 설정 |
| `GET_RETIRE_DATE` | PA0001 PERSG='5' 조회로 퇴사일 계산 |
| `GET_PA0105_USRID` | PA0105에서 CELL→HOME 순으로 연락처 조회 |
| `GET_BUKRS` | ZHR_GET_ORGIN 호출 (GV_FLAG로 1회만) |

### 7.8 데이터 무결성 및 보안 처리

| 항목 | 처리 방법 |
|---|---|
| 주민번호 표시 | PA0539에서 조회 후 생년월일 형식으로 마스킹 (앞 6자리만) |
| 개인정보 접근 LOG | Z_RECO_CBO_LOG FM 호출 (0009) |
| 급여 계산 선행 여부 | PA0003-ABRDT 조회 후 경고 팝업 (0010, 0011) |
| DB 업데이트 | COMMIT WORK 명시적 처리, 오류 시 ROLLBACK WORK |
| 권한 오류 | GT_BUKRS/WERKS 비어있으면 CONFIRM_AUTH_MESSAGE(SAPMZHR0073) |

---

*본 문서는 ABAP 소스코드 정적 분석을 기반으로 작성되었습니다.*