// projects/mindmap/db/pool.js
// Railway에 Postgres 플러그인을 추가하면 DATABASE_URL 환경변수가 자동 주입됩니다.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway 외부 프록시 연결은 SSL이 필요합니다.
  // 같은 Railway 프로젝트 내부망(internal hostname)으로 붙는다면 false로 바꿔도 됩니다.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('[mindmap] PG pool error:', err);
});

module.exports = pool;
