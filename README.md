# Yu's Mono-Server

> mdBoard, 포트폴리오 등 여러 프로젝트를 하나의 Node.js 서버로 운영하는 모노서버

---

## 📁 폴더 구조

```
mono-server/
├── app.js                    # 메인 진입점
├── ecosystem.config.js       # PM2 설정
├── core/
│   └── loader.js             # 프로젝트 자동 로딩 엔진
├── shared/
│   └── utils.js              # 공통 유틸 (asyncHandler, ok, fail)
└── projects/
    ├── _template/            # 새 프로젝트 템플릿 (enabled: false)
    │   ├── config.js
    │   ├── index.js
    │   └── public/           # 정적 파일 (선택)
    ├── mdboard/
    │   ├── config.js
    │   ├── index.js
    │   └── public/
    └── portfolio/
        ├── config.js
        ├── index.js
        └── public/
```

---

## 🚀 실행

```bash
npm install
cp .env.example .env

# 개발
npm run dev

# 운영 (PM2)
npm run pm2
```

---

## ➕ 새 프로젝트 추가하는 법

```bash
# 1. 폴더 복사
cp -r projects/_template projects/my-new-app

# 2. config.js 수정
#    - name, prefix, description, icon 수정
#    - enabled: true 로 변경

# 3. index.js 에 API 라우터 작성

# 4. public/ 에 프론트엔드 파일 넣기 (선택)

# 5. 서버 재시작
pm2 restart mono-server
```

그게 전부입니다. loader.js가 자동으로 감지해서 등록합니다.

---

## 🌐 URL 구조

| 경로 | 설명 |
|------|------|
| `/` | 앱 허브 (등록된 프로젝트 목록) |
| `/<prefix>` | 프로젝트 정적 파일 (public/) |
| `/<prefix>/api/*` | 프로젝트 API 라우터 |
| `/<prefix>/api/health` | 프로젝트 헬스체크 |

---

## 🚂 Railway 배포

1. GitHub에 push
2. Railway에서 `New Project → GitHub Repo` 선택
3. 환경변수 설정 (`PORT`는 Railway가 자동 주입)
4. 배포 완료

GitHub Pages에서 API 호출 시:
```js
const API = 'https://your-app.up.railway.app';
fetch(`${API}/mdboard/api/docs`)
```
