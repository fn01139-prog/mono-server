/**
 * projects/location/mcp-routes.js
 * 원격 MCP 서버 (Streamable HTTP, stateless) — POST /location/mcp
 *
 * scripts/mdboard-mcp-server.js는 stdio라 Claude Desktop/Code 전용이다. 스마트폰 Claude 앱에서
 * 음성으로 일정을 등록하려면 앱이 직접 접속할 수 있는 원격 MCP 엔드포인트가 필요해서
 * mono-server 안에 라우트로 얹었다 (별도 Railway 서비스 불필요).
 *
 * - stateless: 요청마다 서버/트랜스포트를 새로 만든다. 세션을 메모리에 들고 있지 않으므로
 *   Railway 재배포/재시작이 있어도 "invalid session" 오류가 나지 않는다.
 * - 인증: LOCATION_API_KEY (lib/apikey.js). 미설정이면 503으로 거부.
 * - express.json()은 app.js에서 이미 전역 적용되어 req.body가 파싱된 상태다.
 * - app.js에서 loader.mount()보다 먼저 `app.use('/location/mcp', ...)`로 마운트한다.
 */
'use strict';

const express = require('express');
const { z }   = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const plans = require('./lib/plans');
const { requireApiKey, baseUrl } = require('./lib/apikey');

const router = express.Router();

const INSTRUCTIONS = [
  '사용자가 음성으로 부른 "시간별 위치 일정"을 등록/조회/수정하는 서버입니다.',
  '권장 흐름: (1) 발화에서 날짜(YYYY-MM-DD)·시간(HH:MM 24시간)·장소·메모를 JSON으로 파싱한다.',
  '(2) 등록하기 전에 파싱 결과를 시간순 표로 사용자에게 보여 주고 확인을 받는다 (음성 인식 오류 방지).',
  '(3) "집", "사무실"처럼 자주 쓰는 장소는 location_get_favorite로 좌표를 확인한다 — 등록(location_register_plan) 시 서버가 즐겨찾기 이름과 정확히 같은 장소의 좌표를 자동으로 채운다.',
  '(4) 좌표는 "강남 스타벅스"처럼 지점이 여러 곳일 수 있는 애매한 장소에만 장소 검색으로 확인하고, 나머지는 장소 이름만 저장해도 된다.',
  '(5) 등록이 끝나면 반환된 공유 링크를 사용자에게 전달한다. 사용자가 링크를 열어 확인한 뒤 직접 문자/카톡으로 공유한다 (자동 발송 아님).',
].join('\n');

const timeSchema  = z.string().describe('HH:MM (24시간). 예: "09:00", "13:30"');
const dateSchema  = z.string().describe('YYYY-MM-DD');
const entryShape = {
  time:  timeSchema,
  place: z.string().describe('장소 이름'),
  note:  z.string().optional().describe('메모/내용 (선택)'),
  lat:   z.number().optional().describe('위도 (선택)'),
  lng:   z.number().optional().describe('경도 (선택)'),
};

