# MongoDB 설치 가이드 및 Oracle DBMS 대비 장/단점

> 기준 버전: **MongoDB 8.x** (2026년 5월 기준 최신 안정 버전)  
> MongoDB 6.0은 2025년 7월 지원 종료 예정 — 신규 설치는 8.x 권장

---

## 목차

1. [MongoDB 개요](#1-mongodb-개요)
2. [설치 방법 — Windows](#2-설치-방법--windows)
3. [설치 방법 — Linux (Ubuntu / RHEL 계열)](#3-설치-방법--linux)
4. [설치 후 기본 설정](#4-설치-후-기본-설정)
5. [Oracle DBMS 대비 장/단점](#5-oracle-dbms-대비-장단점)
6. [선택 기준 요약](#6-선택-기준-요약)

---

## 1. MongoDB 개요

| 항목 | 내용 |
|---|---|
| 최신 버전 | MongoDB 8.2.x (2026.02 기준) |
| DB 분류 | NoSQL — Document DB (BSON/JSON 기반) |
| 라이선스 | SSPL (Server Side Public License) — Community Edition 무료 |
| 기본 포트 | 27017 |
| 주요 관리 도구 | MongoDB Compass (GUI), mongosh (CLI) |
| 지원 OS | Linux, Windows, macOS |
| 공식 다운로드 | https://www.mongodb.com/try/download/community |

### 핵심 개념 비교 (RDB vs MongoDB)

| RDB (Oracle/PostgreSQL) | MongoDB |
|---|---|
| Database | Database |
| Table | Collection |
| Row | Document |
| Column | Field |
| JOIN | Embedded Document / $lookup |
| Schema 고정 | Schema-less (유연한 구조) |

---

## 2. 설치 방법 — Windows

### 2.1 설치 파일 다운로드

1. https://www.mongodb.com/try/download/community 접속
2. Version: **8.x**, Platform: **Windows**, Package: **msi** 선택
3. `.msi` 파일 다운로드

### 2.2 설치 진행

| 단계 | 내용 |
|---|---|
| 1. 라이선스 동의 | Accept 후 Next |
| 2. 설치 타입 | **Complete** 선택 (권장) |
| 3. 서비스 설정 | **Install MongoD as a Service** 체크 유지 |
| 4. 서비스 계정 | **Run service as Network Service user** 기본값 유지 |
| 5. MongoDB Compass | GUI 도구 — 필요 시 함께 설치 체크 |
| 6. 설치 완료 | Finish 클릭 |

> ⚠️ **주의**: MongoDB Shell(`mongosh`)은 별도 설치 필요  
> https://www.mongodb.com/try/download/shell 에서 다운로드

### 2.3 환경변수 PATH 등록

```powershell
# 시스템 PATH에 추가
C:\Program Files\MongoDB\Server\8.0\bin
```

### 2.4 설치 확인

```powershell
# 버전 확인
mongod --version
mongosh --version

# mongosh로 접속
mongosh
```

---

## 3. 설치 방법 — Linux

### 3.1 Ubuntu 22.04 / 24.04 (apt)

```bash
# 1. 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 2. 필수 패키지 설치
sudo apt install -y gnupg curl

# 3. MongoDB 공식 GPG 키 등록
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor

# 4. apt 저장소 추가 (Ubuntu 24.04 기준)
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list

# Ubuntu 22.04 (Jammy)의 경우 noble 대신 jammy 사용
# echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] \
#   https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/8.0 multiverse" | \
#   sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list

# 5. 설치
sudo apt update
sudo apt install -y mongodb-org

# 6. 서비스 시작 및 자동 시작 등록
sudo systemctl daemon-reload
sudo systemctl enable --now mongod

# 7. 설치 확인
mongod --version
sudo systemctl status mongod
```

### 3.2 RHEL / Rocky Linux / AlmaLinux 계열 (dnf)

```bash
# 1. yum 저장소 파일 생성
sudo tee /etc/yum.repos.d/mongodb-org-8.0.repo << 'EOF'
[mongodb-org-8.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/8.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-8.0.asc
EOF

# 2. 설치
sudo dnf install -y mongodb-org

# 3. 서비스 시작 및 자동 시작 등록
sudo systemctl start mongod
sudo systemctl enable mongod

# 4. 설치 확인
mongod --version
sudo systemctl status mongod
```

---

## 4. 설치 후 기본 설정

### 4.1 mongosh 접속 및 관리자 계정 생성

```javascript
// mongosh 접속
mongosh

// admin DB 선택
use admin

// 관리자 계정 생성
db.createUser({
  user: "admin",
  pwd: "your_password",
  roles: [ { role: "userAdminAnyDatabase", db: "admin" }, "readWriteAnyDatabase" ]
})
```

### 4.2 인증 활성화 (mongod.conf)

```bash
# Linux 설정 파일 경로
sudo vi /etc/mongod.conf

# 아래 항목 수정
security:
  authorization: enabled
```

### 4.3 외부 접속 허용

```bash
# /etc/mongod.conf 수정
net:
  port: 27017
  bindIp: 0.0.0.0   # 기본값은 127.0.0.1 (localhost 전용)

# 서비스 재시작
sudo systemctl restart mongod

# 방화벽 허용 (필요 시)
sudo ufw allow 27017
```

### 4.4 기본 운영 명령어 (mongosh)

```javascript
// DB 목록 조회
show dbs

// DB 생성 / 전환
use mydb

// Collection 생성 및 Document 삽입
db.users.insertOne({ name: "홍길동", age: 30, dept: "개발팀" })

// 조회
db.users.find()
db.users.find({ dept: "개발팀" })

// 수정
db.users.updateOne({ name: "홍길동" }, { $set: { age: 31 } })

// 삭제
db.users.deleteOne({ name: "홍길동" })

// Collection 목록
show collections
```

---

## 5. Oracle DBMS 대비 장/단점

### 5.1 장점 (MongoDB ✅)

| 항목 | MongoDB | Oracle |
|---|---|---|
| **라이선스 비용** | Community Edition 무료 | 유료 (높은 엔터프라이즈 라이선스 비용) |
| **스키마 유연성** | Schema-less: 구조 변경 시 ALTER TABLE 불필요 | 스키마 고정: 컬럼 변경 시 DDL 필요 |
| **비정형 데이터 처리** | JSON/BSON 네이티브 저장, 중첩 구조 자유롭게 표현 | JSON 지원하나 Document 모델에 비해 제약 있음 |
| **수평 확장 (Scale-out)** | Sharding 내장 — 데이터 분산 처리 기본 지원 | RAC 기반 Scale-up 중심, Sharding은 복잡 |
| **개발 생산성** | JSON 형태로 App 코드와 자연스럽게 연동 | ORM/매핑 레이어 필요, 임피던스 불일치 발생 |
| **설치 용이성** | 간단 (패키지 관리자 수 줄) | 복잡 (설치 절차 다단계, OS 사전 설정 필요) |
| **클라우드 네이티브** | MongoDB Atlas (완전관리형) AWS/GCP/Azure 지원 | Oracle Cloud 외 타사 클라우드에서 제약 |
| **빠른 프로토타이핑** | 스키마 설계 없이 즉시 데이터 저장 가능 | 테이블 설계 선행 필요 |
| **벤더 종속성** | 없음 (오픈소스) | 높음 (Oracle 종속 PL/SQL, 도구) |

### 5.2 단점 (MongoDB ⚠️)

| 항목 | MongoDB 단점 | Oracle 강점 |
|---|---|---|
| **ACID 트랜잭션** | 4.0부터 Multi-document 트랜잭션 지원하나 성능 비용 발생 | 엔터프라이즈급 완전한 ACID 트랜잭션 |
| **복잡한 JOIN** | `$lookup`으로 지원하나 RDB JOIN 대비 성능/표현 제한 | 강력한 다중 테이블 JOIN, 옵티마이저 |
| **데이터 일관성** | 기본적으로 Eventually Consistent 지향 | 강한 일관성(Strong Consistency) 기본 |
| **집계/분석 쿼리** | Aggregation Pipeline이 있으나 SQL 대비 복잡 | SQL 기반 강력한 분석 쿼리, OLAP 지원 |
| **스토리지 효율** | BSON 포맷으로 필드명 반복 저장 → 용량 낭비 가능 | 정규화 구조로 스토리지 효율 높음 |
| **공식 엔터프라이즈 지원** | 유료 Enterprise 플랜 별도 필요 | 24/7 Oracle 공식 기술 지원 |
| **레거시 호환성** | SQL 기반 시스템 마이그레이션 비용 발생 | 기존 Oracle 자산과 완벽 호환 |
| **DBA 인력** | MongoDB 전문 DBA 인력 Pool이 상대적으로 적음 | Oracle DBA 시장 성숙, 인력 풍부 |
| **정형 데이터 처리** | 관계형 데이터에는 RDB보다 비효율적 | 정형 데이터 처리에 최적화 |

---

## 6. 선택 기준 요약

| 상황 | 권장 DBMS |
|---|---|
| 비정형·반정형 데이터 (로그, IoT, 소셜) | ✅ **MongoDB** |
| 빠른 개발/프로토타이핑, 스타트업 | ✅ **MongoDB** |
| JSON API 기반 서비스 (Node.js, Python 등) | ✅ **MongoDB** |
| 수평 확장이 필요한 대용량 분산 시스템 | ✅ **MongoDB** |
| 실시간 데이터 처리 (이벤트, 스트림) | ✅ **MongoDB** |
| 복잡한 트랜잭션, 금융/회계 시스템 | ⭐ **Oracle** |
| 복잡한 다중 테이블 JOIN이 핵심인 시스템 | ⭐ **Oracle** |
| Oracle 기반 레거시 시스템 유지 | ⭐ **Oracle** |
| 24/7 벤더 공식 지원이 필수인 대기업 | ⭐ **Oracle** |
| 엄격한 데이터 정합성이 요구되는 공공/금융 | ⭐ **Oracle** |

> 💡 MongoDB는 **완전히 다른 패러다임의 DB**입니다.  
> Oracle/PostgreSQL을 대체한다기보다 **용도가 다른 상호보완 관계**로 이해하는 것이 적합합니다.  
> 실무에서는 MongoDB(비정형) + PostgreSQL(정형)을 함께 운영하는 폴리글랏(Polyglot) 구성도 일반적입니다.

---

*작성 기준: 2026년 5월 | MongoDB 8.x, Oracle 21c/23ai 비교 기준*