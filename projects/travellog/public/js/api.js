/**
 * api.js - 백엔드 API 호출 모음
 */
const BASE = '/travellog/api';

const API = {
  async _fetch(method, path, body) {
    const opts = { method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(BASE + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  // Config
  config: ()           => API._fetch('GET', '/config'),

  // Sync
  sync:     ()         => API._fetch('GET',  '/sync'),
  syncPush: ()         => API._fetch('POST', '/sync/push'),

  // Trips
  getTrips:    ()      => API._fetch('GET',    '/trips'),
  createTrip:  (d)     => API._fetch('POST',   '/trips', d),
  updateTrip:  (id, d) => API._fetch('PUT',    `/trips/${id}`, d),
  deleteTrip:  (id)    => API._fetch('DELETE', `/trips/${id}`),

  // Schedules
  getSchedules:   (tripId) => API._fetch('GET',    `/schedules?tripId=${tripId}`),
  createSchedule: (d)      => API._fetch('POST',   '/schedules', d),
  updateSchedule: (id, d)  => API._fetch('PUT',    `/schedules/${id}`, d),
  deleteSchedule: (id)     => API._fetch('DELETE', `/schedules/${id}`),
  reorderSchedules: (tripId, ids) => API._fetch('POST', '/schedules/reorder', { tripId, orderedIds: ids }),

  // Records
  getRecords:   (tripId) => API._fetch('GET',    `/records?tripId=${tripId}`),
  createRecord: (d)      => API._fetch('POST',   '/records', d),
  updateRecord: (id, d)  => API._fetch('PUT',    `/records/${id}`, d),
  deleteRecord: (id)     => API._fetch('DELETE', `/records/${id}`),

  // Photos
  getPhotos:      (tripId) => API._fetch('GET', `/photos?tripId=${tripId}`),
  getPhotosByLoc: (tripId) => API._fetch('GET', `/photos/by-location?tripId=${tripId}`),

  // Places
  getNearby: (lat, lng, type, keyword = '') =>
    API._fetch('GET', `/places/nearby?lat=${lat}&lng=${lng}&type=${encodeURIComponent(type)}&keyword=${encodeURIComponent(keyword)}`),

  // Photo upload (multipart)
  uploadPhotos: async (files, tripId, metaList) => {
    const fd = new FormData();
    files.forEach(f => fd.append('photos', f));
    fd.append('tripId', tripId || '');
    fd.append('metaJson', JSON.stringify(metaList || []));
    const res = await fetch(`${BASE}/photos/upload`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
};
