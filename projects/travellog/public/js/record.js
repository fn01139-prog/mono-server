/**
 * record.js - 여행 기록 탭
 */
const Record = (() => {
  let _editId   = null;
  let _rating   = 0;
  let _selectedPhotoIds = [];

  // ─── 렌더링 ──────────────────────────────────────────────────────────
  function render() {
    const { records, photos } = App.getState();
    const el = document.getElementById('recordList');

    if (!records.length) {
      el.innerHTML = '<div class="empty-state">기록이 없습니다<br/>＋ 버튼으로 추가해보세요</div>';
      return;
    }

    el.innerHTML = records.map(r => {
      const rPhotos = (r.photoIds || []).map(id => photos.find(p => p.fileId === id)).filter(Boolean);
      const stars   = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
      const thumbs  = rPhotos.slice(0, 3).map(p =>
        `<div class="record-photo" onclick="App.openPhotoModal(${JSON.stringify(p).replace(/"/g, '&quot;')})"><img src="${p.thumbnailUrl}" alt="" loading="lazy" /></div>`
      ).join('');

      return `
        <div class="record-card">
          ${rPhotos.length > 0 ? `<div class="record-photos">${thumbs}</div>` : ''}
          <div class="record-head">
            <span class="record-place">${r.placeName || '(장소 없음)'}</span>
            <span class="record-stars">${stars}</span>
          </div>
          <div class="record-date">${r.date}${r.participants?.length ? ' · ' + r.participants.join(', ') : ''}</div>
          <div class="record-memo">${r.memo || ''}</div>
          <div class="record-actions">
            <button class="btn-xs" onclick="Record.openAddModal('${r.id}')">✏️ 수정</button>
            <button class="btn-xs danger" onclick="Record.deleteRecord('${r.id}')">🗑</button>
          </div>
        </div>`;
    }).join('');
  }

  // ─── Modal ────────────────────────────────────────────────────────────
  function openAddModal(id) {
    const { trip, records, photos } = App.getState();
    if (!trip) return toast('먼저 여행을 선택해주세요', 'error');

    _rating = 0;
    _selectedPhotoIds = [];

    const modal = document.getElementById('recordModal');
    renderStars(0);

    if (id && id !== 'undefined') {
      const r = records.find(x => x.id === id);
      if (!r) return;
      _editId = id;
      _rating = r.rating || 0;
      _selectedPhotoIds = [...(r.photoIds || [])];

      document.getElementById('recordId').value           = r.id;
      document.getElementById('recordDate').value         = r.date;
      document.getElementById('recordPlaceName').value    = r.placeName || '';
      document.getElementById('recordParticipants').value = (r.participants || []).join(', ');
      document.getElementById('recordMemo').value         = r.memo || '';
      document.getElementById('recordRating').value       = r.rating || 0;
      document.getElementById('recordModalTitle').textContent = '기록 수정';
      renderStars(r.rating || 0);
    } else {
      _editId = null;
      document.getElementById('recordId').value           = '';
      document.getElementById('recordDate').value         = trip.startDate;
      document.getElementById('recordPlaceName').value    = '';
      document.getElementById('recordParticipants').value = (trip.participants || []).join(', ');
      document.getElementById('recordMemo').value         = '';
      document.getElementById('recordRating').value       = 0;
      document.getElementById('recordModalTitle').textContent = '기록 추가';
    }

    renderPhotoPicker(photos);
    bindStarInput();
    modal.classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('recordModal').classList.add('hidden');
    _editId = null; _selectedPhotoIds = [];
  }

  async function saveRecord() {
    const { trip } = App.getState();
    const date     = document.getElementById('recordDate').value;
    const place    = document.getElementById('recordPlaceName').value.trim();
    const parts    = document.getElementById('recordParticipants').value.split(',').map(s => s.trim()).filter(Boolean);
    const memo     = document.getElementById('recordMemo').value.trim();

    if (!date || !place) return toast('날짜와 장소명은 필수입니다', 'error');

    const data = {
      tripId: trip.id, date, placeName: place,
      participants: parts, memo, rating: _rating,
      photoIds: _selectedPhotoIds,
    };

    try {
      const state = App.getState();
      if (_editId) {
        const updated = await API.updateRecord(_editId, data);
        const idx = state.records.findIndex(r => r.id === _editId);
        if (idx >= 0) state.records[idx] = updated;
      } else {
        const created = await API.createRecord(data);
        state.records.unshift(created);
      }
      closeModal();
      render();
      Map.renderRecord();
      toast('✅ 저장됨', 'success');
    } catch (e) {
      toast('오류: ' + e.message, 'error');
    }
  }

  async function deleteRecord(id) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try {
      await API.deleteRecord(id);
      const state = App.getState();
      state.records = state.records.filter(r => r.id !== id);
      render();
      Map.renderRecord();
      toast('삭제됨', 'success');
    } catch (e) {
      toast('오류: ' + e.message, 'error');
    }
  }

  // ─── 별점 ─────────────────────────────────────────────────────────────
  function bindStarInput() {
    document.querySelectorAll('.star').forEach(star => {
      star.onclick = () => {
        _rating = parseInt(star.dataset.v);
        document.getElementById('recordRating').value = _rating;
        renderStars(_rating);
      };
    });
  }

  function renderStars(val) {
    document.querySelectorAll('.star').forEach(star => {
      star.classList.toggle('on', parseInt(star.dataset.v) <= val);
    });
  }

  // ─── 사진 선택 ────────────────────────────────────────────────────────
  function renderPhotoPicker(photos) {
    const el = document.getElementById('photoPicker');
    if (!photos.length) {
      el.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">업로드된 사진이 없습니다</div>';
      return;
    }
    el.innerHTML = photos.map(p => `
      <div class="photo-pick-item ${_selectedPhotoIds.includes(p.fileId) ? 'selected' : ''}"
           onclick="Record.togglePhoto('${p.fileId}', this)">
        <img src="${p.thumbnailUrl}" alt="" loading="lazy" />
      </div>`).join('');
  }

  function togglePhoto(fileId, el) {
    const idx = _selectedPhotoIds.indexOf(fileId);
    if (idx >= 0) {
      _selectedPhotoIds.splice(idx, 1);
      el.classList.remove('selected');
    } else {
      _selectedPhotoIds.push(fileId);
      el.classList.add('selected');
    }
  }

  return { render, openAddModal, closeModal, saveRecord, deleteRecord, togglePhoto };
})();
