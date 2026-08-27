/**
 * core/loader.js
 * projects/ 폴더를 스캔해서 config.js가 있는 폴더를 자동으로 Express에 마운트
 *
 * 새 프로젝트 추가 방법:
 *   1. projects/<name>/ 폴더 생성
 *   2. config.js 작성 (enabled: true 확인)
 *   3. index.js 에서 express.Router() export
 *   → 서버 재시작만 하면 자동 등록
 */

const fs   = require('fs');
const path = require('path');
const { requireLogin, requireApp, matchesPublicPath } = require('./auth');

const PROJECTS_DIR = path.join(__dirname, '../projects');
const registeredProjects = [];

/**
 * 앱별 접근 가드 생성.
 * - config.public === true 이면 가드 없이 전면 공개
 * - publicPaths 에 매칭되는 "GET 요청"만 로그인 없이 통과 (앱 라우트에서 2차 검사 필요).
 *   쓰기 메서드(POST/PUT/DELETE 등)는 경로가 같아도 항상 로그인이 필요하다.
 * - 그 외에는 requireLogin → requireApp(prefix) 순서로 검사
 *
 * API 마운트(`${prefix}/api`)와 정적/SPA 마운트(`${prefix}`)는 서로 다른 상대경로 공간을
 * 가지므로(같은 '/pages' 같은 문자열이 완전히 다른 의미일 수 있음), publicPaths 목록을
 * 마운트별로 분리해서 받는다 — config.publicPaths(API용), config.publicStaticPaths(정적/SPA용).
 */
function makeGuard(prefix, config, publicPaths) {
  if (config.public) return (req, res, next) => next();

  publicPaths = publicPaths || [];
  // customRoutes로 등록된 파일(예: studio.html)은 정적 서빙 경로로 직접 요청해도
  // publicPaths 와일드카드에 걸려 우회되지 않도록 항상 로그인을 요구한다.
  const protectedFiles = new Set((config.customRoutes || []).map(r => '/' + r.file));
  const appGuard = requireApp(prefix);

  return (req, res, next) => {
    const bypassable = publicPaths.length
      && req.method === 'GET'
      && !protectedFiles.has(req.path)
      && matchesPublicPath(req.path, publicPaths);
    if (bypassable) return next();
    requireLogin(req, res, () => appGuard(req, res, next));
  };
}

function mount(app) {
  const folders = fs.readdirSync(PROJECTS_DIR).filter(name => {
    // _로 시작하는 폴더(템플릿 등)는 스킵
    if (name.startsWith('_')) return false;
    const dir = path.join(PROJECTS_DIR, name);
    return fs.statSync(dir).isDirectory();
  });

  for (const name of folders) {
    const projectDir  = path.join(PROJECTS_DIR, name);
    const configPath  = path.join(projectDir, 'config.js');
    const routerPath  = path.join(projectDir, 'index.js');

    // config.js 없으면 스킵
    if (!fs.existsSync(configPath)) {
      console.warn(`  ⚠️  [${name}] config.js 없음 → 스킵`);
      continue;
    }

    const config = require(configPath);

    // enabled: false 이면 스킵
    if (config.enabled === false) {
      console.log(`  ⏸  [${name}] disabled → 스킵`);
      continue;
    }

    const prefix = config.prefix || `/${name}`;
    const apiGuard    = makeGuard(prefix, config, config.publicPaths);
    const staticGuard = makeGuard(prefix, config, config.publicStaticPaths || config.publicPaths);

    // 볼륨 등 public/ 바깥의 데이터 디렉토리를 정적 서빙해야 하는 경우
    // (예: mdboard 콘텐츠가 Railway 볼륨에 저장됨) — public/ 마운트보다 먼저 등록해 우선한다.
    if (Array.isArray(config.staticMounts)) {
      config.staticMounts.forEach(({ path: subPath, dir }) => {
        if (dir && fs.existsSync(dir)) {
          app.use(`${prefix}${subPath}`, staticGuard, require('express').static(dir));
        }
      });
    }

    // 정적 파일 (public/ 폴더가 있을 경우)
    const publicDir = path.join(projectDir, 'public');
    if (fs.existsSync(publicDir)) {
      app.use(prefix, staticGuard, require('express').static(publicDir));
    }

    // API 라우터 (index.js 있을 경우)
    if (fs.existsSync(routerPath)) {
      const router = require(routerPath);
      app.use(`${prefix}/api`, apiGuard, router);
    }

    // 커스텀 라우트: config.customRoutes = [{path, file}] → SPA catch-all 이전에 등록
    if (Array.isArray(config.customRoutes) && fs.existsSync(publicDir)) {
      config.customRoutes.forEach(({ path: routePath, file }) => {
        const filePath = path.join(publicDir, file);
        if (fs.existsSync(filePath)) {
          app.get(`${prefix}${routePath}`, staticGuard, (req, res) => res.sendFile(filePath));
        }
      });
    }

    // SPA catch-all: config.spa = true 이면 /<prefix>/* → index.html 서빙
    // viewer.js 처럼 클라이언트 라우팅이 필요한 프로젝트에 사용
    if (config.spa && fs.existsSync(publicDir)) {
      const indexFile = path.join(publicDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        app.get(`${prefix}/*`, staticGuard, (req, res) => res.sendFile(indexFile));
      }
    }

    registeredProjects.push({
      name:        config.name || name,
      prefix,
      description: config.description || '',
      icon:        config.icon || '📦',
    });
  }
}

function getList() {
  return registeredProjects;
}

function printStatus() {
  console.log('\n📦 등록된 프로젝트:');
  if (registeredProjects.length === 0) {
    console.log('  (없음)');
    return;
  }
  registeredProjects.forEach(p => {
    console.log(`  ✅ ${p.name.padEnd(20)} → ${p.prefix}`);
  });
  console.log('');
}

module.exports = { mount, getList, printStatus };
