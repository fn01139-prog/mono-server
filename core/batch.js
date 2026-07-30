/**
 * core/batch.js
 * 플랫폼 공통 배치잡 프레임워크 — core/jobs/*.js 를 자동 스캔해 node-cron으로 스케줄링한다.
 *
 * 새 배치잡 추가 방법: core/jobs/<name>.js 에서 아래 형태로 export
 *   module.exports = {
 *     id: 'unique-job-id',
 *     name: '사람이 읽는 이름',
 *     schedule: '0 3 * * *',   // cron 표현식 (분 시 일 월 요일)
 *     description: '이 잡이 하는 일',
 *     run: async (pool) => { ... return '요약 문자열(선택)' },
 *   };
 * → 서버 재시작만 하면 자동 등록되고 admin 콘솔(/admin, 배치잡 탭)에서 조회/수동실행/on-off 가능.
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const pool = require('../shared/db');

const JOBS_DIR = path.join(__dirname, 'jobs');
const jobs = new Map(); // id -> { id, name, schedule, description, run, task, running }

function loadJobs() {
  if (!fs.existsSync(JOBS_DIR)) return;
  for (const file of fs.readdirSync(JOBS_DIR)) {
    if (!file.endsWith('.js')) continue;
    const def = require(path.join(JOBS_DIR, file));
    if (!def?.id || !def.schedule || typeof def.run !== 'function') {
      console.warn(`  ⚠️  [batch] ${file} — id/schedule/run 누락, 스킵`);
      continue;
    }
    if (!cron.validate(def.schedule)) {
      console.warn(`  ⚠️  [batch] ${file} — 잘못된 cron 표현식(${def.schedule}), 스킵`);
      continue;
    }
    if (jobs.has(def.id)) {
      console.warn(`  ⚠️  [batch] 중복 잡 id: ${def.id} — 스킵`);
      continue;
    }
    jobs.set(def.id, { ...def, running: false });
  }
}

async function ensureDbRow(id, name, schedule) {
  await pool.query(
    `INSERT INTO platform_batch_jobs (id, name, schedule) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = $2, schedule = $3`,
    [id, name, schedule]
  );
}

async function isEnabled(id) {
  const { rows } = await pool.query('SELECT enabled FROM platform_batch_jobs WHERE id = $1', [id]);
  return rows[0]?.enabled !== false; // 행이 없으면 기본 true
}

/** 잡을 즉시 실행 (수동 트리거는 enabled=false 여도 동작함) */
async function execute(id) {
  const job = jobs.get(id);
  if (!job) throw new Error(`알 수 없는 잡: ${id}`);
  if (job.running) throw new Error('이미 실행 중입니다');

  job.running = true;
  const startedAt = new Date();
  let status = 'success';
  let errorMsg = null;
  let summary = null;
  try {
    summary = await job.run(pool);
  } catch (e) {
    status = 'error';
    errorMsg = e.message;
  } finally {
    job.running = false;
  }
  const finishedAt = new Date();
  const durationMs = finishedAt - startedAt;

  await pool.query(
    `INSERT INTO platform_batch_log (job_id, status, started_at, finished_at, duration_ms, error, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, status, startedAt, finishedAt, durationMs, errorMsg, summary ? String(summary).slice(0, 2000) : null]
  );
  await pool.query(
    'UPDATE platform_batch_jobs SET last_run_at = $2, last_status = $3 WHERE id = $1',
    [id, finishedAt, status]
  );

  if (status === 'error') throw new Error(errorMsg);
  return summary;
}

async function init() {
  loadJobs();
  for (const job of jobs.values()) {
    await ensureDbRow(job.id, job.name, job.schedule);
    job.task = cron.schedule(job.schedule, async () => {
      const enabled = await isEnabled(job.id).catch(() => true);
      if (!enabled) return;
      try {
        await execute(job.id);
      } catch (e) {
        console.error(`[batch] ${job.id} 실행 실패:`, e.message);
      }
    });
  }
  console.log(`\n⏱  배치잡 등록: ${jobs.size}개`);
}

async function list() {
  const { rows } = await pool.query('SELECT * FROM platform_batch_jobs ORDER BY id');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    schedule: r.schedule,
    enabled: r.enabled,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    description: jobs.get(r.id)?.description || '',
    running: jobs.get(r.id)?.running || false,
    registered: jobs.has(r.id),
  }));
}

async function setEnabled(id, enabled) {
  await pool.query('UPDATE platform_batch_jobs SET enabled = $2 WHERE id = $1', [id, enabled]);
}

async function getLogs(jobId, limit = 50) {
  if (jobId) {
    const { rows } = await pool.query(
      'SELECT * FROM platform_batch_log WHERE job_id = $1 ORDER BY started_at DESC LIMIT $2',
      [jobId, limit]
    );
    return rows;
  }
  const { rows } = await pool.query(
    'SELECT * FROM platform_batch_log ORDER BY started_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

module.exports = { init, execute, list, setEnabled, getLogs };
