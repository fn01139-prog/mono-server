'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { TREE_FILE, ACCESS_LOG } = require('./paths');

function loadTree() {
  if (!fs.existsSync(TREE_FILE)) {
    const initial = { version: 1, majors: [] };
    fs.writeFileSync(TREE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(TREE_FILE, 'utf8'));
}

let tree = loadTree();

function persistTree() {
  fs.writeFileSync(TREE_FILE, JSON.stringify(tree, null, 2));
}

function findMajor(majorId) {
  return tree.majors.find((m) => m.id === majorId);
}

function findMidAnywhere(midId) {
  for (const major of tree.majors) {
    const mid = major.mids.find((m) => m.id === midId);
    if (mid) return { major, mid };
  }
  return null;
}

function findDoc(docId) {
  for (const major of tree.majors) {
    for (const mid of major.mids) {
      const doc = mid.docs.find((d) => d.id === docId);
      if (doc) return { major, mid, doc };
    }
  }
  return null;
}

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function isValidId(id, prefix) {
  return typeof id === 'string' && new RegExp(`^${prefix}_[0-9a-f]{12}$`).test(id);
}

function hashCode(code) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(code, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyCode(code, stored) {
  if (!stored) return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const check = crypto.scryptSync(code, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (check.length !== expected.length) return false;
  return crypto.timingSafeEqual(check, expected);
}

function logAccess(req, action, detail) {
  const entry = {
    ts: new Date().toISOString(),
    ip: req.socket.remoteAddress || '',
    action,
    detail: detail || null,
  };
  fs.appendFile(ACCESS_LOG, JSON.stringify(entry) + '\n', () => {});
}

module.exports = {
  get tree() {
    return tree;
  },
  persistTree,
  findMajor,
  findMidAnywhere,
  findDoc,
  genId,
  isValidId,
  hashCode,
  verifyCode,
  logAccess,
};
