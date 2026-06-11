const fs   = require('fs');
const path = require('path');
const config = require('../config');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function dirFor(subFolder) {
  const dir = path.join(config.localDataDir, subFolder);
  ensureDir(dir);
  return dir;
}

function listFiles(subFolder) {
  const dir = dirFor(subFolder);
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') || f.endsWith('.fpd'))
    .map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { id: name, name, modifiedTime: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
}

function readFile(subFolder, fileName) {
  const fp = path.join(dirFor(subFolder), fileName);
  if (!fs.existsSync(fp)) throw new Error('파일 없음: ' + fileName);
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

function saveFile(subFolder, fileName, content) {
  const fp = path.join(dirFor(subFolder), fileName);
  fs.writeFileSync(fp, JSON.stringify(content, null, 2), 'utf-8');
  return fileName;
}

function deleteFile(subFolder, fileName) {
  const fp = path.join(dirFor(subFolder), fileName);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

module.exports = { listFiles, readFile, saveFile, deleteFile };
