/**
 * projects/location/index.js
 * → /location/api/* 로 마운트됨 (loader.js가 requireLogin + requireApp('/location') 가드를 자동 삽입)
 * 데이터 저장소: PostgreSQL (location_plans / location_entries / location_favorites)
 * 격리: owner_id 기준 본인 데이터만 (req.user.userId)
 *
 * 주의: 라우트 경로에 '/api/' 접두사를 붙이지 않는다 (loader.js가 이미 /location/api 에 마운트).
 * 로그인 없이 접근하는 진입점(공유 페이지 / x-api-key / MCP)은 app.js에서 별도로 마운트한다.
 */
'use strict';

const express = require('express');
const { asyncHandler, ok, fail } = require('../../shared/utils');
const plans = require('./lib/plans');

const router = express.Router();
const owner = (req) => req.user.userId;

/** ValidationError → 400, 그 외는 전역 에러 핸들러로 */
const h = (fn) => asyncHandler(async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof plans.ValidationError) return fail(res, e.message, 400);
    throw e;
  }
});

const withUrl = (req, plan) => plan && ({ ...plan, sharePath: plans.sharePath(plan.shareToken) });

router.get('/health', (req, res) => ok(res, { status: 'ok', project: 'location', time: new Date() }));

/* ── 일정 ─────────────────────────────────────────────────────────────── */
router.get('/plans', h(async (req, res) => {
  const list = await plans.listPlans(owner(req), { limit: req.query.limit });
  ok(res, list.map((p) => ({ ...p, sharePath: plans.sharePath(p.shareToken) })));
}));

router.get('/plans/:date', h(async (req, res) => {
  const plan = await plans.getPlan(owner(req), req.params.date);
  if (!plan) return fail(res, '해당 날짜의 일정이 없습니다.', 404);
  ok(res, withUrl(req, plan));
}));

router.put('/plans/:date', h(async (req, res) => {
  ok(res, withUrl(req, await plans.replacePlan(owner(req), req.params.date, req.body.entries)));
}));

router.delete('/plans/:date', h(async (req, res) => {
  if (!await plans.deletePlan(owner(req), req.params.date)) return fail(res, '해당 날짜의 일정이 없습니다.', 404);
  ok(res, { deleted: true });
}));

router.post('/plans/:date/entries', h(async (req, res) => {
  ok(res, withUrl(req, await plans.addEntry(owner(req), req.params.date, req.body)), 201);
}));

router.patch('/entries/:id', h(async (req, res) => {
  if (!await plans.updateEntry(owner(req), req.params.id, req.body)) return fail(res, '항목을 찾을 수 없습니다.', 404);
  ok(res, { updated: true });
}));

router.delete('/entries/:id', h(async (req, res) => {
  if (!await plans.deleteEntry(owner(req), req.params.id)) return fail(res, '항목을 찾을 수 없습니다.', 404);
  ok(res, { deleted: true });
}));

/* ── 즐겨찾는 장소 ("집", "사무실" 좌표) ──────────────────────────────── */
router.get('/favorites', h(async (req, res) => ok(res, await plans.listFavorites(owner(req)))));

router.put('/favorites/:name', h(async (req, res) => {
  await plans.setFavorite(owner(req), req.params.name, req.body);
  ok(res, { saved: true });
}));

router.delete('/favorites/:name', h(async (req, res) => {
  if (!await plans.deleteFavorite(owner(req), req.params.name)) return fail(res, '장소를 찾을 수 없습니다.', 404);
  ok(res, { deleted: true });
}));

module.exports = router;
