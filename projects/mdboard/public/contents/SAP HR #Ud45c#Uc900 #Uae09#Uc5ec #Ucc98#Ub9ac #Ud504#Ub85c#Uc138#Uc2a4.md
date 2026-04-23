# SAP HR 표준 급여 처리 프로세스 (Standard Payroll Process)

---

## 1. 개요 (Overview)

SAP HR 급여 처리(Payroll)는 **SAP HCM(Human Capital Management)** 모듈의 핵심 기능으로,
직원의 급여 계산, 공제, 세금 처리, 지급까지의 전체 사이클을 자동화합니다.

- **관련 모듈**: SAP HCM → Payroll (PY)
- **주요 트랜잭션**: PC00_M99_CALC, PC00_M99_CDTA, PC00_M99_CIPE
- **급여 기간**: 월별(Monthly), 격주(Bi-weekly), 주별(Weekly) 설정 가능

---

## 2. 급여 처리 사전 조건 (Prerequisites)

### 2.1 마스터 데이터 유지 (Master Data Maintenance)

| Infotype | 설명 | 트랜잭션 |
|----------|------|----------|
| IT0000 | 인사 활동 (Actions) | PA40 |
| IT0001 | 조직 배정 (Organizational Assignment) | PA30 |
| IT0002 | 개인 정보 (Personal Data) | PA30 |
| IT0006 | 주소 (Addresses) | PA30 |
| IT0007 | 근무 시간 스케줄 (Planned Working Time) | PA30 |
| IT0008 | 기본급 (Basic Pay) | PA30 |
| IT0009 | 은행 정보 (Bank Details) | PA30 |
| IT0014 | 반복 지급/공제 (Recurring Payments/Deductions) | PA30 |
| IT0015 | 추가 지급 (Additional Payments) | PA30 |
| IT0021 | 가족 관계 (Family/Related Persons) | PA30 |

### 2.2 급여 영역 설정 (Payroll Area Configuration)

- 급여 영역(Payroll Area) 정의
- 급여 기간(Period) 생성
- 급여 제어 레코드(Payroll Control Record) 상태 확인

---

## 3. 표준 급여 처리 흐름 (Standard Payroll Process Flow)

