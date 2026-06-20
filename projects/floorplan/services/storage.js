/**
 * projects/floorplan/services/storage.js
 * 데이터 저장소: PostgreSQL (floorplan_templates, floorplan_categories)
 */
const pool = require('../../../shared/db');

/* ── 평면도 ─────────────────────────────────────────────────────────── */
async function listFloorplans() {
  const { rows } = await pool.query(
    'SELECT id, name, modified_at FROM floorplan_templates ORDER BY modified_at DESC'
  );
  return rows.map(r => ({ id: r.id, name: r.name, modifiedTime: r.modified_at }));
}

async function getFloorplan(id) {
  const { rows } = await pool.query(
    'SELECT data FROM floorplan_templates WHERE id = $1', [id]
  );
  if (!rows.length) throw new Error('평면도 없음: ' + id);
  return rows[0].data;
}

async function saveFloorplan(name, data) {
  const id = name.endsWith('.fpd') ? name : name + '.fpd';
  await pool.query(
    `INSERT INTO floorplan_templates (id, name, data, modified_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id)
     DO UPDATE SET name = $2, data = $3, modified_at = NOW()`,
    [id, name.replace(/\.fpd$/, ''), JSON.stringify(data)]
  );
  return id;
}

async function deleteFloorplan(id) {
  await pool.query('DELETE FROM floorplan_templates WHERE id = $1', [id]);
}

/* ── 카테고리 ────────────────────────────────────────────────────────── */
async function getCategories() {
  const { rows } = await pool.query(
    'SELECT id, name, items FROM floorplan_categories ORDER BY sort_order'
  );
  if (!rows.length) return getDefaultCategories();
  return rows;
}

async function saveCategories(cats) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM floorplan_categories');
    for (let i = 0; i < cats.length; i++) {
      const c = cats[i];
      await client.query(
        'INSERT INTO floorplan_categories (id, name, items, sort_order) VALUES ($1,$2,$3,$4)',
        [c.id, c.name, JSON.stringify(c.items || []), i]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function getDefaultCategories() {
  return [
    {
      id: 'bedroom', name: '침실 / 거실', items: [
        { id: 'bed-d',  label: '더블침대',   w: 1600, h: 2100, color: '#1e3a5a', icon: '🛏' },
        { id: 'bed-s',  label: '싱글침대',   w: 1000, h: 2000, color: '#1e3a5a', icon: '🛏' },
        { id: 'sofa3',  label: '소파 3인',   w: 2200, h: 850,  color: '#1e4a2a', icon: '🛋' },
        { id: 'sofa2',  label: '소파 2인',   w: 1600, h: 800,  color: '#1e4a2a', icon: '🛋' },
        { id: 'tv',     label: 'TV장',       w: 1600, h: 450,  color: '#3a2a1e', icon: '📺' },
        { id: 'ward',   label: '옷장',       w: 1200, h: 600,  color: '#3a1e3a', icon: '🚪' },
        { id: 'desk',   label: '책상',       w: 1200, h: 600,  color: '#1e3a3a', icon: '🖥' },
        { id: 'ctable', label: '커피테이블', w: 900,  h: 550,  color: '#2a3a1e', icon: '☕' },
      ]
    },
    {
      id: 'kitchen', name: '주방 / 기타', items: [
        { id: 'din4',   label: '식탁 4인',   w: 1200, h: 700,  color: '#3a2a1e', icon: '🍽' },
        { id: 'din6',   label: '식탁 6인',   w: 1800, h: 900,  color: '#3a2a1e', icon: '🍽' },
        { id: 'fridge', label: '냉장고',     w: 600,  h: 650,  color: '#1e2a3a', icon: '🧊' },
        { id: 'washer', label: '세탁기',     w: 600,  h: 600,  color: '#1e2a3a', icon: '🌀' },
        { id: 'book',   label: '책장',       w: 900,  h: 300,  color: '#2a1e1e', icon: '📚' },
        { id: 'piano',  label: '피아노',     w: 1500, h: 600,  color: '#1a1a2a', icon: '🎹' },
        { id: 'plant',  label: '화분',       w: 400,  h: 400,  color: '#1e3a1e', icon: '🌿' },
        { id: 'bath',   label: '욕조',       w: 800,  h: 1500, color: '#2a1e2a', icon: '🛁' },
        { id: 'toilet', label: '변기',       w: 400,  h: 600,  color: '#1e2a2a', icon: '🚽' },
        { id: 'sink',   label: '주방싱크',   w: 1200, h: 600,  color: '#1e2a3a', icon: '🚿' },
      ]
    }
  ];
}

module.exports = { listFloorplans, getFloorplan, saveFloorplan, deleteFloorplan, getCategories, saveCategories, getDefaultCategories };
