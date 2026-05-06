# PostgreSQL 설치 가이드 및 Oracle DBMS 대비 장/단점

> 기준 버전: **PostgreSQL 17.x** (2026년 5월 기준 최신 안정 버전)

---

## 목차

1. [PostgreSQL 개요](#1-postgresql-개요)
2. [설치 방법 — Windows](#2-설치-방법--windows)
3. [설치 방법 — Linux (Ubuntu / RHEL 계열)](#3-설치-방법--linux)
4. [설치 후 기본 설정](#4-설치-후-기본-설정)
5. [Oracle DBMS 대비 장/단점](#5-oracle-dbms-대비-장단점)
6. [선택 기준 요약](#6-선택-기준-요약)

---

## 1. PostgreSQL 개요

| 항목 | 내용 |
|---|---|
| 최신 버전 | PostgreSQL 17.x (2026.02 기준) |
| 라이선스 | PostgreSQL License (BSD 계열, 완전 무료) |
| 기본 포트 | 5432 |
| 주요 관리 도구 | pgAdmin 4, psql (CLI) |
| 지원 OS | Linux, Windows, macOS, BSD, Solaris |
| 공식 다운로드 | https://www.postgresql.org/download |

---

## 2. 설치 방법 — Windows

### 2.1 설치 파일 다운로드

1. https://www.postgresql.org/download/windows/ 접속
2. **EDB(EnterpriseDB) 인증 설치 프로그램** 선택 (권장)
3. 원하는 버전의 `.exe` 다운로드

### 2.2 설치 진행

```
설치 마법사 단계별 안내
```

| 단계 | 내용 |
|---|---|
| 1. 설치 경로 | 기본값 유지 권장 (`C:\Program Files\PostgreSQL\17`) |
| 2. 구성 요소 선택 | PostgreSQL Server, pgAdmin 4, Command Line Tools 선택 (Stack Builder는 선택사항) |
| 3. 데이터 디렉토리 | 기본값 유지 (`C:\Program Files\PostgreSQL\17\data`) |
| 4. 슈퍼유저 비밀번호 | `postgres` 계정 비밀번호 설정 (반드시 메모 보관) |
| 5. 포트 설정 | 기본값 `5432` 유지 권장 |
| 6. Locale | 기본값 유지 |
| 7. 설치 완료 | Finish 클릭 (Stack Builder 실행 체크 해제 가능) |

### 2.3 설치 확인

```powershell
# CMD 또는 PowerShell에서 버전 확인
psql -V

# psql 접속
psql -U postgres -h localhost
```

---

## 3. 설치 방법 — Linux

### 3.1 Ubuntu / Debian 계열 (apt)

```bash
# 1. 시스템 패키지 업데이트
sudo apt update && sudo apt upgrade -y

# 2. PostgreSQL 공식 apt 저장소 추가
sudo apt install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc

sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'

# 3. 설치
sudo apt update
sudo apt install -y postgresql-17

# 4. 서비스 시작 및 자동 시작 등록
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 5. 설치 확인
psql --version
```

### 3.2 RHEL / Rocky Linux / AlmaLinux 계열 (dnf/yum)

```bash
# 1. PostgreSQL yum 저장소 추가
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm

# 2. 기본 내장 PostgreSQL 모듈 비활성화
sudo dnf -qy module disable postgresql

# 3. 설치
sudo dnf install -y postgresql17-server postgresql17

# 4. DB 초기화
sudo /usr/pgsql-17/bin/postgresql-17-setup initdb

# 5. 서비스 시작 및 자동 시작 등록
sudo systemctl start postgresql-17
sudo systemctl enable postgresql-17

# 6. 설치 확인
psql --version
```

---

## 4. 설치 후 기본 설정

### 4.1 postgres 계정 접속 및 비밀번호 설정

```bash
# postgres 운영체제 계정으로 전환 (Linux)
sudo -i -u postgres
psql

# psql 내에서 비밀번호 변경
ALTER USER postgres WITH PASSWORD 'your_password';
\q
```

### 4.2 외부 접속 허용 설정

```bash
# postgresql.conf — listen_addresses 수정
sudo vi /etc/postgresql/17/main/postgresql.conf
# listen_addresses = '*'   ← 변경

# pg_hba.conf — 외부 IP 접근 허용 추가
sudo vi /etc/postgresql/17/main/pg_hba.conf
# 아래 행 추가 (예: 모든 IP 허용)
# host  all  all  0.0.0.0/0  scram-sha-256

# 서비스 재시작
sudo systemctl restart postgresql
```

### 4.3 기본 운영 명령어

```sql
-- DB 목록 조회
\l

-- 사용자 목록 조회
\du

-- DB 생성
CREATE DATABASE mydb;

-- 사용자 생성
CREATE USER myuser WITH PASSWORD 'mypassword';

-- 권한 부여
GRANT ALL PRIVILEGES ON DATABASE mydb TO myuser;

-- DB 접속
\c mydb
```

---

## 5. Oracle DBMS 대비 장/단점

### 5.1 장점 (PostgreSQL ✅)

| 항목 | PostgreSQL | Oracle |
|---|---|---|
| **라이선스 비용** | 완전 무료 (오픈소스) | 유료 (엔터프라이즈 수준의 높은 라이선스 비용) |
| **운영 비용** | 낮음 | 높음 (지원 계약, DBA 비용 포함) |
| **설치 용이성** | 간단 (패키지 관리자 1~2줄) | 복잡 (설치 과정 다단계, OS 사전 설정 필요) |
| **확장성** | Extension 생태계 풍부 (PostGIS, TimescaleDB 등) | 내장 기능 중심, 확장은 비용 발생 |
| **JSON/NoSQL 지원** | JSONB 타입 네이티브 지원, 강력한 인덱싱 | JSON 지원하나 JSONB 수준에 미치지 못함 |
| **표준 SQL 준수** | SQL 표준 준수율 높음 | 독자적인 PL/SQL 문법 비중 높음 |
| **커뮤니티** | 활발한 글로벌 오픈소스 커뮤니티 | Oracle 벤더 중심 |
| **클라우드 호환성** | AWS RDS, GCP, Azure 모두 네이티브 지원 | Oracle Cloud 외 타사 클라우드에서 제약 있음 |
| **벤더 종속성** | 없음 | 높음 (Oracle 종속 SQL, 도구) |
| **소스 코드 공개** | 완전 공개 | 비공개 |

### 5.2 단점 (PostgreSQL ⚠️)

| 항목 | PostgreSQL 단점 | Oracle 강점 |
|---|---|---|
| **엔터프라이즈 지원** | 공식 벤더 지원 없음 (서드파티 유료 지원 필요) | 24/7 공식 기술 지원 |
| **RAC (Real Application Clusters)** | 기본 제공 없음 (Patroni, Citus 등 별도 구성) | Oracle RAC로 고가용성 클러스터 내장 |
| **병렬 처리 성능** | 개선 중이나 Oracle 대비 일부 미흡 | 고도화된 병렬 쿼리 처리 |
| **Partitioning 성능** | 17버전에서 개선됐으나 Oracle보다 기능 제한 있음 | 강력한 파티셔닝 기능 |
| **인메모리 DB 기능** | 별도 Extension 필요 | Oracle In-Memory 옵션 내장 |
| **레거시 호환성** | Oracle 전용 문법 마이그레이션 필요 (PL/SQL → PL/pgSQL) | 기존 Oracle 자산과 완벽 호환 |
| **모니터링 도구** | 오픈소스 도구 조합 필요 (pgBadger, Prometheus 등) | Oracle Enterprise Manager(OEM) 통합 제공 |
| **대규모 상용 레퍼런스** | 금융/공공 레거시에서 Oracle 선호도 높음 | 검증된 대규모 엔터프라이즈 레퍼런스 다수 |

---

## 6. 선택 기준 요약

| 상황 | 권장 DBMS |
|---|---|
| 비용 절감이 최우선 | ✅ **PostgreSQL** |
| 스타트업 / 클라우드 네이티브 환경 | ✅ **PostgreSQL** |
| JSON, 지리정보(GIS), 시계열 데이터 처리 | ✅ **PostgreSQL** |
| 24/7 벤더 공식 지원이 필수인 대기업 | ⭐ **Oracle** |
| 기존 Oracle PL/SQL 기반 레거시 시스템 유지 | ⭐ **Oracle** |
| Oracle RAC 수준의 HA 클러스터 (단기 구축) | ⭐ **Oracle** |
| 금융/공공 규제 환경 (검증된 레퍼런스 필요) | ⭐ **Oracle** (단, PostgreSQL 전환 사례 증가 중) |

> 💡 최근 국내외 금융권 및 공공기관에서도 비용 절감 및 클라우드 전환을 이유로
> Oracle → PostgreSQL 마이그레이션 사례가 빠르게 증가하고 있습니다.

---

*작성 기준: 2026년 5월 | PostgreSQL 17.x, Oracle 21c/23ai 비교 기준*