function fmtPlan(base, plan) {
  const lines = plan.entries.map((e) =>
    `#${e.id} ${e.time} ${e.place}${e.note ? ` (${e.note})` : ''}${e.lat != null ? ' 📍' : ''}`);
  return `${plan.date}\n${lines.join('\n') || '(항목 없음)'}\n\n공유 링크: ${base}${plans.sharePath(plan.shareToken)}`;
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const err  = (e) => ({ content: [{ type: 'text', text: `❌ ${e.message}` }], isError: true });

function buildServer(req) {
  const base = baseUrl(req);
  const server = new McpServer({ name: 'location', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  // 모든 툴 공통: 소유자 결정 + 에러 포맷
  const tool = (name, def, fn) => server.registerTool(name, def, async (args) => {
    try {
      const ownerId = await plans.getApiOwnerId();
      if (!ownerId) throw new Error('소유자 계정을 찾을 수 없습니다. (admin 부트스트랩 또는 LOCATION_OWNER_ID 확인)');
      return text(await fn(ownerId, args));
    } catch (e) {
      if (!(e instanceof plans.ValidationError)) console.error(`[location/mcp] ${name}`, e);
      return err(e);
    }
  });

  tool('location_register_plan', {
    title: '하루 위치 일정 등록(통째로 교체)',
    description: '특정 날짜의 시간별 위치 일정을 등록한다. 그 날짜에 이미 일정이 있으면 전부 교체된다. ' +
      '등록 전에 사용자에게 파싱 결과를 확인받을 것. 같은 날짜는 항상 같은 공유 링크가 유지된다.',
    inputSchema: { date: dateSchema, entries: z.array(z.object(entryShape)).min(1).describe('시간·장소·메모 목록 (순서 무관, 서버가 시간순 정렬)') },
  }, async (ownerId, { date, entries }) => {
    const plan = await plans.replacePlan(ownerId, date, entries);
    return `✅ ${plan.entries.length}건 등록\n${fmtPlan(base, plan)}`;
  });

  tool('location_add_entry', {
    title: '일정 1건 추가',
    description: '기존 일정은 그대로 두고 항목 1건만 추가한다. ("참고로 4시에 병원도 넣어줘")',
    inputSchema: { date: dateSchema, ...entryShape },
  }, async (ownerId, { date, ...entry }) => `✅ 추가됨\n${fmtPlan(base, await plans.addEntry(ownerId, date, entry))}`);

  tool('location_get_plan', {
    title: '일정 조회',
    description: '특정 날짜의 등록된 일정과 공유 링크를 조회한다. 수정/삭제 전에 항목 id를 확인할 때도 쓴다.',
    inputSchema: { date: dateSchema },
  }, async (ownerId, { date }) => {
    const plan = await plans.getPlan(ownerId, date);
    return plan ? fmtPlan(base, plan) : `${date}에 등록된 일정이 없습니다.`;
  });

  tool('location_update_entry', {
    title: '일정 항목 수정',
    description: '항목 1건의 시간/장소/메모/좌표를 수정한다. 항목 id는 location_get_plan으로 확인.',
    inputSchema: {
      id: z.number().describe('항목 id (#뒤의 숫자)'),
      time: timeSchema.optional(), place: z.string().optional(), note: z.string().nullable().optional(),
      lat: z.number().optional(), lng: z.number().optional(),
    },
  }, async (ownerId, { id, ...fields }) =>
    (await plans.updateEntry(ownerId, id, fields)) ? '✅ 수정됨' : '해당 id의 항목을 찾을 수 없습니다.');

  tool('location_delete_entry', {
    title: '일정 항목 삭제',
    description: '항목 1건을 삭제한다. 항목 id는 location_get_plan으로 확인.',
    inputSchema: { id: z.number() },
  }, async (ownerId, { id }) => (await plans.deleteEntry(ownerId, id)) ? '✅ 삭제됨' : '해당 id의 항목을 찾을 수 없습니다.');

  tool('location_get_favorite', {
    title: '즐겨찾는 장소 조회',
    description: '"집", "사무실" 같은 자주 쓰는 장소의 저장된 좌표를 조회한다. 없으면 장소 검색이 필요하다.',
    inputSchema: { name: z.string() },
  }, async (ownerId, { name }) => {
    const f = await plans.getFavorite(ownerId, name);
    return f ? `${f.name}: ${f.lat}, ${f.lng}${f.address ? ` (${f.address})` : ''}` : `"${name}" 좌표가 저장되어 있지 않습니다.`;
  });

  tool('location_set_favorite', {
    title: '즐겨찾는 장소 저장',
    description: '자주 쓰는 장소의 좌표를 저장/갱신한다. 이후 같은 이름으로 등록하면 좌표가 자동으로 채워진다.',
    inputSchema: { name: z.string(), lat: z.number(), lng: z.number(), address: z.string().optional() },
  }, async (ownerId, { name, ...rest }) => { await plans.setFavorite(ownerId, name, rest); return `✅ "${name}" 저장됨`; });

  return server;
}

router.post('/', requireApiKey, async (req, res) => {
  const server = buildServer(req);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[location/mcp]', e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

// stateless 서버는 SSE 스트림/세션 종료를 지원하지 않는다
const notAllowed = (req, res) => res.status(405).set('Allow', 'POST')
  .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
router.get('/', notAllowed);
router.delete('/', notAllowed);

module.exports = router;
