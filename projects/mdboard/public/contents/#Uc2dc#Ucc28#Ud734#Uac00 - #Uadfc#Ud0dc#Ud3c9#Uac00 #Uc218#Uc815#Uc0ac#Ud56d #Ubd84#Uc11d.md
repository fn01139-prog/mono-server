# ZHR_TIME_FUNCTION — 시차휴가(0117) 기본급 추가 수정 위치 분석

> 대상 Include: `ZHR_TIME_FUNCTION` (SAPFP51T include)  
> 분석일: 2026-04-16  
> 작성: YSG

---

## 개요

`P2001-SUBTY = '0117'` (시차휴가) 사용 시 급여시간으로 기본급(임금유형 `1020`)에 추가되도록 하는 로직 추가를 위한 수정 위치 분석.

---

## 수정 요약 (우선순위 순)

| 우선순위 | 위치 | 라인 | 내용 |
|---|---|---|---|
| 🔴 필수 | 기본급 ANZHL 설정 | **line 2166~2215** | `ELSEIF p_subty = '0117'` 분기 추가, 인정시간 설정 |
| 🔴 필수 | 4교대 2111→1020 전환 | **line 2129~2139** | ✅ 이미 처리됨 (확인 완료) |
| 🔴 필수 | SELECT 조건 | **line 2146** | ✅ 이미 처리됨 (확인 완료) |
| 🟡 권장 | TES 0901 누적 보정 | **line 2207~2214** | ①번 선행 시 자동 반영되나 검증 필요 |
| 🟡 권장 | 주초과 핵심로직1~2 반차 ±보정 | **line 2691, 2736, 2756 등** | ELSE 분기로 자동처리 중, 명시 여부 결정 |
| 🟢 확인 | 반차 후 DZL 삭제 | **line 2229~2273** | 0117은 skip됨, 의도대로인지 확인 |
| 🟢 확인 | 주초과 핵심로직3 반차 여부 | **line 4097~4300** | 0117을 반차로 볼지 결정 후 처리 |

---

## 상세 수정 위치

### ① [🔴 필수] line 2166~2215 — 기본급(1020) ANZHL 설정 블록

**가장 핵심 수정 위치.** 반차/반반차처럼 DZL의 `lgart = '1020'` 시간을 세팅하는 구간.

현재 반차별 설정:
- `0111` (오전반차) = 4시간
- `0112` (오후반차) = 4시간
- `0113` ~ `0116` (반반차) = 2시간
- `0117` → **ANZHL 설정 분기 없음** (ELSE로 빠지거나 누락)

```abap
* 현재 코드 (일부)
LOOP AT dzl WHERE beguz = '' AND enduz = '' AND lgart = '1020'.
  ...
  IF p_subty = '0113' OR p_subty = '0114' OR p_subty = '0115' OR p_subty = '0116'.
    dzl-anzhl = 2.
  ELSE.        " ← 0117도 여기로 빠짐
    dzl-anzhl = 4.
  ENDIF.
  MODIFY dzl.
ENDLOOP.
```

**수정 방향:** 시차휴가 사용 시 기본급으로 인정할 시간(정책 결정 필요)을 확정한 후 `ELSEIF p_subty = '0117'` 분기를 명시적으로 추가.

```abap
* 수정 예시 (인정시간이 N시간인 경우)
  IF p_subty = '0113' OR p_subty = '0114' OR p_subty = '0115' OR p_subty = '0116'.
    dzl-anzhl = 2.
  ELSEIF p_subty = '0117'.    " 시차휴가 추가 20260416 YSG
    dzl-anzhl = [N].           " 정책에 따른 인정시간 설정
  ELSE.
    dzl-anzhl = 4.
  ENDIF.
```

> ⚠️ DY_H(횡성) 근무자 분기(line 2172~2201)와 계획시간평가자(zterf='9') 분기에도 동일하게 0117 조건 추가 필요.

---

### ② [🔴 확인] line 2129~2139 — 4교대(4_3S) 2111→1020 전환

```abap
* line 2129~2139 (현재 코드 — 이미 처리됨)
IF dzl-datum >= '20210701' AND psp-zmodn = '4_3S'.
  LOOP AT p2001 WHERE begda = dzl-datum AND ( subty = '0111' OR subty = '0112' OR
                                               subty = '0113' OR subty = '0114' OR
                                               subty = '0115' OR subty = '0116' OR
                                               subty = '0117' ).  "시차휴가도 기본근무로 전환 적용 20260416 YSG
    LOOP AT dzl WHERE lgart = '2111' AND beguz IS NOT INITIAL AND enduz IS NOT INITIAL.
      dzl-lgart = '1020'.
      MODIFY dzl.
    ENDLOOP.
  ENDLOOP.
ENDIF.
```

✅ **이미 처리됨.** 4교대 근무자에 대해 연장근무(2111)를 기본시간(1020)으로 전환하는 로직에 0117 포함되어 있음.

---

### ③ [🔴 확인] line 2146 — PA2001 SELECT 조건

