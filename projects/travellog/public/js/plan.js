/**
 * plan.js - 일정 계획 탭
 */
const Plan = (() => {
  let _selectedDay = null;
  let _autocompleteService, _sessionToken;

  // ─── 렌더링 ──────────────────────────────────────────────────────────
  function render() {
    const { trip, schedules } = App.getState();
    renderDayTabs(trip, schedules);
    renderList(schedules);
  }

  function renderDayTabs(trip, schedules) {
    const el = document.getElementById('dayTabs');
    if (!trip) { el.innerHTML = ''; return; }

    const days = getDays(trip.startDate, trip.endDate);
    _selectedDay = _selectedDay || days[0];

    el.innerHTML = [
      `<button class="day-tab ${_selectedDay === 'all' ? 'active' : ''}" onclick="Plan.selectDay('all')">전체</button>`,
      ...days.map((d, i) => `<button class="day-tab ${_selectedDay === d ? 'active' : ''}" onclick="Plan.selectDay('${d}')">Day ${i + 1}</button>`)
    ].join('');
  }

  function getDays(start, end) {
    const days = [];
    const cur = new Date(start);
    const fin = new Date(end);
    while (cur <= fin) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  function selectDay(day) {
    _selectedDay = day;
    const { trip, schedules } = App.getState();
    renderDayTabs(trip, schedules);
    renderList(schedules);
  }

  function renderList(schedules) {
    const el = document.getElementById('scheduleList');
    if (!schedules.length) {
      el.innerHTML = '<div class="empty-state">일정이 없습니다<br/>＋ 버튼으로 추가해보세요</div>';
      return;
    }

    const filtered = _selectedDay === 'all' ? schedules : schedules.filter(s => s.date === _selectedDay);
    if (!filtered.length) {
      el.innerHTML = '<div class="empty-state">이 날짜에 일정이 없습니다</div>';
      return;
    }

    const catIcons = { '관광': '🏛️', '식사': '🍽️', '카페': '☕', '숙박': '🏨', '교통': '🚗', '쇼핑': '🛍️', '기타': '📌' };

    el.innerHTML = filtered.map((s, i) => `
      <div class="schedule-card" onclick="Map.panTo(${s.place?.lat || 0}, ${s.place?.lng || 0})">
        <div class="schedule-order">${i + 1}</div>
        <div class="schedule-body">
          <div class="schedule-time">${s.date}${s.time ? ' · ' + s.time : ''}${s.duration ? ' · ' + s.duration + '분' : ''}</div>
          <div class="schedule-place">${s.place?.name || '(장소 없음)'}</div>
          <div class="schedule-meta">
            <span class="schedule-category">${catIcons[s.category] || '📌'} ${s.category || ''}</span>
            ${s.memo ? `<span class="schedule-memo">${s.memo}</span>` : ''}
          </div>
        </div>
        <div class="schedule-actions">
          <button class="btn-xs" onclick="event.stopPropagation(); Plan.openAddModal('${s.id}')">✏️</button>
          <button class="btn-xs danger" onclick="event.stopPropagation(); Plan.deleteSchedule('${s.id}')">🗑</button>
        </div>
      </div>`).join('');
  }

  // ─── 일정 Modal ──────────────────────────────────────────────────────
  function openAddModal(id) {
    const { trip, schedules } = App.getState();
    if (!trip) return toast('먼저 여행을 선택해주세요', 'error');

    const modal = document.getElementById('scheduleModal');
    clearPlaceInput();

    if (id && id !== 'undefined') {
      const s = schedules.find(x => x.id === id);
      if (!s) return;
      document.getElementById('scheduleId').value         = s.id;
      document.getElementById('scheduleDate').value       = s.date;
      document.getElementById('scheduleTime').value       = s.time || '';
      document.getElementById('schedulePlaceName').value  = s.place?.name || '';
      document.getElementById('scheduleLat').value        = s.place?.lat || '';
      document.getElementById('scheduleLng').value        = s.place?.lng || '';
      document.getElementById('schedulePlaceId').value    = s.place?.placeId || '';
      document.getElementById('schedulePlaceAddress').value = s.place?.address || '';
      document.getElementById('scheduleCategory').value   = s.category || '관광';
      document.getElementById('scheduleDuration').value   = s.duration || '';
      document.getElementById('scheduleMemo').value       = s.memo || '';
      document.getElementById('scheduleModalTitle').textContent = '일정 수정';
    } else {
      document.getElementById('scheduleId').value         = '';
      document.getElementById('scheduleDate').value       = _selectedDay && _selectedDay !== 'all' ? _selectedDay : trip.startDate;
      document.getElementById('scheduleTime').value       = '';
      document.getElementById('schedulePlaceName').value  = '';
      document.getElementById('scheduleLat').value        = '';
      document.getElementById('scheduleLng').value        = '';
      document.getElementById('schedulePlaceId').value    = '';
      document.getElementById('schedulePlaceAddress').value = '';
      document.getElementById('scheduleCategory').value   = '관광';
      document.getElementById('scheduleDuration').value   = '';
      document.getElementById('scheduleMemo').value       = '';
      document.getElementById('scheduleModalTitle').textContent = '일정 추가';
    }
    modal.classList.remove('hidden');
    setupPlaceAutocomplete();
  }

  function closeModal() {
    document.getElementById('scheduleModal').classList.add('hidden');
    clearPlaceInput();
  }

  async function saveSchedule() {
    const { trip } = App.getState();
    const id       = document.getElementById('scheduleId').value;
    const date     = document.getElementById('scheduleDate').value;
    const time     = document.getElementById('scheduleTime').value;
    const name     = document.getElementById('schedulePlaceName').value.trim();
    const lat      = parseFloat(document.getElementById('scheduleLat').value);
    const lng      = parseFloat(document.getElementById('scheduleLng').value);
    const placeId  = document.getElementById('schedulePlaceId').value;
    const address  = document.getElementById('schedulePlaceAddress').value;
    const category = document.getElementById('scheduleCategory').value;
    const duration = parseInt(document.getElementById('scheduleDuration').value) || null;
    const memo     = document.getElementById('scheduleMemo').value.trim();

    if (!date || !name) return toast('날짜와 장소는 필수입니다', 'error');

    const data = {
      tripId: trip.id, date, time, category, duration, memo,
      place: { name, lat: lat || null, lng: lng || null, placeId, address },
    };

    try {
      const state = App.getState();
      if (id) {
        const updated = await API.updateSchedule(id, data);
        const idx = state.schedules.findIndex(s => s.id === id);
        if (idx >= 0) state.schedules[idx] = updated;
      } else {
        const created = await API.createSchedule(data);
        state.schedules.push(created);
      }
      closeModal();
      render();
      Map.renderPlan();
      toast('✅ 저장됨', 'success');
    } catch (e) {
      toast('오류: ' + e.message, 'error');
    }
  }

  async function deleteSchedule(id) {
    if (!confirm('이 일정을 삭제할까요?')) return;
    try {
      await API.deleteSchedule(id);
      const state = App.getState();
      state.schedules = state.schedules.filter(s => s.id !== id);
      render();
      Map.renderPlan();
      toast('삭제됨', 'success');
    } catch (e) {
      toast('오류: ' + e.message, 'error');
    }
  }

  // ─── 주변 추천에서 일정 추가 ─────────────────────────────────────────
  function addFromNearby(place) {
    const { trip } = App.getState();
    if (!trip) return toast('먼저 여행을 선택해주세요', 'error');
    openAddModal(null);
    setTimeout(() => {
      document.getElementById('schedulePlaceName').value    = place.name;
      document.getElementById('scheduleLat').value          = place.lat;
      document.getElementById('scheduleLng').value          = place.lng;
      document.getElementById('schedulePlaceId').value      = place.placeId || '';
      document.getElementById('schedulePlaceAddress').value = place.address || '';
    }, 50);
  }

  // ─── 장소 자동완성 ───────────────────────────────────────────────────
  function setupPlaceAutocomplete() {
    if (!window.google?.maps?.places) return;  // Maps 미연동 시 스킵
    _autocompleteService = new google.maps.places.AutocompleteService();
    _sessionToken = new google.maps.places.AutocompleteSessionToken();
    const input = document.getElementById('schedulePlaceName');
    const dropdown = document.getElementById('placeAutocomplete');

    const onInput = () => {
      const val = input.value.trim();
      if (!val) { dropdown.innerHTML = ''; dropdown.classList.add('hidden'); return; }
      _autocompleteService.getPlacePredictions(
        { input: val, sessionToken: _sessionToken, componentRestrictions: { country: 'kr' } },
        (predictions, status) => {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
            dropdown.innerHTML = ''; dropdown.classList.add('hidden'); return;
          }
          dropdown.classList.remove('hidden');
          dropdown.innerHTML = predictions.slice(0, 5).map(p => `
            <div class="place-ac-item" onclick="Plan._selectPrediction('${p.place_id}', '${p.structured_formatting?.main_text || p.description}')">
              <div>${p.structured_formatting?.main_text || p.description}</div>
              <div class="place-ac-addr">${p.structured_formatting?.secondary_text || ''}</div>
            </div>`).join('');
        }
      );
    };
    input.addEventListener('input', onInput);
    document.addEventListener('click', e => {
      if (!dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.add('hidden');
      }
    }, { once: false });
  }

  function _selectPrediction(placeId, name) {
    const service = new google.maps.places.PlacesService(document.createElement('div'));
    service.getDetails({ placeId, fields: ['name', 'geometry', 'formatted_address'], sessionToken: _sessionToken }, (place, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && place) {
        document.getElementById('schedulePlaceName').value    = place.name;
        document.getElementById('scheduleLat').value          = place.geometry.location.lat();
        document.getElementById('scheduleLng').value          = place.geometry.location.lng();
        document.getElementById('schedulePlaceId').value      = placeId;
        document.getElementById('schedulePlaceAddress').value = place.formatted_address || '';
        document.getElementById('placeAutocomplete').classList.add('hidden');
        _sessionToken = new google.maps.places.AutocompleteSessionToken();
      }
    });
  }

  function clearPlaceInput() {
    const dropdown = document.getElementById('placeAutocomplete');
    if (dropdown) { dropdown.innerHTML = ''; dropdown.classList.add('hidden'); }
  }

  return { render, renderList, selectDay, openAddModal, closeModal, saveSchedule, deleteSchedule, addFromNearby, _selectPrediction };
})();