```
┌─────────────────────────────────────────────────────────────┐
│                   SAP 급여 처리 사이클                        │
│                                                             │
│  [1] 마스터 데이터 유지   →  [2] 근태 데이터 집계             │
│         ↓                                                   │
│  [3] 급여 제어 레코드 설정 →  [4] 급여 시뮬레이션 실행         │
│         ↓                                                   │
│  [5] 정식 급여 RUN 실행   →  [6] 급여 결과 검토               │
│         ↓                                                   │
│  [7] 사후 처리 (Post-Processing) → [8] 은행 이체 / 지급       │
│         ↓                                                   │
│  [9] 급여 확정 (Exit Payroll)   →  [10] 보고서 / 전기         │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 상세 단계별 프로세스

### Step 1. 마스터 데이터 유지 및 잠금

- HR 마스터 데이터 최종 업데이트 확인 (PA30, PA40)
- 급여 처리 시작 전 마스터 데이터 변경 사항 반영 완료
- **급여 제어 레코드** 상태를 `Payroll Past` → `Released for Payroll`로 변경

> **트랜잭션**: `PA03` (Payroll Control Record)

---

### Step 2. 근태 데이터 집계 (Time Evaluation)

- 초과 근무, 결근, 연차 등 근태 데이터 집계 처리
- Time Schema에 따라 근태 결과를 급여 입력값으로 변환

> **트랜잭션**: `PT60` (Time Evaluation)

---

### Step 3. 급여 시뮬레이션 (Payroll Simulation)

실제 급여 RUN 전에 테스트 목적으로 실행합니다.

- 계산 오류 사전 확인
- 특정 사원 또는 전체 대상 시뮬레이션 가능
- 실제 DB에 결과 저장 없음

> **트랜잭션**: `PC00_M99_CALC_SIMU` 또는 해당 국가별 트랜잭션

---

### Step 4. 정식 급여 RUN (Payroll Run)

급여 계산 엔진을 실행하여 실제 급여를 계산합니다.

**주요 처리 항목:**

| 항목 | 설명 |
|------|------|
| 기본급 계산 | IT0008 기준 기본급 |
| 수당 계산 | 각종 수당 (직책수당, 식대 등) |
| 공제 계산 | 국민연금, 건강보험, 고용보험, 소득세 |
| 초과근무 계산 | Time 데이터 기반 OT 계산 |
| 소급 계산 | 이전 기간 오류 수정 처리 (Retro Calculation) |

> **트랜잭션**: `PC00_M99_CALC` (국가별로 상이, 한국: `PC00_MKR_CALC`)

**급여 RUN 모드:**

| 모드 | 설명 |
|------|------|
| Production Run | 실제 결과를 DB에 저장 |
| Test Run | 저장 없이 계산만 수행 |
| Check Payroll Results | 기존 결과 재검토 |

---

### Step 5. 급여 결과 검토 (Payroll Results Review)

- 급여 계산 결과 상세 확인
- 오류 사원 목록 확인 및 원인 분석
- Payroll Log 검토

> **트랜잭션**: `PC_PAYRESULT` (급여 결과 조회)

**급여 결과 클러스터 테이블:**

| 테이블 | 내용 |
|--------|------|
| RT (Result Table) | 급여 최종 계산 결과 |
| CRT (Cumulative Result Table) | 누계 데이터 |
| BT (Bank Transfer) | 지급 이체 정보 |
| WPBP | 근무 기간 기본 데이터 |

---

### Step 6. 사후 처리 (Post-Processing)

#### 6.1 급여 명세서 생성 (Remuneration Statement)

> **트랜잭션**: `PC00_M99_CEDT`

- 직원별 급여 명세서 생성
- 출력 또는 ESS(Employee Self-Service)를 통한 온라인 제공

#### 6.2 은행 이체 파일 생성 (Bank Transfer / DME)

> **트랜잭션**: `PC00_M99_CDTA`

- 은행 이체용 DME(Data Medium Exchange) 파일 생성
- 각 은행 포맷에 맞는 파일 출력

#### 6.3 지급 문서 생성 (Payment Document)

- 급여 지급을 위한 FI 전기 문서 생성

---

### Step 7. 회계 전기 (Posting to Accounting)

급여 결과를 FI/CO 모듈로 전기합니다.

> **트랜잭션**: `PC00_M99_CIPE`

**전기 흐름:**

```
급여 결과 (Payroll Results)
       ↓
 심볼릭 계정 (Symbolic Account)
       ↓
 GL 계정 (General Ledger Account)
       ↓
 FI 전기 문서 생성 (FI Posting Document)
```

**전기 단계:**

1. `PC00_M99_CIPE` 실행 → Simulation 모드 우선 실행
2. 오류 확인 후 Production 모드로 실제 전기
3. FI 문서 번호 확인

---

### Step 8. 급여 확정 (Exit Payroll)

모든 처리 완료 후 급여 기간을 확정합니다.

> **트랜잭션**: `PA03` (Payroll Control Record)

- 제어 레코드 상태를 `Exit Payroll`로 변경
- 해당 급여 기간 종료 및 다음 기간으로 이동
- 확정 후 소급 계산 불가 (별도 수정 처리 필요)

---

## 5. 소급 계산 (Retroactive Calculation)

이전 급여 기간의 변경 사항이 발생한 경우 자동으로 소급 계산이 수행됩니다.

**소급 트리거:**

- 기본급 소급 변경 (IT0008)
- 과거 기간 마스터 데이터 수정
- 급여 오류 수동 수정

**소급 처리 흐름:**

```
과거 기간 데이터 변경
       ↓
 Earliest Retro Date 설정
       ↓
 차기 급여 RUN 시 자동 소급 계산
       ↓
 차액분 현재 기간 급여에 반영 (/552, /553 Wage Type)
