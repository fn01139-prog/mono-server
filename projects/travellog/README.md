# TravelLog 설치 & 배포 가이드

## 1. mono-server에 프로젝트 추가

```bash
# mono-server 루트에서
cp -r travellog projects/travellog

# 또는 직접 이동
mv travellog projects/
```

---

## 2. npm 패키지 추가 (mono-server 루트)

```bash
npm install uuid
# googleapis는 이미 있을 수 있음. 없으면:
npm install googleapis
```

---

## 3. Google Cloud Console 설정

### 3-1. 서비스 계정 생성
1. https://console.cloud.google.com → IAM → 서비스 계정
2. 서비스 계정 생성 (이름: `travellog-drive`)
3. 역할: 없음 (Drive 공유로 처리)
4. 키 → JSON 다운로드

### 3-2. API 활성화
- Google Drive API
- Google Maps JavaScript API
- Google Maps Places API
- Google Maps Geocoding API

### 3-3. Drive 폴더 공유
- `monoserver` 폴더를 서비스 계정 이메일에 **편집자**로 공유
- 사진 업로드용 폴더도 동일하게 공유 (없으면 자동 생성됨)

### 3-4. 서비스 계정 키 인코딩
```bash
# 다운로드한 JSON 파일을 base64로 인코딩
cat service-account.json | base64 -w 0
# 출력 값을 GOOGLE_SERVICE_ACCOUNT 환경변수에 설정
```

---

## 4. 환경변수 설정 (Railway)

| 변수명 | 값 | 비고 |
|--------|-----|------|
| `GOOGLE_SERVICE_ACCOUNT` | base64(서비스계정JSON) | 필수 |
| `DRIVE_FOLDER_ID` | `1j_7SsCgqfwA6WQZBpw-LzExXWDoJwRpb` | monoserver 폴더 ID |
| `GOOGLE_MAPS_KEY` | Maps API 키 | 필수 |
| `ANTHROPIC_API_KEY` | Anthropic API 키 | 이미 설정되어 있음 |

### Google Maps API 키 제한 (권장)
- HTTP referrer: `https://fn0113.up.railway.app/*`
- 활성화된 API: Maps JS, Places, Geocoding

---

## 5. 배포

```bash
cd ~/mono-server
git add projects/travellog
git commit -m "feat: travellog 프로젝트 추가"
git push origin main
# → Railway 자동 재배포 (1~2분)
```

---

## 6. 접속 URL

| 페이지 | URL |
|--------|-----|
| 메인 | `https://fn0113.up.railway.app/travellog/` |
| 사진 업로더 | `https://fn0113.up.railway.app/travellog/upload.html` |
| API 동기화 | `https://fn0113.up.railway.app/travellog/api/sync` |

---

## 7. 사진 업로드 흐름

1. `/travellog/upload.html` 접속
2. 여행 선택
3. 사진 드래그 or 파일 선택 (최대 30장)
4. EXIF 자동 추출 확인 (시간, GPS)
5. 필요시 메타데이터 직접 수정
6. 업로드할 사진만 체크 → `선택 사진 업로드` 클릭
7. Drive에 업로드 + `travellog-photos.json` 자동 갱신

---

## 8. 데이터 파일 구조 (Drive monoserver 폴더)

```
monoserver/
├── trips.json               ← campchecklist (기존)
├── travellog-trips.json     ← 여행 목록
├── travellog-schedules.json ← 일정 계획
├── travellog-records.json   ← 여행 기록
├── travellog-photos.json    ← 사진 메타데이터 인덱스
│
└── travel-{tripId-8자}/     ← 여행별 사진 폴더 (자동 생성)
    ├── IMG_001.jpg
    └── ...
```

---

## 9. 주요 기능 요약

### 일정 계획 탭
- 여행 기간별 Day 탭 분류
- 장소 검색 (Google Places Autocomplete)
- 지도에 순번 마커 + 경로선
- 주변 추천 (Claude AI + Google Places)
  - 맛집 / 카페 / 볼거리 / 레크리에이션 / 숙박
  - 추천 코멘트 AI 생성

### 여행 기록 탭
- 기록 카드 (사진 썸네일 3개 그리드, 별점, 메모)
- 지도에 사진 썸네일 클러스터 표시
- 100m 반경 자동 그루핑

### 사진 업로더
- 브라우저에서 EXIF 자동 추출 (exifr.js)
- 선택적 업로드 (개별 체크)
- 메타데이터 직접 수정 가능
- 5장씩 배치 업로드
- 진행 상태 실시간 표시
