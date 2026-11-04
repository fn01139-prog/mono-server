// Postgres 연결 + 스키마 적용
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// process.exit 대신 throw: mono-server 안에서 실행될 때 서버 전체가 죽지 않도록
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 환경변수가 필요합니다. (예: postgres://user:pass@localhost:5432/babylog)');
}

// BABYLOG_DB_SCHEMA: 다른 앱과 DB를 같이 쓸 때 테이블을 이 스키마에 격리 (예: babylog)
const SCHEMA = process.env.BABYLOG_DB_SCHEMA || '';
if (SCHEMA && !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) throw new Error('BABYLOG_DB_SCHEMA 형식 오류: ' + SCHEMA);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  ...(SCHEMA ? { options: `-c search_path=${SCHEMA}` } : {}),
});

async function init() {
  if (SCHEMA) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

const query = (text, params) => pool.query(text, params);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, init, query, tx };