```abap
* line 2142~2150 (현재 코드 — 이미 처리됨)
SELECT SINGLE subty
  FROM pa2001
  INTO p_subty
WHERE pernr = pernr-pernr
  AND subty IN ('0111','0112','0113','0114','0115','0116','0117')   " 변경 후 20260416 YSG
  AND begda <= dzl-datum
  AND endda >= dzl-datum.
```

✅ **이미 처리됨.** `p_subty`에 `'0117'` 이 담길 수 있도록 SELECT 조건에 포함되어 있음.

---

### ④ [🟡 권장] line 2207~2214 — TES 0901 주간 누적 보정

주초과 계산에 사용되는 TES(시간 누적 결과) `0901` 항목에 기본급 시간을 가산하는 블록.

```abap
* line 2207~2214
LOOP AT tes WHERE ztart = '0901'.
  IF dzl-anzhl < 5.
    tes-anzhl = tes-anzhl + dzl-anzhl.
  ELSE.
    tes-anzhl = tes-anzhl + ( dzl-anzhl - 4 ).
  ENDIF.
  MODIFY tes.
ENDLOOP.
```

이 블록은 `IF p_subty IS NOT INITIAL ... ELSE ... ENDIF` 안에 위치하므로 SELECT(line 2146)에 0117이 포함된 시점부터 자동으로 실행됨. **단, ①번(ANZHL 설정)이 올바르게 되어야 이 블록도 정확히 동작함.** ①번 수정 후 반드시 검증 필요.

---

### ⑤ [🟡 권장] 주초과 핵심로직1~2 — 반차 ±보정 구간 (line 2691, 2736, 2756, 2859, 2951 등)

월경계/공휴일 포함 주초과 계산에서 D조 반차 시 타각 오차를 보정하는 패턴이 수십 곳에 반복됨.

```abap
* 반복 패턴 (여러 위치)
ELSEIF p_subty = '0112'.
  lv_anzhl = lv_anzhl + gt_payroll-anzhl + '0.5'.   "D조 오후반차 보정
ELSEIF p_subty = '0111'.
  lv_anzhl = lv_anzhl + gt_payroll-anzhl - '0.5'.   "D조 오전반차 보정
ELSE.
  lv_anzhl = lv_anzhl + gt_payroll-anzhl.            " ← 0117은 현재 여기로 처리
ENDIF.
```

시차휴가는 오전/오후 구분이 없으므로 **ELSE 분기(보정 없이 그대로)가 적절**. 현재 코드에서 자동으로 ELSE로 처리되고 있어 기능상 문제 없음. 다만 의도를 명확히 하려면 `ELSEIF p_subty = '0117'` 명시 권장.

---

### ⑥ [🟢 확인] line 2229~2273 — 반차 후 DZL 구간 삭제

오전반차 시 특정 시간 이전 DZL 삭제, 오후반차 시 특정 시간 이후 DZL 삭제하는 블록.

```abap
IF p_subty = '0111'.          " 오전반차 → 해당 시간 이전 구간 삭제
  DELETE dzl WHERE enduz = '120000'.
ELSEIF p_subty = '0112'.      " 오후반차 → 해당 시간 이후 구간 삭제
  DELETE dzl WHERE beguz => '130000'.
ENDIF.
```

`p_subty = '0117'`은 이 조건에 해당하지 않아 자동으로 **skip**됨. 시차휴가는 근무시간을 이동하는 개념이므로 DZL을 삭제하지 않는 것이 맞음. **의도대로 동작하는지 실데이터로 확인 필요.**

---

### ⑦ [🟢 확인] line 4097~4300 — 주초과 핵심로직3 (주중 반차 여부 체크)

주중에 반차 사용 이력이 있을 때 주초과(2115)를 발생시키는 로직. `lv_gbna2` 플래그로 반차 여부를 판단함.

**결정 필요사항:** 시차휴가(0117) 사용일을 "반차 사용일"로 간주하여 주초과 계산에 포함할 것인지 여부를 정책적으로 결정한 후 처리.

---

## 작업 순서 (권장)

```
1. 시차휴가 인정 기본급 시간 정책 확인 (N시간)
   ↓
2. line 2166~2215 블록에 ELSEIF p_subty = '0117' 분기 추가
   (DY_H 분기, zterf='9' 분기 내부에도 동일 추가)
   ↓
3. line 2207~2214 TES 0901 보정 — ②번 후 자동 반영 여부 검증
   ↓
4. line 2229~2273 DZL 삭제 — 0117 skip 되는지 실데이터 확인
   ↓
5. 주초과 핵심로직3 (line 4097~4300) — 0117 포함 여부 정책 결정 후 처리
   ↓
6. 급여 시뮬레이션으로 전체 검증
```

---

## 참고 — 임금유형 코드

| 코드 | 내용 |
|---|---|
| `1020` | 기본급 (기본시간) |
| `2111` | 연장근로 (150%) |
| `2115` | 주초과 |
| `2117` | 토요유급 |
| `2121` | 야간근로 |
| `2131` | 휴일근로 |

---

*분석 대상: `ZHR_TIME_FUNCTION` Include (SAPFP51T) — FORM fuz_rnd (line 1608~6502)*