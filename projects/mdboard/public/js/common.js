/**
 * common.js  ─  API 공통 유틸리티 및 공유 기능
 * mdBoard
 */

/* ── 인증 토큰 관리 ────────────────────────────────────────────────────── */
const Auth = {
  KEY: 'mdboard_token',
  getToken()  { return localStorage.getItem(this.KEY) || ''; },
  setToken(t) { localStorage.setItem(this.KEY, t); },
  clear()     { localStorage.removeItem(this.KEY); },
  isAuthenticated() { return !!this.getToken(); }
};

/* ── API 래퍼 ──────────────────────────────────────────────────────────── */
const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': Auth.getToken()
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async delete(url) {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-auth-token': Auth.getToken() }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async uploadImage(file) {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/mdboard/api/upload-image', {
      method: 'POST',
      headers: { 'x-auth-token': Auth.getToken() },
      body: fd
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async uploadHtml(file) {
    const fd = new FormData();
    fd.append('html', file);
    const res = await fetch('/mdboard/api/upload-html', {
      method: 'POST',
      headers: { 'x-auth-token': Auth.getToken() },
      body: fd
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async authCheck() {
    const res = await fetch('/mdboard/api/auth/check');
    return res.json();
  },

  async auth(password) {
    const res = await fetch('/mdboard/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    return res.json();
  }
};

/* ── 유틸리티 ──────────────────────────────────────────────────────────── */

/** 용량 표시 (bytes → 읽기 쉬운 단위) */
function formatSize(bytes) {
  if (bytes < 1024)           return bytes + ' B';
  if (bytes < 1024 * 1024)    return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3)      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(1) + ' GB';
}

/** 날짜 포맷 */
function formatDate(dateStr, full = false) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (full) {
    return d.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  const now  = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60)     return '방금 전';
  if (diff < 3600)   return Math.floor(diff / 60) + '분 전';
  if (diff < 86400)  return Math.floor(diff / 3600) + '시간 전';
  if (diff < 604800) return Math.floor(diff / 86400) + '일 전';
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

/** 초 → 시간 표시 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

/** Toast 알림 */
function showToast(message, type = 'info') {
  // 기존 toast 제거
  const old = document.querySelector('.toast');
  if (old) old.remove();

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('show'));
  });

  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2800);
}

/** 로컬 스토리지 래퍼 */
const Store = {
  get(key, def = null) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : def;
    } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
};

/** 텍스트 내 단어/문자 수 계산 */
function countText(text) {
  const lines = text.split('\n').length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  return { lines, words, chars };
}

/** 파일명 안전하게 변환 */
function safeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
}

/* ── 모니터링 패널 (index.html용) ──────────────────────────────────────── */
async function refreshMonitor() {
  const panel = document.getElementById('monitorPanel');
  if (!panel) return;

  const btn = document.querySelector('.btn-monitor');
  if (btn) btn.classList.add('loading');

  try {
    const data = await API.get('/mdboard/api/stats');
    if (!data.success) throw new Error('API 오류');

    const { memory, cpu, uptime, platform, arch, nodeVersion, timestamp } = data;
    const memPct   = memory.usedPercent;
    const memClass = memPct > 85 ? 'crit' : memPct > 65 ? 'warn' : 'good';
    const heapPct  = Math.round((memory.processHeap / memory.heapTotal) * 100);

    panel.innerHTML = `
      <div class="monitor-title">
        서버 리소스 모니터
        <span class="monitor-time">${new Date(timestamp).toLocaleTimeString('ko-KR')}</span>
      </div>

      <div class="monitor-section-title">메모리</div>
      <div class="monitor-row">
        <span class="monitor-label">시스템 메모리</span>
        <span class="monitor-value ${memClass}">${memPct}% (${formatSize(memory.used)} / ${formatSize(memory.total)})</span>
      </div>
      <div class="monitor-bar-wrap">
        <div class="monitor-bar ${memClass}" style="width:${memPct}%"></div>
      </div>
      <div class="monitor-row">
        <span class="monitor-label">Node.js 힙</span>
        <span class="monitor-value">${formatSize(memory.processHeap)} / ${formatSize(memory.heapTotal)} (${heapPct}%)</span>
      </div>
      <div class="monitor-row">
        <span class="monitor-label">프로세스 RSS</span>
        <span class="monitor-value">${formatSize(memory.processRss)}</span>
      </div>

      <div class="monitor-section-title">CPU</div>
      <div class="monitor-row">
        <span class="monitor-label">Load Avg (1m / 5m / 15m)</span>
        <span class="monitor-value">${cpu.loadAvg1} / ${cpu.loadAvg5} / ${cpu.loadAvg15}</span>
      </div>
      <div class="monitor-row">
        <span class="monitor-label">CPU 코어</span>
        <span class="monitor-value">${cpu.cores}개</span>
      </div>

      <div class="monitor-section-title">시스템</div>
      <div class="monitor-row">
        <span class="monitor-label">OS 업타임</span>
        <span class="monitor-value">${formatUptime(uptime.system)}</span>
      </div>
      <div class="monitor-row">
        <span class="monitor-label">프로세스 업타임</span>
        <span class="monitor-value">${formatUptime(uptime.process)}</span>
      </div>
      <div class="monitor-row">
        <span class="monitor-label">플랫폼 / Node</span>
        <span class="monitor-value">${platform} ${arch} / ${nodeVersion}</span>
      </div>
    `;

    if (btn) btn.classList.remove('loading');
    panel.classList.add('open');

    // 외부 클릭 시 닫기
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!panel.contains(e.target) && !e.target.closest('.btn-monitor')) {
          panel.classList.remove('open');
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 0);

  } catch (e) {
    if (btn) btn.classList.remove('loading');
    showToast('서버 정보를 불러올 수 없습니다.', 'error');
  }
}

/* 전역 노출 */
window.Auth       = Auth;
window.API        = API;
window.formatSize = formatSize;
window.formatDate = formatDate;
window.formatUptime = formatUptime;
window.showToast  = showToast;
window.Store      = Store;
window.countText  = countText;
window.safeName   = safeName;
window.refreshMonitor = refreshMonitor;