```

---

## 6. 주요 Wage Type (임금 유형)

| Wage Type | 구분 | 설명 |
|-----------|------|------|
| /001 | 지급 합계 | Total Gross |
| /101 | 통화 지급액 | Cash Payment |
| /559 | 소급 차액 | Retro Difference |
| /700~799 | 세금 관련 | Tax Wage Types |
| /800~899 | 사회보험 | Social Insurance |
| /3xx | 사용자 정의 | Customer Wage Types |

---

## 7. 국가별 급여 (Country-Specific Payroll)

SAP은 국가별 법률 및 규정에 맞는 로컬라이제이션을 제공합니다.

| 국가 | Molga | 주요 트랜잭션 |
|------|-------|---------------|
| 한국 (Korea) | KR | PC00_MKR_CALC |
| 미국 (USA) | 10 | PC00_M10_CALC |
| 독일 (Germany) | 01 | PC00_M01_CALC |
| 일본 (Japan) | 25 | PC00_M25_CALC |

**한국 급여 특화 항목:**

- 4대 보험 (국민연금, 건강보험, 고용보험, 산재보험)
- 연말정산 (Year-end Tax Adjustment)
- 퇴직금 충당 (Severance Pay Provision)
- 근로소득 원천징수

---

## 8. 급여 처리 오류 유형 및 조치

| 오류 유형 | 원인 | 조치 방법 |
|-----------|------|-----------|
| No Payroll Schema | 급여 스키마 미설정 | 급여 영역 및 스키마 확인 |
| Master Data Error | 필수 IT 누락 | 해당 Infotype 데이터 입력 |
| Wage Type Error | 임금 유형 설정 오류 | 커스터마이징 확인 |
| Bank Data Missing | IT0009 미입력 | 은행 정보 등록 |
| Retro Error | 소급 처리 오류 | Retro Date 및 데이터 검토 |

---

## 9. 관련 주요 트랜잭션 요약

| 구분 | 트랜잭션 | 설명 |
|------|----------|------|
| 마스터 데이터 | PA30 / PA40 | 직원 데이터 유지/변경 |
| 급여 제어 | PA03 | Payroll Control Record |
| 근태 집계 | PT60 | Time Evaluation |
| 급여 RUN | PC00_M99_CALC | 급여 계산 실행 |
| 결과 조회 | PC_PAYRESULT | 급여 결과 확인 |
| 명세서 | PC00_M99_CEDT | 급여 명세서 출력 |
| 은행 이체 | PC00_M99_CDTA | DME 파일 생성 |
| FI 전기 | PC00_M99_CIPE | 회계 전기 |
| 보고서 | PC00_M99_CLGA | 급여 집계 보고서 |

---

## 10. SAP 급여 처리 체크리스트

### 급여 RUN 전
- [ ] 마스터 데이터 업데이트 완료 확인
- [ ] 근태 데이터 집계 완료 (PT60)
- [ ] 급여 제어 레코드 상태 확인 (PA03)
- [ ] 시뮬레이션 RUN 실행 및 오류 확인

### 급여 RUN 후
- [ ] 급여 결과 검토 (PC_PAYRESULT)
- [ ] 오류 사원 수정 및 재처리
- [ ] 급여 명세서 생성 확인
- [ ] 은행 이체 파일 생성 및 제출
- [ ] FI 전기 처리 완료
- [ ] 급여 확정 (Exit Payroll)

---

*※ 본 문서는 SAP HCM 기준 표준 급여 처리 프로세스를 기반으로 작성되었으며, 실제 구현 시 국가별 법규 및 고객사 요구사항에 따라 커스터마이징이 필요할 수 있습니다.*
