require('dotenv').config();

module.exports = {
//  port: parseInt(process.env.PORT) || 3000,
  name:        '평면도',
  prefix:      '/floorplan',
  description: '평면도 그리기',
  icon:        '🌐',
  enabled:     true,
  spa:         true,   // /:pageId → index.html SPA 라우팅

  // 관리자 토큰 목록 (쉼표 구분)
  adminTokens: (process.env.ADMIN_TOKENS || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean),

  // Google Drive
  googleServiceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || './credentials/gdrive-service-account.json',
  gdriveFolderId: process.env.GDRIVE_FOLDER_ID || '',

  // 로컬 폴백
  useLocalFallback: process.env.USE_LOCAL_FALLBACK !== 'false',
  localDataDir: process.env.LOCAL_DATA_DIR || './data',
};