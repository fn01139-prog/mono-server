/**
 * projects/location/share-routes.js
 * 공유 링크 — GET /location/s/:token (로그인 불필요, 토큰 자체가 비밀키)
 *
 * loader.mount()의 로그인 가드 밖에서 접근해야 하므로 app.js에서 loader.mount()보다 먼저
 * `app.use('/location', require('./projects/location/share-routes'))`로 마운트한다.
 * 이 라우터가 처리하지 않는 경로는 그대로 다음 미들웨어(로그인 가드가 걸린 location 앱)로 넘어간다.
 */
'use strict';

const express = require('express');
const plans   = require('./lib/plans');
const { renderSharePage, renderNotFound } = require('./lib/view');

const router = express.Router();

router.get('/s/:token', async (req, res, next) => {
  try {
    res.set({
      'Cache-Control':   'no-store',
      'X-Robots-Tag':    'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    });
    // 형식이 안 맞는 토큰은 DB 조회 없이 바로 404
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(req.params.token)) return res.status(404).type('html').send(renderNotFound());
    const plan = await plans.getPlanByToken(req.params.token);
    if (!plan) return res.status(404).type('html').send(renderNotFound());
    res.type('html').send(renderSharePage(plan));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
