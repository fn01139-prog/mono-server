/**
 * map.js - Google Maps 연동
 */
const Map = (() => {
  let _map, _infoWindow, _markers = [], _photoMarkers = [], _polyline, _autocomplete;
  let _showRoute = false, _showNearby = true;
  let _nearbyMarkers = [], _activeType = '맛집';
  let _nearbyCenter = null;

  // ─── 초기화 ────────────────────────────────────────────────────────────
  function init() {
    try {
      _map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 36.5, lng: 127.8 },
        zoom: 7,
        disableDefaultUI: true,
        zoomControl: true,
        styles: DARK_STYLE,
      });
      _infoWindow = new google.maps.InfoWindow();
      App.getState().mapsAvailable = true;

      // 장소 검색 Autocomplete
      const input = document.getElementById('placeSearchInput');
      _autocomplete = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'kr' },
        fields: ['name', 'geometry', 'formatted_address'],
      });
      _autocomplete.addListener('place_changed', () => {
        const place = _autocomplete.getPlace();
        if (place.geometry) {
          _map.panTo(place.geometry.location);
          _map.setZoom(15);
          _nearbyCenter = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
        }
      });

      _map.addListener('click', () => _infoWindow.close());
    } catch (e) {
      console.error('[map] 초기화 실패:', e);
    }
  }

  // ─── 계획 탭: 번호 마커 + 경로선 ─────────────────────────────────────
  function renderPlan() {
    if (!_map) return;
    clearMarkers();
    const { schedules } = App.getState();
    if (!schedules.length) return;

    const bounds = new google.maps.LatLngBounds();
    const valid  = schedules.filter(s => s.place?.lat && s.place?.lng);

    valid.forEach((s, i) => {
      const pos = { lat: s.place.lat, lng: s.place.lng };
      const marker = new google.maps.marker.AdvancedMarkerElement
        ? createAdvancedMarker(pos, i + 1, s)
        : createLegacyMarker(pos, i + 1, s);
      _markers.push(marker);
      bounds.extend(pos);
    });

    if (valid.length > 0) _map.fitBounds(bounds, 80);

    if (_showRoute && valid.length > 1) drawRoute(valid.map(s => ({ lat: s.place.lat, lng: s.place.lng })));
  }

  function createLegacyMarker(pos, order, schedule) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <ellipse cx="16" cy="38" rx="6" ry="2" fill="rgba(0,0,0,.3)"/>
      <path d="M16 0C9.4 0 4 5.4 4 12c0 9 12 28 12 28S28 21 28 12C28 5.4 22.6 0 16 0z" fill="#e8a020"/>
      <circle cx="16" cy="12" r="8" fill="rgba(0,0,0,.25)"/>
      <text x="16" y="16.5" text-anchor="middle" fill="#000" font-size="10" font-weight="700" font-family="sans-serif">${order}</text>
    </svg>`;
    const icon = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(32, 40), anchor: new google.maps.Point(16, 40) };
    const marker = new google.maps.Marker({ position: pos, map: _map, icon, title: schedule.place.name, zIndex: 100 - order });
    marker.addListener('click', () => showSchedulePopup(marker, schedule));
    return marker;
  }

  function createAdvancedMarker(pos, order, schedule) {
    // AdvancedMarkerElement (newer Maps API)
    const div = document.createElement('div');
    div.className = 'map-marker-order';
    div.textContent = order;
    const marker = new google.maps.marker.AdvancedMarkerElement({ position: pos, map: _map, content: div, title: schedule.place.name, zIndex: 100 - order });
    marker.addEventListener('click', () => showSchedulePopup(marker, schedule));
    return marker;
  }

  function showSchedulePopup(marker, schedule) {
    const catIcons = { '관광': '🏛️', '식사': '🍽️', '카페': '☕', '숙박': '🏨', '교통': '🚗', '쇼핑': '🛍️', '기타': '📌' };
    const icon = catIcons[schedule.category] || '📌';
    _infoWindow.setContent(`
      <div class="map-popup">
        <div class="map-popup-title">${icon} ${schedule.place.name}</div>
        <div class="map-popup-meta">${schedule.date}${schedule.time ? ' ' + schedule.time : ''}</div>
        ${schedule.memo ? `<div class="map-popup-meta" style="margin-top:4px">${schedule.memo}</div>` : ''}
        <button class="map-popup-btn" onclick="Plan.openAddModal('${schedule.id}')">✏️ 수정</button>
      </div>`);
    _infoWindow.open(_map, marker);
  }

  // ─── 기록 탭: 사진 썸네일 클러스터 ───────────────────────────────────
  async function renderRecord() {
    if (!_map) return;
    clearMarkers();
    clearPhotoMarkers();
    const { trip } = App.getState();
    if (!trip) return;

    const clusters = await API.getPhotosByLoc(trip.id);
    const bounds = new google.maps.LatLngBounds();
    let hasPoint = false;

    clusters.forEach(cluster => {
      const pos = { lat: cluster.lat, lng: cluster.lng };
      bounds.extend(pos);
      hasPoint = true;

      const div = document.createElement('div');
      div.className = 'map-photo-thumb';
      const img = document.createElement('img');
      img.src = cluster.cover;
      img.alt = '';
      div.appendChild(img);

      if (cluster.photos.length > 1) {
        const badge = document.createElement('span');
        badge.style.cssText = 'position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,.7);color:#fff;font-size:9px;padding:1px 3px;border-radius:2px;pointer-events:none';
        badge.textContent = cluster.photos.length;
        div.style.position = 'relative';
        div.appendChild(badge);
      }

      let marker;
      if (window.google.maps.marker?.AdvancedMarkerElement) {
        marker = new google.maps.marker.AdvancedMarkerElement({ position: pos, map: _map, content: div });
        marker.addEventListener('click', () => showClusterPopup(marker, cluster));
      } else {
        marker = new google.maps.Marker({ position: pos, map: _map });
        marker.addListener('click', () => showClusterPopup(marker, cluster));
      }
      _photoMarkers.push(marker);
    });

    if (hasPoint) _map.fitBounds(bounds, 80);
  }

  function showClusterPopup(marker, cluster) {
    const thumbs = cluster.photos.slice(0, 4).map(p =>
      `<img src="${p.thumbnailUrl}" style="width:54px;height:54px;object-fit:cover;border-radius:3px;cursor:pointer" onclick="App.openPhotoModal(${JSON.stringify(p).replace(/"/g, '&quot;')})" />`
    ).join('');
    _infoWindow.setContent(`
      <div class="map-popup">
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${thumbs}</div>
        ${cluster.photos[0].takenAt ? `<div class="map-popup-meta">📅 ${cluster.photos[0].takenAt.slice(0, 10)}</div>` : ''}
        <div class="map-popup-meta">${cluster.photos.length}장의 사진</div>
      </div>`);
    _infoWindow.open(_map, marker);
  }

  // ─── 경로 ─────────────────────────────────────────────────────────────
  function drawRoute(points) {
    if (_polyline) _polyline.setMap(null);
    _polyline = new google.maps.Polyline({
      path: points,
      map: _map,
      strokeColor: '#e8a020',
      strokeOpacity: .7,
      strokeWeight: 2,
      geodesic: true,
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 2, strokeColor: '#e8a020' }, repeat: '80px' }],
    });
  }

  function toggleRoute() {
    if (!_map) return;
    _showRoute = !_showRoute;
    document.getElementById('routeBtn').classList.toggle('active', _showRoute);
    renderPlan();
  }

  // ─── 주변 추천 ────────────────────────────────────────────────────────
  function toggleNearby() {
    _showNearby = !_showNearby;
    document.getElementById('nearbyBtn').classList.toggle('active', _showNearby);
    document.getElementById('nearbyPanel').style.display = _showNearby ? '' : 'none';
  }

  function searchNearby(btn) {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _activeType = btn.dataset.type;
  }

  async function runNearbySearch() {
    if (!_map) return toast('지도가 연동되지 않았습니다', 'error');
    const center = _nearbyCenter || (() => { const c = _map.getCenter(); return { lat: c.lat(), lng: c.lng() }; })();
    const keyword = document.getElementById('nearbyKeyword').value.trim();
    const results = document.getElementById('nearbyResults');
    results.innerHTML = '<div class="nearby-loading">🔍 검색 중...</div>';

    clearNearbyMarkers();

    try {
      const places = await API.getNearby(center.lat, center.lng, _activeType, keyword);
      if (!places.length) { results.innerHTML = '<div class="nearby-loading">결과 없음</div>'; return; }

      results.innerHTML = places.map((p, i) => `
        <div class="nearby-item" onmouseenter="Map.highlightNearby(${i})" onclick="Map.panToNearby(${i})">
          ${p.photoUrl ? `<img class="nearby-item-img" src="${p.photoUrl}" />` : '<div class="nearby-item-img"></div>'}
          <div class="nearby-item-body">
            <div class="nearby-item-name">${p.name}</div>
            ${p.aiComment ? `<div class="nearby-item-comment">${p.aiComment}</div>` : ''}
            <div class="nearby-item-meta">⭐ ${p.rating || '-'} · ${p.address || ''}</div>
          </div>
          <button class="nearby-item-add" onclick="event.stopPropagation(); Plan.addFromNearby(${JSON.stringify(p).replace(/"/g, '&quot;')})">＋ 추가</button>
        </div>`).join('');

      // 지도에 마커 표시
      places.forEach((p, i) => {
        const marker = new google.maps.Marker({
          position: { lat: p.lat, lng: p.lng }, map: _map,
          label: { text: String(i + 1), color: '#000', fontSize: '10px', fontWeight: '700' },
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: '#fff', fillOpacity: .9, strokeColor: '#e8a020', strokeWeight: 2 },
          title: p.name,
        });
        marker.addListener('click', () => {
          _infoWindow.setContent(`<div class="map-popup"><div class="map-popup-title">${p.name}</div><div class="map-popup-meta">⭐ ${p.rating || '-'} · ${p.address || ''}</div>${p.aiComment ? `<div class="map-popup-meta" style="color:#e8a020">${p.aiComment}</div>` : ''}<button class="map-popup-btn" onclick="Plan.addFromNearby(${JSON.stringify(p).replace(/"/g, '&quot;')})">＋ 일정 추가</button></div>`);
          _infoWindow.open(_map, marker);
        });
        _nearbyMarkers.push({ marker, place: p });
      });
    } catch (e) {
      results.innerHTML = `<div class="nearby-loading">오류: ${e.message}</div>`;
    }
  }

  function highlightNearby(i) {
    const m = _nearbyMarkers[i];
    if (m) m.marker.setAnimation(google.maps.Animation.BOUNCE);
    setTimeout(() => _nearbyMarkers.forEach(x => x.marker.setAnimation(null)), 800);
  }

  function panToNearby(i) {
    const m = _nearbyMarkers[i];
    if (m) { _map.panTo(m.marker.getPosition()); _map.setZoom(16); }
  }

  // ─── 장소 검색 ────────────────────────────────────────────────────────
  function searchPlace() {
    // Autocomplete이 처리하므로 별도 구현 불필요
  }

  // ─── 내 위치 ──────────────────────────────────────────────────────────
  function gotoMyLocation() {
    if (!_map) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        _map.panTo(c); _map.setZoom(15); _nearbyCenter = c;
      },
      () => toast('위치 정보를 가져올 수 없습니다', 'error')
    );
  }

  // ─── 정리 ─────────────────────────────────────────────────────────────
  function clearMarkers() {
    _markers.forEach(m => { try { m.map = null; } catch { m.setMap(null); } });
    _markers = [];
    if (_polyline) { _polyline.setMap(null); _polyline = null; }
    _infoWindow.close();
  }
  function clearPhotoMarkers() {
    _photoMarkers.forEach(m => { try { m.map = null; } catch { m.setMap(null); } });
    _photoMarkers = [];
  }
  function clearNearbyMarkers() {
    _nearbyMarkers.forEach(({ marker }) => { try { marker.setMap(null); } catch {} });
    _nearbyMarkers = [];
  }
  function clear() { clearMarkers(); clearPhotoMarkers(); clearNearbyMarkers(); }

  // ─── 외부에서 호출: 특정 장소로 이동 ─────────────────────────────────
  function panTo(lat, lng, zoom = 15) {
    if (!_map || !lat || !lng) return;
    _map.panTo({ lat, lng }); if (zoom) _map.setZoom(zoom);
  }

  function getCenter() {
    const c = _map.getCenter(); return { lat: c.lat(), lng: c.lng() };
  }

  return { init, renderPlan, renderRecord, clear, toggleRoute, toggleNearby, searchNearby, runNearbySearch, highlightNearby, panToNearby, searchPlace, gotoMyLocation, panTo, getCenter };
})();

// ─── Dark Map Style ───────────────────────────────────────────────────────────
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0a1628' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8899aa' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a1628' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e3a5f' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8899aa' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d2137' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#112236' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0d2a1a' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#112236' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#1e3a5f' }] },
];