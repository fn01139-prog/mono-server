#!/usr/bin/env node
/**
 * mdboard-mcp-server.js — mdboard 콘텐츠 퍼블리시용 MCP 서버 (stdio)
 *
 * Claude Desktop 등 MCP를 지원하는 클라이언트에 이 스크립트를 서버로 등록하면,
 * 대화 중 정리한 마크다운/HTML 콘텐츠를 별도의 CLI 실행이나 파일시스템 접근 없이
 * 바로 mdboard에 올릴 수 있다. 기존 scripts/mdboard-push.js(CLI)와 같은
 * /mdboard/api/publish, /publish-html REST API(x-api-key 인증)를 호출하는
 * 얇은 클라이언트일 뿐, 이 서버 자체는 상태를 갖지 않는다.
 *
 * 설정 (Claude Desktop claude_desktop_config.json 예시):
 *   {
 *     "mcpServers": {
 *       "mdboard": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/mono-server/scripts/mdboard-mcp-server.js"],
 *         "env": {
 *           "MDBOARD_URL": "https://fn0113.up.railway.app",
 *           "MDBOARD_API_KEY": "your_api_key_here"
 *         }
 *       }
 *     }
 *   }
 *
 * Claude Code에서는 .mcp.json에 동일한 형태로 등록하거나
 * `claude mcp add mdboard -- node scripts/mdboard-mcp-server.js` 사용.
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const BASE_URL = (process.env.MDBOARD_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY  = process.env.MDBOARD_API_KEY || '';

if (!API_KEY) {
  console.error('[mdboard-mcp] MDBOARD_API_KEY 환경변수가 설정되지 않았습니다. MCP 클라이언트 설정의 env에 추가하세요.');
  process.exit(1);
}

async function callPublishApi(path, options = {}) {
  const res = await fetch(`${BASE_URL}/mdboard/api${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`서버 응답을 해석할 수 없습니다 (HTTP ${res.status})`);
  }
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `요청이 실패했습니다 (HTTP ${res.status})`);
  }
  return json;
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResult(err) {
  return { content: [{ type: 'text', text: `❌ ${err.message}` }], isError: true };
}

const server = new McpServer({ name: 'mdboard', version: '1.0.0' });

server.registerTool(
  'mdboard_publish_markdown',
  {
    title: 'mdboard에 마크다운 등록',
    description:
      '정리된 마크다운 콘텐츠를 mdboard 문서 플랫폼에 바로 등록한다. 블로그 초안이나 대화 중 정리한 내용을 ' +
      '별도 파일 저장 없이 즉시 반영할 때 사용한다. 같은 파일명이 이미 있으면 overwrite=true 없이는 실패한다.',
    inputSchema: {
      title: z.string().describe('파일명 (예: "claude-api-정리.md"). ".md" 확장자는 없으면 자동으로 붙는다.'),
      content: z.string().describe('마크다운 본문 전체'),
      folder: z.string().optional().describe('저장할 폴더명. 생략하면 기본(루트) 폴더에 저장된다.'),
      overwrite: z.boolean().optional().describe('동일 경로에 파일이 이미 있을 때 덮어쓸지 여부 (기본 false)'),
    },
  },
  async ({ title, content, folder, overwrite }) => {
    try {
      const json = await callPublishApi('/publish', { method: 'POST', body: { title, content, folder, overwrite } });
      return textResult(`✅ mdboard에 등록되었습니다.\n경로: ${json.path}\nURL: ${BASE_URL}${json.url}`);
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'mdboard_publish_html',
  {
    title: 'mdboard에 HTML 등록',
    description:
      'HTML 문서를 mdboard에 바로 등록한다. HTML 파일은 mdboard 콘텐츠 루트에만 저장되며(서브폴더 없음), ' +
      '사이드바의 별도 HTML 섹션에 표시되고 샌드박스 iframe 뷰어로 열람된다.',
    inputSchema: {
      title: z.string().describe('파일명 (예: "landing-page.html"). ".html" 확장자는 없으면 자동으로 붙는다.'),
      content: z.string().describe('HTML 문서 전체 내용'),
      overwrite: z.boolean().optional().describe('동일 파일명이 이미 있을 때 덮어쓸지 여부 (기본 false)'),
    },
  },
  async ({ title, content, overwrite }) => {
    try {
      const json = await callPublishApi('/publish-html', { method: 'POST', body: { title, content, overwrite } });
      return textResult(`✅ mdboard에 HTML로 등록되었습니다.\n파일명: ${json.title}\nURL: ${BASE_URL}${json.url}`);
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'mdboard_list_folders',
  {
    title: 'mdboard 폴더 목록 조회',
    description: 'mdboard에 이미 존재하는 폴더 목록을 조회한다. 마크다운을 등록할 폴더를 고를 때 사용한다.',
    inputSchema: {},
  },
  async () => {
    try {
      const json = await callPublishApi('/publish/folders');
      return textResult(json.folders.length ? json.folders.join('\n') : '(등록된 폴더가 없습니다 — 기본 폴더에 저장됩니다.)');
    } catch (err) {
      return errorResult(err);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mdboard-mcp] ready — target: ${BASE_URL}`);
}

main().catch((err) => {
  console.error('[mdboard-mcp] fatal error:', err);
  process.exit(1);
});
