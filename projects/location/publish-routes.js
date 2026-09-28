/**
 * projects/location/publish-routes.js
 * x-api-key 전용 programmatic API (curl 점검 / 스크립트용). MCP 툴과 같은 lib/plans.js를 쓴다.
 *
 * app.js에서 `app.use('/location/api', require('./projects/location/publish-routes'))`로
 * loader.mount()보다 먼저 마운트한다. 이 라우터는 /location/api 전체를 가로채므로
 * requireApiKey는 절대 router.use()로 전역 적용하지 말고 각 라우트에 개별로 붙인다
 * (mdboard/publish-routes.js와 동일한 주의사항 — 안 그러면 로그인 사용자의 /plans 등이 막힌다).
 */
'use strict';

const express = require('express');
const plans   = require('./lib/plans');
const { requireApiKey, baseUrl } = require('./lib/apikey');

const router = express.Router();

function payload(req, plan) {
  return { date: plan.date, url: baseUrl(req) + plans.sharePath(plan.shareToken), entries: plan.entries };
}

async function withOwner(res, fn) {
  try {
    const ownerId = await plans.getApiOwnerId();
    if (!ownerId) return res.status(500).json({ success: false, error: '소유자 계정을 찾을 수 없습니다. (admin 부트스트랩 또는 LOCATION_OWNER_ID 확인)' });
    await fn(ownerId);
  } catch (e) {
    if (e instanceof plans.ValidationError) return res.status(400).json({ success: false, error: e.message });
    console.error('[location/publish]', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

/* POST /location/api/publish  { date, entries:[{time,place,note?,lat?,lng?}] } — 하루 일정 통째로 등록/교체 */
router.post('/publish', requireApiKey, (req, res) => withOwner(res, async (ownerId) => {
  const plan = await plans.replacePlan(ownerId, req.body.date, req.body.entries);
  res.json({ success: true, ...payload(req, plan) });
}));

/* GET /location/api/publish/:date — 조회 */
router.get('/publish/:date', requireApiKey, (req, res) => withOwner(res, async (ownerId) => {
  const plan = await plans.getPlan(ownerId, req.params.date);
  if (!plan) return res.status(404).json({ success: false, error: '해당 날짜의 일정이 없습니다.' });
  res.json({ success: true, ...payload(req, plan) });
}));

module.exports = router;
