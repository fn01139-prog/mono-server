/**
 * projects/location/lib/view.js
 * 공유 링크(/location/s/:token)에 내려줄 서버 렌더링 HTML.
 * 받는 사람은 로그인 없이 읽기만 한다. 사용자 입력은 전부 escape 처리한다.
 */
'use strict';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 'YYYY-MM-DD' → '2026년 9월 28일 (월)' — 타임존 영향이 없도록 UTC 기준으로 계산 */
function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}년 ${m}월 ${d}일 (${DAYS[dow]})`;
}

function shareText(plan) {
  const lines = [`📅 ${dateLabel(plan.date)} 위치 일정`, ''];
  if (!plan.entries.length) lines.push('(등록된 일정 없음)');
  for (const e of plan.entries) lines.push(`${e.time} - ${e.place}${e.note ? ` (${e.note})` : ''}`);
  return lines.join('\n');
}

function mapLink(e) {
  if (e.lat == null || e.lng == null) return '';
  const name = encodeURIComponent(String(e.place).replace(/,/g, ' '));
  return `<a class="map" href="https://map.kakao.com/link/map/${name},${e.lat},${e.lng}" target="_blank" rel="noopener noreferrer">지도에서 보기</a>`;
}

function renderSharePage(plan) {
  const label = dateLabel(plan.date);
  const items = plan.entries.length
    ? plan.entries.map((e) => `
      <li class="entry">
        <div class="time">${esc(e.time)}</div>
        <div class="place">${esc(e.place)}</div>
        ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
        ${mapLink(e)}
      </li>`).join('')
    : '<li class="empty">아직 등록된 일정이 없어요.</li>';

  // <script> 안에 JSON을 넣을 때 '<'를 이스케이프해서 </script> 삽입을 막는다
  const textJson = JSON.stringify(shareText(plan)).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(label)} 위치 일정</title>
<style>
  :root { --bg:#FAFAF7; --card:#fff; --ink:#1C1E21; --soft:#5B5F66; --line:#DADDE3; --accent:#2452B8; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#17181A; --card:#1F2023; --ink:#F2F2F0; --soft:#9A9EA6; --line:#33353A; --accent:#7FA3F5; }
  }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--bg); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif; }
  body { padding:24px 16px 48px; padding-top:calc(24px + env(safe-area-inset-top,0px));
    padding-bottom:calc(48px + env(safe-area-inset-bottom,0px)); }
  main { max-width:480px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 22px; }
  ul { list-style:none; margin:0 0 26px; padding:0 0 0 20px; position:relative; }
  ul::before { content:""; position:absolute; left:5px; top:8px; bottom:8px; width:2px; background:var(--line); }
  .entry { position:relative; background:var(--card); border:1px solid var(--line); border-radius:10px;
    padding:12px 14px; margin-bottom:10px; }
  .entry::before { content:""; position:absolute; left:-20px; top:18px; width:10px; height:10px;
    border-radius:50%; background:var(--accent); border:2px solid var(--bg); }
  .time { font-size:12px; font-weight:600; color:var(--soft); margin-bottom:3px; }
  .place { font-size:15px; font-weight:600; }
  .note { font-size:13px; color:var(--soft); margin-top:2px; }
  .map { display:inline-block; margin-top:6px; font-size:12px; color:var(--accent); text-decoration:none; }
  .empty { color:var(--soft); font-size:14px; }
  .actions { display:flex; flex-direction:column; gap:8px; }
  button { padding:13px; border-radius:10px; font-size:15px; font-weight:600; cursor:pointer;
    border:1px solid var(--line); background:var(--card); color:var(--ink); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  #status { min-height:18px; margin-top:10px; text-align:center; font-size:13px; color:var(--accent); }
</style>
</head>
<body>
<main>
  <h1>📍 ${esc(label)} 위치 일정</h1>
  <ul>${items}</ul>
  <div class="actions">
    <button id="shareBtn" class="primary" type="button">공유하기 (문자 · 카카오톡 등)</button>
    <button id="copyBtn" type="button">텍스트 + 링크 복사</button>
  </div>
  <p id="status" role="status"></p>
</main>
<script>
  var text = ${textJson};
  var st = document.getElementById('status');
  function say(m) { st.textContent = m; setTimeout(function () { st.textContent = ''; }, 2500); }
  document.getElementById('shareBtn').onclick = function () {
    if (navigator.share) navigator.share({ title: '위치 일정', text: text, url: location.href }).catch(function () {});
    else say('이 브라우저는 공유를 지원하지 않아요. 복사 버튼을 이용해 주세요.');
  };
  document.getElementById('copyBtn').onclick = function () {
    if (!navigator.clipboard) return say('복사를 지원하지 않는 브라우저예요.');
    navigator.clipboard.writeText(text + '\\n' + location.href).then(function () { say('복사했어요.'); },
      function () { say('복사에 실패했어요.'); });
  };
</script>
</body>
</html>`;
}

function renderNotFound() {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>링크를 찾을 수 없어요</title></head>
<body style="font-family:sans-serif;padding:40px 20px;text-align:center;color:#555">
<p>링크를 찾을 수 없거나 삭제된 일정이에요.</p></body></html>`;
}

module.exports = { renderSharePage, renderNotFound, shareText, dateLabel };
