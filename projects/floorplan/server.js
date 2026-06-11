/**
 * server.js — 단독 실행용 (개발/테스트)
 * mono-server 통합 시에는 index.js를 사용하세요.
 *
 * 사용법:
 *   node server.js
 *   → http://localhost:3000
 *
 * mono-server 통합 예시 (projects/floorplan/index.js):
 *   const floorplan = require('./projects/floorplan');
 *   app.use('/floorplan', floorplan);
 *   app.use('/floorplan', express.static('./projects/floorplan/public'));
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app    = express();
const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 정적 파일
app.use(express.static(path.join(__dirname, 'public')));

// floorplan 라우터 루트에 마운트 (단독 실행 시 BASE='')
app.use('/', require('./index.js'));

// SPA 폴백
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  const config = require('./config');
  console.log(`\n🏠 평면도 편집기 (단독 실행)`);
  console.log(`   포트    : ${PORT}`);
  console.log(`   관리자  : ${config.adminTokens.length}개 토큰 등록됨`);
  console.log(`   저장소  : ${config.gdriveFolderId ? 'Google Drive' : '로컬 파일'}`);
  console.log(`   URL     : http://localhost:${PORT}\n`);
});
