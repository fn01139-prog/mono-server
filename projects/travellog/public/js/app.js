/**
 * app.js - 앱 상태 관리 & 초기화
 */
const App = (() => {
  const state = {
    trips:          [],
    schedules:      [],
    records:        [],
    photos:         [],
    trip:           null,   // 선택된 여행
    tab:            'plan',
    mapsKey:        '',
    mapsAvailable:  false,  // Google Maps 로드 여부
  };

  // ─── 초기화 ──────────────────────────────────────────────────────────────
  async function init() {
    try {
      // Maps Key 로드
      const cfg = await API.config().catch(() => ({ mapsKey: '' }));
      state.mapsKey = cfg.mapsKey;

      // Google Maps 동적 로드 (실패해도 앱은 계속)
      if (state.mapsKey) {
        const mapsOk = await loadGoogleMaps(state.mapsKey);
        if (mapsOk) {
          Map.init();
        } else {
          showMapFallback('Google Maps 로드 실패 — API 키를 확인해주세요');
        }
      } else {
        showMapFallback('Google Maps API 키가 설정되지 않았습니다<br/><small>환경변수 GOOGLE_MAPS_KEY 설정 후 재시작</small>');
      }

      // 데이터 로드
      await loadAll();

      // 이벤트 바인딩
      bindEvents();
      restoreState();

      toast('✅ 로드 완료', 'success');
    } catch (e) {
      console.error(e);
      toast('⚠️ 로드 실패: ' + e.message, 'error');
    }
  }

  function loadGoogleMaps(key) {
    return new Promise(resolve => {
      if (window.google?.maps) return resolve(true);
      // 타임아웃: 10초 안에 로드 안 되면 실패 처리
      const timer = setTimeout(() => resolve(false), 10000);
      window._mapsReady = () => { clearTimeout(timer); resolve(true); };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=_mapsReady&language=ko`;
      s.onerror = () => { clearTimeout(timer); resolve(false); };
      document.head.appendChild(s);
    });
  }

  function showMapFallback(msg) {
    state.mapsAvailable = false;
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    mapEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0a1628;color:#6b8099;font-size:13px;text-align:center;padding:20px';
    mapEl.innerHTML = `<span style="font-size:32px">🗺️</span><div>${msg}</div>`;
    // 지도 관련 컨트롤 숨김
    document.getElementById('placeSearchBox').style.display = 'none';
    document.getElementById('nearbyPanel').style.display   = 'none';
    document.querySelector('.map-fab-group').style.display  = 'none';
  }

  async function loadAll() {
    const [trips] = await Promise.all([API.getTrips()]);
    state.trips = trips;
    renderTripList();
    if (trips.length > 0) {
      await selectTrip(trips[0]);
    }
  }

  // ─── 여행 선택 ────────────────────────────────────────────────────────────
  async function selectTrip(trip) {
    state.trip = trip;
    document.getElementById('tripBtnLabel').textContent = trip.name;

    const [schedules, records, photos] = await Promise.all([
      API.getSchedules(trip.id),
      API.getRecords(trip.id),
      API.getPhotos(trip.id),
    ]);
    state.schedules = schedules;
    state.records   = records;
    state.photos    = photos;

    Plan.render();
    Record.render();
    Map.renderPlan();

    closeTripDropdown();
  }

  // ─── 탭 전환 ─────────────────────────────────────────────────────────────
  function setTab(tab) {
    state.tab = tab;
    document.getElementById('panelPlan').classList.toggle('hidden', tab !== 'plan');
    document.getElementById('panelRecord').classList.toggle('hidden', tab !== 'record');
    document.getElementById('tabPlan').classList.toggle('active', tab === 'plan');
    document.getElementById('tabRecord').classList.toggle('active', tab === 'record');

    if (tab === 'plan')   Map.renderPlan();
    if (tab === 'record') Map.renderRecord();
  }

  // ─── Trip 드롭다운 ────────────────────────────────────────────────────────
  function renderTripList() {
    const el = document.getElementById('tripList');
    if (!state.trips.length) {
      el.innerHTML = '<div class="empty-state" style="padding:16px">아직 여행이 없습니다</div>';
      return;
    }
    el.innerHTML = state.trips.map(t => `
      <div class="trip-item ${state.trip?.id === t.id ? 'active' : ''}" onclick="App.onSelectTrip('${t.id}')">
        <div class="trip-item-info">
          <span class="trip-item-name">${t.name}</span>
          <span class="trip-item-date">${t.startDate} ~ ${t.endDate}</span>
        </div>
        <div class="trip-item-actions">
          <button class="btn-icon" onclick="event.stopPropagation(); App.openTripModal('${t.id}')" title="수정">✏️</button>
          <button class="btn-icon" onclick="event.stopPropagation(); App.deleteTrip('${t.id}')" title="삭제">🗑️</button>
        </div>
      </div>`).join('');
  }

  function onSelectTrip(id) {
    const t = state.trips.find(t => t.id === id);
    if (t) selectTrip(t);
  }

  function toggleTripDropdown() {
    const dd = document.getElementById('tripDropdown');
    dd.classList.toggle('hidden');
  }
  function closeTripDropdown() {
    document.getElementById('tripDropdown').classList.add('hidden');
  }

  // ─── Trip CRUD Modal ──────────────────────────────────────────────────────
  function openTripModal(id) {
    const modal = document.getElementById('tripModal');
    if (id) {
      const t = state.trips.find(t => t.id === id);
      if (!t) return;
      document.getElementById('tripId').value          = t.id;
      document.getElementById('tripName').value        = t.name;
      document.getElementById('tripStart').value       = t.startDate;
      document.getElementById('tripEnd').value         = t.endDate;
      document.getElementById('tripParticipants').value = (t.participants || []).join(', ');
      document.getElementById('tripNote').value        = t.note || '';
      document.getElementById('tripModalTitle').textContent = '여행 수정';
    } else {
      document.getElementById('tripId').value          = '';
      document.getElementById('tripName').value        = '';
      document.getElementById('tripStart').value       = '';
      document.getElementById('tripEnd').value         = '';
      document.getElementById('tripParticipants').value = '';
      document.getElementById('tripNote').value        = '';
      document.getElementById('tripModalTitle').textContent = '새 여행';
    }
    modal.classList.remove('hidden');
    closeTripDropdown();
  }

  function closeTripModal() {
    document.getElementById('tripModal').classList.add('hidden');
  }

  async function saveTrip() {
    const id     = document.getElementById('tripId').value;
    const name   = document.getElementById('tripName').value.trim();
    const start  = document.getElementById('tripStart').value;
    const end    = document.getElementById('tripEnd').value;
    const parts  = document.getElementById('tripParticipants').value.split(',').map(s => s.trim()).filter(Boolean);
    const note   = document.getElementById('tripNote').value.trim();

    if (!name || !start || !end) return toast('이름, 시작일, 종료일은 필수입니다', 'error');

    try {
      const data = { name, startDate: start, endDate: end, participants: parts, note };
      let trip;
      if (id) {
        trip = await API.updateTrip(id, data);
        const idx = state.trips.findIndex(t => t.id === id);
        if (idx >= 0) state.trips[idx] = trip;
      } else {
        trip = await API.createTrip(data);
        state.trips.unshift(trip);
      }
      renderTripList();
      closeTripModal();
      await selectTrip(state.trips.find(t => t.id === trip.id));
      toast('✅ 저장됨', 'success');
    } catch (e) {
      toast('오류: ' + e.message, 'error');
    }
  }

  async function deleteTrip(id) {
    if (!confirm('여행을 삭제하면 일정, 기록도 모두 삭제됩니다. 계속할까요?')) return;
    try {
      await API.deleteTrip(id);
      state.trips = state.trips.filter(t => t.id !== id);
      if (state.trip?.id === id) {
        state.trip = null;
        state.schedules = []; state.records = []; state.photos = [];
        document.getElementById('tripBtnLabel').textContent = '여행 선택';
        Plan.render(); Record.render(); Map.clear();
      }
      renderTripList();
      toast('삭제됨', 'success');
    } catch (e) {
      toast('오류: ' + e.message, 'error');
    }
  }

  // ─── Photo Modal ──────────────────────────────────────────────────────────
  function openPhotoModal(photo) {
    const modal = document.getElementById('photoModal');
    document.getElementById('photoFull').src = photo.viewUrl || photo.thumbnailUrl;
    document.getElementById('photoInfo').innerHTML = [
      photo.takenAt ? `📅 ${photo.takenAt.replace('T', ' ').slice(0, 16)}` : '',
      photo.lat     ? `📍 ${photo.lat.toFixed(4)}, ${photo.lng.toFixed(4)}` : '',
      photo.cameraModel ? `📷 ${photo.cameraMake || ''} ${photo.cameraModel}` : '',
    ].filter(Boolean).join(' &nbsp;|&nbsp; ');
    modal.classList.remove('hidden');
  }
  function closePhotoModal() {
    document.getElementById('photoModal').classList.add('hidden');
    document.getElementById('photoFull').src = '';
  }

  // ─── 이벤트 ──────────────────────────────────────────────────────────────
  function bindEvents() {
    document.addEventListener('click', e => {
      const dd = document.getElementById('tripDropdown');
      const btn = document.getElementById('tripBtn');
      if (!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        dd.classList.add('hidden');
      }
    });
  }

  function restoreState() {
    // 기본 탭: plan
    setTab('plan');
  }

  // ─── Getters ──────────────────────────────────────────────────────────────
  function getState() { return state; }

  window.addEventListener('DOMContentLoaded', init);

  return {
    getState, setTab, selectTrip, onSelectTrip,
    toggleTripDropdown, closeTripDropdown,
    openTripModal, closeTripModal, saveTrip, deleteTrip,
    openPhotoModal, closePhotoModal,
    renderTripList,
    refreshPhotos: async () => {
      if (!state.trip) return;
      state.photos = await API.getPhotos(state.trip.id);
    },
  };
})();

// ─── Toast ───────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type ? ' ' + type : ''}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}