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

const PROJECTS_DIR = path.join(__dirname, '../projects');
const registeredProjects = [];

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

    // 정적 파일 (public/ 폴더가 있을 경우)
    const publicDir = path.join(projectDir, 'public');
    if (fs.existsSync(publicDir)) {
      app.use(prefix, require('express').static(publicDir));
    }

    // API 라우터 (index.js 있을 경우)
    if (fs.existsSync(routerPath)) {
      const router = require(routerPath);
      app.use(`${prefix}/api`, router);
    }

    // 커스텀 라우트: config.customRoutes = [{path, file}] → SPA catch-all 이전에 등록
    if (Array.isArray(config.customRoutes) && fs.existsSync(publicDir)) {
      config.customRoutes.forEach(({ path: routePath, file }) => {
        const filePath = path.join(publicDir, file);
        if (fs.existsSync(filePath)) {
          app.get(`${prefix}${routePath}`, (req, res) => res.sendFile(filePath));
        }
      });
    }

    // SPA catch-all: config.spa = true 이면 /<prefix>/* → index.html 서빙
    // viewer.js 처럼 클라이언트 라우팅이 필요한 프로젝트에 사용
    if (config.spa && fs.existsSync(publicDir)) {
      const indexFile = path.join(publicDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        app.get(`${prefix}/*`, (req, res) => res.sendFile(indexFile));
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
