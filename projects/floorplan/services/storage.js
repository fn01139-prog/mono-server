const config  = require('../config');
const gdrive  = require('./gdrive');
const local   = require('./local');

const USE_DRIVE = () => !!config.gdriveFolderId && gdrive.getDrive();

// ── 평면도 (templates 서브폴더) ─────────────────────
const TEMPLATES = 'templates';
const CATS_FILE = 'categories.json';
const CATS_DIR  = 'config';

async function listFloorplans() {
  if (USE_DRIVE()) {
    const files = await gdrive.listFiles(TEMPLATES);
    return files.map(f => ({ id: f.id, name: f.name.replace(/\.fpd$/, ''), modifiedTime: f.modifiedTime }));
  }
  return local.listFiles(TEMPLATES).map(f => ({
    id: f.name, name: f.name.replace(/\.fpd$|\.json$/, ''), modifiedTime: f.modifiedTime
  }));
}

async function getFloorplan(id) {
  if (USE_DRIVE()) {
    const raw = await gdrive.readFile(id);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  return local.readFile(TEMPLATES, id);
}

async function saveFloorplan(name, data) {
  const fileName = name.endsWith('.fpd') ? name : name + '.fpd';
  if (USE_DRIVE()) return gdrive.saveFile(TEMPLATES, fileName, data);
  local.saveFile(TEMPLATES, fileName, data);
  return fileName;
}

async function deleteFloorplan(id) {
  if (USE_DRIVE()) return gdrive.deleteFile(id);
  local.deleteFile(TEMPLATES, id);
}

// ── 카테고리 ────────────────────────────────────────
async function getCategories() {
  try {
    if (USE_DRIVE()) {
      const files = await gdrive.listFiles(CATS_DIR);
      const cf = files.find(f => f.name === CATS_FILE);
      if (!cf) return getDefaultCategories();
      const raw = await gdrive.readFile(cf.id);
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    return local.readFile(CATS_DIR, CATS_FILE);
  } catch {
    return getDefaultCategories();
  }
}

async function saveCategories(data) {
  if (USE_DRIVE()) return gdrive.saveFile(CATS_DIR, CATS_FILE, data);
  local.saveFile(CATS_DIR, CATS_FILE, data);
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
