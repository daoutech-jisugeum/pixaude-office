/* WebSocket 스토어 + 출근 관리/확인할 것 패널 + 모달. 맵은 game.js가 window.Office 이벤트를 구독한다. */
(function () {
  const Office = window.Office = {
    employees: {}, templates: [], meetings: {}, listeners: {}, ws: null, near: null, unread: 0, usage: {}, rateLimits: {},
    on(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    emit(ev, p) { (this.listeners[ev] || []).forEach(fn => { try { fn(p); } catch (e) { console.error(e); } }); },
    send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); },
    say(id, text, mode, attachments) { this.send({ cmd: 'say', employee: id, text, mode: mode || 'auto', attachments: attachments || [] }); },
    present(id) { const e = this.employees[id]; return !!e && e.status !== 'away' && e.status !== 'starting'; },
    modelOf(e) { return (e.live && e.live.model) || (e.ctx && e.ctx.model) || e.model_actual || e.model || '기본'; },
  };

  const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
  /* 설치 토큰: /api/* 요청엔 헤더로, 웹소켓엔 ?t= 로 (다른 웹사이트가 이 서버를 못 건드리게) */
  const api = (u, o) => fetch(u, Object.assign({}, o, { headers: Object.assign({ 'X-Office-Token': window.OFFICE_TOKEN }, (o || {}).headers) })).then(r => r.json());   // /api/* 는 설치 토큰 필수
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = iso => { const d = iso ? new Date(iso) : new Date(); return d.toTimeString().slice(0, 5); };
  const STATUS_KO = { away: '퇴근', starting: '출근 중', idle: '대기', working: '작업 중', needs_input: '입력 대기', meeting: '회의', done: '완료', error: '오류' };
  const statusKo = s => STATUS_KO[s] || s;
  const fmtTok = n => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
  const name = id => (Office.employees[id] || {}).name || id;
  /* 팀 색: company.yaml 순서대로 고정 팔레트. 게시판 카드·출근 관리 행의 왼쪽 띠 */
  const TEAM_COLORS = ['#7ea4f2', '#f2a65a', '#6ad48b', '#e27bd6', '#f0d35a', '#5ad4d4', '#f27e7e', '#b58cff', '#9ab86a'];
  const teamOf = id => { const e = Office.employees[id]; return e ? e.template : String(id).replace(/_\d+$/, ''); };
  const teamColor = tid => { const i = Office.templates.findIndex(t => t.id === tid); return TEAM_COLORS[(i < 0 ? 0 : i) % TEAM_COLORS.length]; };
  Office.teamColor = tid => teamColor(tid);   // 맵 캐릭터 옷 색
  const lvl = (pct, warn, crit) => pct >= crit ? ' crit' : pct >= warn ? ' warn' : '';   // 게이지 색 등급
  /* 모달 공통: 열 때 시각을 기록해 연 직후 400ms 의 배경 클릭은 무시 (pointerdown 으로 열리고 click 이 배경에 떨어지는 문제) */
  function makeModal(box, onClose) {
    const close = () => { if (box.hidden) return; box.hidden = true; if (onClose) onClose(); Office.emit('focus-input', false); };
    box.addEventListener('click', e => { if (e.target === box && Date.now() - (+box.dataset.t || 0) > 400) close(); });
    makeDraggable(box);
    return { open() { box.hidden = false; box.dataset.t = Date.now(); Office.emit('focus-input', true); }, close };
  }
  /* 모달 끌어 옮기기: 머리글(.head)을 잡고 드래그, 위치는 모달별로 기억, 머리글 더블클릭 = 가운데로 */
  function makeDraggable(modal) {
    const box = modal.querySelector('.box'), head = modal.querySelector('.head'); if (!box || !head || box.dataset.drag) return; box.dataset.drag = '1';
    const key = 'office.pos.' + modal.id;
    const apply = pos => { if (!pos) { box.style.transform = ''; box.classList.remove('moved'); return; } box.style.transform = `translate(${pos.x}px, ${pos.y}px)`; box.classList.add('moved'); };
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); if (saved) apply(saved); } catch (e) {}
    let drag = null;
    head.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button, select, input, a, .tabs')) return;
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(box.style.transform) || [0, 0, 0];
      drag = { sx: e.clientX, sy: e.clientY, ox: +m[1], oy: +m[2] }; head.setPointerCapture(e.pointerId); e.preventDefault();
    });
    head.addEventListener('pointermove', e => { if (!drag) return; apply({ x: drag.ox + e.clientX - drag.sx, y: drag.oy + e.clientY - drag.sy }); });
    const end = e => { if (!drag) return; drag = null; const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(box.style.transform); try { if (m) localStorage.setItem(key, JSON.stringify({ x: +m[1], y: +m[2] })); } catch (err) {} };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', e => { if (e.target.closest('button, select, input, a, .tabs')) return; apply(null); try { localStorage.removeItem(key); } catch (err) {} });
  }
  makeDraggable($('#modal'));   // 대화 모달은 makeModal 을 안 쓰므로 따로
  (function makeResizable(modal) {   // 대화 모달 크기 조절(CSS resize). 크기는 기억하고, 창보다 커지지 않게 자른다
    const box = modal.querySelector('.box'); if (!box) return;
    const key = 'office.size.' + modal.id;
    const clamp = (w, h) => [Math.min(w, window.innerWidth - 16), Math.min(h, window.innerHeight - 16)];
    const apply = sz => { if (!sz) { box.style.width = ''; box.style.height = ''; return; } const [w, h] = clamp(sz.w, sz.h); box.style.width = w + 'px'; box.style.height = h + 'px'; };
    try { apply(JSON.parse(localStorage.getItem(key) || 'null')); } catch (e) {}
    let t; new ResizeObserver(() => { if (!box.style.width) return; clearTimeout(t); t = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify({ w: box.offsetWidth, h: box.offsetHeight })); } catch (e) {} }, 200); }).observe(box);
    window.addEventListener('resize', () => { if (box.style.width) apply({ w: box.offsetWidth, h: box.offsetHeight }); });
    modal.querySelector('.head').addEventListener('dblclick', e => { if (e.target.closest('button, select, input, a, .tabs')) return; apply(null); try { localStorage.removeItem(key); } catch (err) {} });   // 더블클릭 = 위치·크기 초기화
    // 양옆 가장자리를 끌어 너비만 조절 (모서리의 CSS resize 와 별개). 창은 가운데 정렬이라 한쪽을 dx 끌면 너비는 2dx 늘어 그 변이 커서를 따라온다
    ['l', 'r'].forEach(side => {
      const h = el('div', 'edge ' + side); h.title = '끌어서 너비 조절'; box.appendChild(h);
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); try { h.setPointerCapture(e.pointerId); } catch (err) {} box.classList.add('edging');
        const x0 = e.clientX, w0 = box.offsetWidth, h0 = box.offsetHeight;
        const move = ev => { const dx = (ev.clientX - x0) * (side === 'r' ? 2 : -2); apply({ w: Math.max(720, w0 + dx), h: h0 }); };
        const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); box.classList.remove('edging'); };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
    });
  })($('#modal'));

  /* ---------- 연결 ---------- */
  function connect() {
    const ws = Office.ws = new WebSocket(window.OFFICE_WS);
    ws.onopen = () => { $('#conn').textContent = '연결됨'; $('#conn').className = 'conn on'; };
    ws.onclose = () => { $('#conn').textContent = '끊김, 재연결…'; $('#conn').className = 'conn off'; setTimeout(connect, 2000); };
    ws.onmessage = e => { const { event, payload } = JSON.parse(e.data); handle(event, payload); };
  }

  const handlers = {
    snapshot(p) {
      Office.employees = {}; p.employees.forEach(e => Office.employees[e.id] = e); Office.templates = p.templates || [];
      Office.meetings = {}; (p.meetings || []).forEach(m => Office.meetings[m.id] = m.participants);
      Office.unread = p.unread || 0; Office.usage = p.usage || {}; Office.rateLimits = p.rate_limits || {}; Office.editor = p.editor || ''; Office.claudeTested = p.claude_tested || null; Office.pyenvs = p.pyenvs || [];
      $('#attached').textContent = p.attached ? `터미널 ${p.attached}명 attach` : '';
      if (p.weather) $('#weather').textContent = p.weather; if (p.sky) Office.emit('sky', p.sky); renderAll(); Office.emit('snapshot', p);
    },
    'employee.status'(p) {
      const e = Office.employees[p.id]; if (!e) return;
      const wasPresent = Office.present(p.id); const keepBr = e.branch; const prevSid = e.session_id; Object.assign(e, p); if (!p.branch && keepBr) e.branch = keepBr; const nowPresent = Office.present(p.id);
      if (modalFor === p.id && p.session_id && prevSid && p.session_id !== prevSid) setTimeout(() => { if (modalFor === p.id) openModal(p.id); }, 800);
      renderAll(); refreshModalHead(); refreshPlate(); Office.emit('status', p);
      if (wasPresent !== nowPresent) Office.emit('presence', { id: p.id, present: nowPresent });
    },
    'employee.add'(p) { Office.employees[p.id] = Object.assign(Office.employees[p.id] || {}, p); renderAll(); Office.emit('presence', { id: p.id, present: Office.present(p.id) }); },
    'employee.remove'(p) { delete Office.employees[p.id]; Office.emit('employee.remove', p); if (modalFor === p.id) closeModal(); if (plateFor === p.id) plateM.close(); renderAll(); Office.emit('presence', { id: p.id, present: false }); },
    'employee.activity'(p) { Office.emit('activity', p); },
    message(p) { Office.emit('message', p); if (modalFor === p.employee && p.channel !== 'system') appendChat(p); },
    report(p) { if (modalFor === p.id) setTimeout(() => { if (modalFor === p.id) openModal(p.id, true); }, 600); Office.unread = (Office.unread || 0) + 1; const e = Office.employees[p.id]; if (e) { e.unread = p.unread; e.last_report = p.text; } renderAll(); Office.emit('report', p); notify(`${name(p.id)} 보고`, p.text.slice(0, 80), p.id); beep('report'); },
    question(p) { const e = Office.employees[p.id]; if (e) { e.question = p.summary; if (p.kind === 'login') { e.pending_kind = 'login'; e.login_url = p.url || ''; if (p.url && modalFor === p.id) window.open(p.url, '_blank'); } } renderAll(); Office.emit('question', p); if (modalFor === p.id) showPending(); notify(p.kind === 'error' ? `${name(p.id)} 오류` : p.kind === 'context' ? `${name(p.id)} 컨텍스트` : `${name(p.id)} 질문`, p.summary, p.id); if (p.kind !== 'context') beep(p.kind === 'error' ? 'error' : 'ask'); },
    unread(p) { Office.unread = p.total; renderBar(); Office.emit('unread', p.total); },
    'mcp.list'(p) { if (tplEditing === p.team) renderMcp(p); },
    templates(p) { Office.templates = p.items || []; renderAll(); Office.emit('templates', p); },
    'meeting.start'(p) { Office.meetings[p.id] = p.participants; renderAll(); Office.emit('meeting.start', p); },
    'meeting.turn'(p) { Office.emit('meeting.turn', p); },
    'meeting.end'(p) { delete Office.meetings[p.id]; renderAll(); Office.emit('meeting.end', p); },
    'pantry.visit'(p) { const e = Office.employees[p.id]; if (e) e.pantry = true; Office.emit('pantry.visit', p); },
    'pantry.done'(p) { const e = Office.employees[p.id]; if (e) e.pantry = false; Office.emit('pantry.done', p); },
    tick(p) { $('#attached').textContent = p.attached ? `터미널 ${p.attached}명 attach` : ''; $('#clock').textContent = p.time; if (p.period) $('#period').textContent = p.period; if (p.weather) $('#weather').textContent = p.weather; if (p.sky) Office.emit('sky', p.sky); Office.emit('tick', p); },
    live(p) { const e = Office.employees[p.id]; if (e) { e.live = p.live || {}; if (p.ctx) e.ctx = p.ctx; else if (p.live && p.live.ctx_pct != null) e.ctx = { ctx: p.live.ctx_in, window: p.live.ctx_size, pct: p.live.ctx_pct, model: p.live.model }; e.session_cost = (p.live || {}).cost; ['effort', 'fast', 'worktree', 'version', 'lines', 'pr'].forEach(k => { if (p[k] != null) e[k] = p[k]; }); renderAttendance(); } if (p.rate_limits) Office.rateLimits = p.rate_limits; renderUsage(); refreshPlate(); Office.emit('usage', { employees: { [p.id]: { ctx: (Office.employees[p.id] || {}).ctx || {}, session: {} } } }); },
    usage(p) { if (p.rate_limits) Office.rateLimits = p.rate_limits; if (p.partial) { renderUsage(); return; } Office.usage = p.totals || {}; Object.entries(p.employees || {}).forEach(([id, u]) => { const e = Office.employees[id]; if (e) { e.ctx = u.ctx; e.session_out = u.session.out; e.session_cost = u.session.cost; if (u.model) e.model_actual = u.model; if (u.branch != null) e.branch = u.branch; if (u.pr) e.pr = u.pr; if (u.ports) e.ports = u.ports; if (u.last_note != null) e.last_note = u.last_note; } }); renderAttendance(); refreshModalHead(); renderUsage(); refreshPlate(); Office.emit('usage', p); },
    ack(p) {
      if (p.ref === 'tpl') { onTplAck(p); return; }
      if (p.ref === 'mcp') { if (p.ok === false) toast('MCP: ' + (p.error || '실패')); else { toast('MCP ' + (p.cmd === 'mcp_remove' ? '뗐습니다' : '붙였습니다') + (p.message ? ' · ' + p.message : '')); mq('need').hidden = true; if (!mq('panel').hidden) { const on = $('.mtabs button.on'); if (on) mcpTab(on.dataset.mt); } } return; }
      if (p.cmd === 'stop' && p.confirm) { if (confirm(`${name(p.employee)}: ${p.error}\n\nworktree 는 지우지 않고 세션만 닫습니다 (${(p.worktree || {}).path || ''}). 그래도 퇴근?`)) Office.send({ cmd: 'stop', employee: p.employee, force: true }); return; }
      if (p.cmd === 'open_ide' && p.ok) { toast(`${p.editor} 로 열었습니다: ${p.path}`); return; }
      if (p.ok === false && p.error) { toast(`${name(p.employee)}: ${p.error}`); if (p.needs_terminal && modalFor === p.employee) setTab('term'); if (p.cmd === 'start') renderAttendance(); }
      else if (p.cmd === 'say' && p.queued) toast(`${name(p.employee)}: 턴이 끝난 뒤 전달합니다`);
      else if (p.cmd === 'permission_mode' && p.mode) toast(`${name(p.employee)}: 모드 ${p.mode}`);
      else if (p.cmd === 'effort' && p.effort) toast(`${name(p.employee)}: effort ${p.effort}`);
    },
  };
  function handle(event, p) { const h = handlers[event]; if (h) h(p); }

  function renderAll() { renderBar(); renderAttendance(); renderUsage(); }

  /* ---------- 상단 바 ---------- */
  function renderBar() {
    const es = Object.values(Office.employees);
    $('#c-on').textContent = es.filter(e => Office.present(e.id)).length;
    // 전부 보이되 0 인 칸은 흐리게 — 전체 상태를 한눈에, 신경 쓸 것만 밝게
    const work = es.filter(e => ['working', 'meeting'].includes(e.status)).length; $('#c-work').textContent = work; $('#c-work-wrap').classList.toggle('zero', !work);
    const ask = es.filter(e => e.status === 'needs_input').length;
    $('#c-ask').textContent = ask; $('#c-ask-wrap').classList.toggle('has', ask > 0); $('#c-ask-wrap').classList.toggle('zero', !ask);
    $('#c-unread').textContent = Office.unread; $('#c-unread-wrap').classList.toggle('has', Office.unread > 0); $('#c-unread-wrap').classList.toggle('zero', !Office.unread);
    const meet = Object.keys(Office.meetings).length; $('#c-meet').textContent = meet; $('#c-meet-wrap').classList.toggle('zero', !meet);
    document.title = (Office.unread ? `(${Office.unread}) ` : '') + (ask ? '? ' : '') + 'Pixaude Office';
    renderCliWarn(es);
  }
  /* 상태줄이 알려준 CLI 버전이 화면 패턴을 검증한 범위 밖이면 상단바에 경고 (동작은 막지 않음) */
  const verCmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
  function renderCliWarn(es) {
    const w = $('#cli-warn'); const r = Office.claudeTested; if (!r) { w.hidden = true; return; }
    const vs = [...new Set(es.map(e => e.version).filter(Boolean))]; const bad = vs.filter(v => verCmp(v, r[0]) < 0 || verCmp(v, r[1]) > 0);
    w.hidden = !bad.length; if (bad.length) { w.textContent = `⚠ CLI ${bad.join(', ')} 미검증`; w.title = `화면 패턴·훅을 확인한 Claude Code 버전은 ${r[0]}~${r[1]} 입니다. 상태가 「작업 중」에 멈추거나 모드가 안 읽히면 README 문제 해결 참고`; }
  }

  /* ---------- 사용량 HUD ---------- */
  const fmtReset = ep => { if (!ep) return ''; const d = new Date(ep * 1000); const ms = d - Date.now(); const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); if (ms <= 0) return '곧'; const h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60; return ms < 36e5 * 24 ? `${h ? h + '시간 ' : ''}${m}분 후 ${hh}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}`; };
  function renderUsage() {
    const u = Office.usage || {}; const t = u.today || {}; const rl = Office.rateLimits || {};
    const fh = rl.five_hour, sd = rl.seven_day;
    const stale = rl.ts && (Date.now() / 1000 - rl.ts) > 1800;
    $('#u-day').textContent = fmtTok(t.total); $('#u-day-sub').textContent = 'tok';   // 하루 기준선은 없다(임의 값이라 뺐음, 2026-10-27). 오늘 총량만
    const setG = (id, v) => { const g = $(id); const pct = v ? v.used_percentage || 0 : 0; g.className = 'gauge sm' + lvl(pct, 60, 80); g.querySelector('i').style.width = pct + '%'; };
    setG('#g-5h', fh); setG('#g-7d', sd);
    $('#u-5h').textContent = fh ? `${Math.round(fh.used_percentage)}%` : '–';
    $('#u-5h-reset').textContent = fh ? `${fmtReset(fh.resets_at)} 리셋` : '';
    $('#u-5h').parentElement.title = fh ? `구독 5시간 창 사용률${stale ? ' · 마지막 갱신 ' + Math.round((Date.now() / 1000 - rl.ts) / 60) + '분 전' : ''}` : '오피스 세션이 한 번 응답하면 표시됩니다';
    $('#u-7d').textContent = sd ? `${Math.round(sd.used_percentage)}%` : '–';
    $('#u-7d-reset').textContent = sd ? `${fmtReset(sd.resets_at)} 리셋` : '';
    $('#u-7d').parentElement.title = sd ? `구독 주간 사용률${stale ? ' · 마지막 갱신 ' + Math.round((Date.now() / 1000 - rl.ts) / 60) + '분 전' : ''}` : '오피스 세션이 한 번 응답하면 표시됩니다';
    $('#u-cost').textContent = t.cost != null ? t.cost.toFixed(2) : '–';
    const pct = Math.max(fh ? fh.used_percentage : 0, sd ? sd.used_percentage : 0);
    $('#usage').classList.toggle('hot', pct >= 80); $('#usage').classList.toggle('warn', pct >= 60 && pct < 80); $('#usage').classList.toggle('stale', !!stale);
    const age = rl.ts ? Math.round((Date.now() / 1000 - rl.ts) / 60) : null; $('#u-age').textContent = age == null ? '' : age < 1 ? '방금 갱신' : `${age}분 전 갱신`;
  }
  setInterval(() => { try { renderUsage(); } catch (e) {} }, 60000);
  function openUsage() {
    const u = Office.usage || {}; const body = $('#u-body'); body.innerHTML = '';
    const rl = Office.rateLimits || {};
    body.appendChild(el('div', 'ph', '구독 사용률 (Claude Code 상태줄 기준) · 5시간 창은 첫 요청부터 5시간 단위로 리셋'));
    if (!rl.five_hour && !rl.seven_day) body.appendChild(el('div', 'hint', '오피스 세션이 한 번 응답하면 채워집니다.'));
    [['5시간', rl.five_hour], ['주간(7일)', rl.seven_day], ['지출 한도', rl.spend_limit]].forEach(([k, v]) => {
      if (!v) return; const r = el('div', 'urow'); r.appendChild(el('span', null, k));
      const g = el('div', 'gauge'); const pct = v.used_percentage || 0; g.className = 'gauge' + lvl(pct, 60, 80); const i = el('i'); i.style.width = pct + '%'; g.appendChild(i); g.appendChild(el('em', null, Math.round(pct) + '%')); r.appendChild(g);
      r.appendChild(el('code', null, (v.resets_at ? fmtReset(v.resets_at) + ' 리셋' : '') + (v.used_usd != null ? ` · $${v.used_usd}/${v.limit_usd}` : ''))); body.appendChild(r);
    });
    const sec = (title, d) => {
      body.appendChild(el('div', 'ph', title));
      if (!d || !d.total) { body.appendChild(el('div', 'hint', '기록 없음')); return; }
      [['총 토큰', fmtTok(d.total)], ['출력', fmtTok(d.out)], ['입력(비캐시)', fmtTok(d.in)], ['캐시 읽기', fmtTok(d.cread)], ['캐시 쓰기', fmtTok(d.cwrite)], ['호출 수', d.calls], ['추정 비용', '$' + (d.cost || 0).toFixed(2)]].forEach(([k, v]) => {
        const r = el('div', 'urow'); r.appendChild(el('span', null, k)); r.appendChild(el('code', null, String(v))); r.appendChild(el('span')); body.appendChild(r);
      });
      Object.entries(d.by_model || {}).forEach(([m, v]) => { const r = el('div', 'urow'); r.appendChild(el('span', 'meta', m)); r.appendChild(el('code', null, `출력 ${fmtTok(v.out)} · ${v.calls}회`)); r.appendChild(el('span')); body.appendChild(r); });
    };
    sec('오늘 (트랜스크립트 추정, 터미널 세션 포함)', u.today); sec('최근 5시간', u.window5h);
    body.appendChild(el('div', 'ph', '직원별 컨텍스트'));
    Object.values(Office.employees).filter(e => Office.present(e.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko')).forEach(e => {
      // 이름 줄 + 게이지 줄 (두 줄 고정) → 이름 길이와 상관없이 게이지가 일렬로 정렬
      const r = el('div', 'urow2');
      const top = el('div', 'nm'); top.appendChild(el('b', null, e.name)); top.appendChild(el('span', 'meta', ` ${e.id} · ${Office.modelOf(e)}${e.effort ? ' · ' + e.effort : ''}`)); r.appendChild(top);
      const line = el('div', 'gl');
      const g = el('div', 'gauge'); const pct = (e.ctx && e.ctx.pct) || 0; g.className = 'gauge' + lvl(pct, 70, 85); const i = el('i'); i.style.width = pct + '%'; g.appendChild(i); g.appendChild(el('em', null, pct + '%')); line.appendChild(g);
      line.appendChild(el('code', null, e.ctx && e.ctx.ctx ? fmtTok(e.ctx.ctx) + ' / ' + fmtTok(e.ctx.window) : '아직 대화 없음')); r.appendChild(line);
      body.appendChild(r);
    });
    body.appendChild(el('div', 'hint', '구독 요금제에서는 비용이 실제 청구되지 않습니다. API 단가 기준 참고치입니다.'));
    usageM.open();
  }
  const usageM = makeModal($('#usagebox'));
  $('#usage').addEventListener('click', openUsage); $('#u-close').addEventListener('click', usageM.close);

  /* ---------- 출근 관리 (템플릿별 + 인스턴스) ---------- */
  function ctxBar(e) {
    const g = el('div', 'hp'); const pct = (e.ctx && e.ctx.pct) || 0;
    g.className = 'hp' + lvl(pct, 60, 80); const i = el('i'); i.style.width = pct + '%'; g.appendChild(i);
    g.title = e.ctx && e.ctx.ctx ? `컨텍스트 ${pct}% (${fmtTok(e.ctx.ctx)}/${fmtTok(e.ctx.window)})` : '컨텍스트: 아직 대화 없음';
    return g;
  }
  function renderAttendance() {
    const list = $('#att-list'); list.innerHTML = '';
    Office.templates.forEach(t => {
      const insts = Object.values(Office.employees).filter(e => e.template === t.id).sort((a, b) => a.no - b.no);
      // 팀 하나 = 카드 하나. 머리(이름·방·태그·버튼) 아래 직원 행이 붙는다
      const card = el('div', 'team' + (insts.length ? ' on' : '')); card.style.setProperty('--team', teamColor(t.id));
      const head = el('div', 'tpl' + (insts.length ? ' on' : ''));
      const info = el('div', 'info'); const nm = el('b', null, t.name); nm.title = `${t.id} · ${t.cwd || ''}`; info.appendChild(nm);
      const tags = el('div', 'tags'); tags.appendChild(el('span', 'room', t.room));   // alias 는 표시 안 함 (쓰는 사람만 쓰는 값)
      if (t.args) { const a = t.args.replace('--dangerously-skip-permissions', 'skip-perm'); const g = el('code', 'tag', a); g.title = t.args; tags.appendChild(g); }
      if (t.mcp_n) { const mb = el('code', 'tag mcpn', `MCP ${t.mcp_n}`); mb.title = '이 팀에 붙은 MCP (클릭: 관리)'; mb.addEventListener('click', ev => { ev.stopPropagation(); openTpl(t); setTimeout(() => $('#t-mcp').scrollIntoView({ block: 'start' }), 100); }); tags.appendChild(mb); }
      if (t.sandbox) { const sb = el('code', 'tag sbx', '🛡 샌드박스'); sb.title = '샌드박스: 셸 명령을 OS 격리 안에서 실행'; tags.appendChild(sb); }
      if (!t.active) { const off = el('code', 'tag off', '전체 출근 제외'); off.title = 'active: false — 「전체 출근」·office up 에서 빠집니다. 여기 ＋ 로 직접 출근은 가능'; tags.appendChild(off); }
      info.appendChild(tags); head.appendChild(info);
      const acts2 = el('div', 'acts2');
      const ed = el('button', 'mini2 ghost ic edit', '✎'); ed.title = '팀 설정 수정 (company.yaml)'; ed.addEventListener('click', ev => { ev.stopPropagation(); openTpl(t); }); acts2.appendChild(ed);
      const b = el('button', 'mini2 go ic', '+'); b.title = insts.length ? `직원 한 명 더 출근 (${t.id}_${insts.length + 1})` : `직원 출근 (${t.id}_1)`;
      b.addEventListener('click', ev => { ev.stopPropagation(); b.disabled = true; b.textContent = '…'; Office.send({ cmd: 'start', employee: t.id }); });
      acts2.appendChild(b); head.appendChild(acts2); card.appendChild(head); list.appendChild(card);
      insts.forEach(e => {
        const present = Office.present(e.id);
        const row = el('div', 'att' + (present ? ' on' : '') + (e.status === 'starting' ? ' starting' : '')); row.style.setProperty('--team', teamColor(t.id)); row.title = `${e.id} · 클릭하면 대화`;
        row.appendChild(el('i', 'dot ' + e.status));
        const inf = el('div', 'info');
        const l1 = el('div', 'l1'); l1.appendChild(el('b', null, `#${e.no || 1}`)); l1.appendChild(el('span', 'st ' + e.status, statusKo(e.status)));
        const hookAge = e.last_hook ? Date.now() / 1000 - e.last_hook : null;
        if (['working', 'meeting'].includes(e.status) && hookAge != null && hookAge > 180) { const w = el('span', 'hookwarn', `훅 ${Math.round(hookAge / 60)}분 없음`); w.title = '작업 중인데 훅 이벤트가 오래 없습니다. 터미널 탭에서 화면을 확인하세요'; l1.appendChild(w); }
        if (e.queue_n) { const q = el('span', 'qn', `메모 ${e.queue_n}`); q.title = '턴이 끝나면 전달할 메모'; l1.appendChild(q); }
        if (e.subagents && e.subagents.length) { const sb = el('span', 'sub', `부하 ${e.subagents.length}`); sb.title = '작업 중인 서브에이전트: ' + e.subagents.join(', '); l1.appendChild(sb); }
        if (e.mcp_stale) { const m = el('span', 'mcpst', '설정 변경됨 · 재기동'); m.title = 'MCP·팀 설정·프로젝트 설정이 바뀌었습니다. 클릭하면 --resume 으로 재기동해 적용'; m.addEventListener('click', ev => { ev.stopPropagation(); Office.send({ cmd: 'restart', employee: e.id }); }); l1.appendChild(m); }
        if (e.update_pending) { const u = el('span', 'upd', '업데이트'); u.title = 'Claude Code 새 버전 내려받음. 5분 이상 쉬면 자동으로 재기동(--resume)해 적용. 지금 하려면 명패의 재기동'; l1.appendChild(u); }
        if (e.sandbox) { const s = el('span', 'sbx', '🛡 샌드박스'); s.title = '샌드박스 켜진 세션: 셸 명령이 OS 격리 안에서 실행돼 작업실 밖 파일 쓰기·외부 네트워크가 막힙니다'; l1.appendChild(s); }
        inf.appendChild(l1);
        const l2 = el('div', 'l2'); l2.appendChild(ctxBar(e)); const mdl = el('span', 'mdl', Office.modelOf(e)); mdl.title = '클릭해서 모델 변경'; mdl.addEventListener('click', ev => { ev.stopPropagation(); Office.openPlate(e.id); }); l2.appendChild(mdl);
        if (e.fast || ['high', 'xhigh', 'max'].includes(e.effort)) { const f = el('span', 'eff' + (e.effort === 'max' || e.effort === 'xhigh' ? ' hi' : ''), (e.fast ? '⚡' : '') + (['high', 'xhigh', 'max'].includes(e.effort) ? e.effort : '')); f.title = (e.fast ? 'fast 모드 · ' : '') + `effort ${e.effort || '(기본)'}`; l2.appendChild(f); }
        if (e.tasks && e.tasks.total) { const tk = el('span', 'tasks', `✓ ${e.tasks.done}/${e.tasks.total}`); tk.title = '이 세션의 작업 목록 진행 (TaskCreated/TaskCompleted 훅)'; l2.appendChild(tk); }
        inf.appendChild(l2);
        const pr = e.pr && e.pr.number ? e.pr : null; const ports = (e.ports || []).slice(0, 3);   // worktree 브랜치는 행에 안 보인다 (레포 브랜치와 달라 헷갈림). 명패에만
        if (pr || ports.length || e.last_note) {
          const l3 = el('div', 'l3');
          if (pr) { const rs = (pr.review_state || '').toLowerCase(); const a = el('a', 'pr ' + (pr.state || '').toLowerCase() + (rs ? ' ' + rs : ''), `#${pr.number}${pr.isDraft || rs === 'draft' ? ' draft' : pr.state === 'MERGED' ? ' merged' : pr.state === 'CLOSED' ? ' closed' : rs === 'approved' ? ' ✓' : rs === 'changes_requested' ? ' ✗' : ''}`); a.href = pr.url; a.target = '_blank'; a.rel = 'noopener'; a.title = (pr.title || 'PR') + (rs ? ` · 리뷰 ${rs}` : ''); a.addEventListener('click', ev => ev.stopPropagation()); l3.appendChild(a); }
          ports.forEach(pt => l3.appendChild(el('span', 'port', ':' + pt)));
          if (e.last_note) { const n = el('span', 'note', e.last_note); n.title = e.last_note; l3.appendChild(n); }
          inf.appendChild(l3);
        }
        row.appendChild(inf);
        const acts = el('div', 'acts');
        if (e.status === 'starting') acts.appendChild(el('span', 'meta', '출근 중…'));
        else { const x = el('button', 'mini2', '퇴근'); x.addEventListener('click', ev => { ev.stopPropagation(); if (confirmBtn(x, '퇴근 확인')) Office.send({ cmd: 'stop', employee: e.id }); }); acts.appendChild(x); }
        row.appendChild(acts);
        row.addEventListener('click', () => { if (present) openModal(e.id); });
        card.appendChild(row);
      });
    });
  }
  function confirmBtn(b, label) {
    if (b.dataset.arm) { delete b.dataset.arm; b.textContent = b.dataset.orig; return true; }
    b.dataset.arm = '1'; b.dataset.orig = b.textContent; b.textContent = label; setTimeout(() => { if (b.dataset.arm) { delete b.dataset.arm; b.textContent = b.dataset.orig; } }, 3000); return false;
  }
  $('#att-all-on').addEventListener('click', () => { Office.templates.forEach(t => { if (t.active && !Object.values(Office.employees).some(e => e.template === t.id)) Office.send({ cmd: 'start', employee: t.id }); }); toast('active 팀마다 직원 1명 출근 요청'); });
  $('#att-all-off').addEventListener('click', function () { if (!confirmBtn(this, '전체 퇴근 확인')) return; Object.values(Office.employees).forEach(e => Office.send({ cmd: 'stop', employee: e.id })); });

  /* ---------- 직원(템플릿) 추가/수정: company.yaml 을 화면에서 편집 ---------- */
  const tplBox = $('#tplbox'); let tplEditing = null;
  const tv = id => $('#t-' + id);
  async function browseDirs(path) {
    try {
      const j = await api('/api/dirs/?p=' + encodeURIComponent(path || '~'));
      const cur = tv('cur'); cur.innerHTML = ''; cur.dataset.path = j.path; tv('up').dataset.parent = j.parent || '';
      const home = j.home || ''; const rel = home && j.path.startsWith(home) ? j.path.slice(home.length) : j.path;   // 홈 아래는 ~ 부터 조각으로
      const parts = rel.split('/').filter(Boolean); let acc = home || '';
      const mk = (label, path) => { const a = el('a', null, label); a.addEventListener('click', () => browseDirs(path)); cur.appendChild(a); };
      mk(home ? '~' : '/', home || '/'); parts.forEach(seg => { acc += '/' + seg; cur.appendChild(el('span', null, '/')); mk(seg, acc); });
      const dl = tv('dl'); dl.innerHTML = '';
      if (!j.items.length) dl.appendChild(el('div', 'di', '(하위 폴더 없음)'));
      j.items.forEach(it => {
        const d = el('div', 'di' + (it.git ? ' git' : '')); d.appendChild(el('span', null, (it.git ? '⎇ ' : '') + it.name + '/')); const pk = el('span', 'pick', it.git ? '이 폴더 선택' : '열기 ›'); d.appendChild(pk);
        d.addEventListener('click', () => { if (it.git) { tv('cwd').value = it.path; if (!tv('name').value) tv('name').value = it.name; if (!tv('id').value) tv('id').value = it.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); } browseDirs(it.path); });
        dl.appendChild(d);
      });
    } catch (e) { toast('폴더 목록 실패: ' + e.message); }
  }
  tv('up').addEventListener('click', () => browseDirs(tv('up').dataset.parent || '~'));
  tv('home').addEventListener('click', () => browseDirs('~'));
  tv('cwd').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); browseDirs(tv('cwd').value.trim() || '~'); } });   // 작업실 칸에 경로 치고 Enter → 그 폴더로
  function openTpl(t) {
    tplEditing = t ? t.id : null; tplM.open();
    $('#t-title').textContent = t ? `${t.name} 팀 설정` : '팀 추가';
    tv('id').value = t ? t.id : ''; tv('id').disabled = !!t; tv('name').value = t ? t.name : ''; tv('cwd').value = t ? (t.cwd_raw || t.cwd) : '';
    tv('room').value = t ? t.room : ''; tv('pyenv').value = t ? t.pyenv : ''; tv('model').value = t ? t.model : ''; tv('perm').value = t ? t.permission : '';
    const args = t ? (t.args || '') : ''; tv('skip').checked = args.includes('--dangerously-skip-permissions'); tv('args').value = args.replace('--dangerously-skip-permissions', '').trim();
    tv('adddirs').value = t ? (Array.isArray(t.add_dirs) ? t.add_dirs.join(', ') : (t.add_dirs || '')) : ''; tv('alias').value = t ? t.alias : ''; tv('active').checked = t ? !!t.active : true;
    tv('worktree').value = t ? (t.worktree || 'extra') : 'extra'; tv('sandbox').checked = t ? !!t.sandbox : false;
    tv('del').hidden = !t; tv('start').hidden = !!t;
    const rooms = $('#t-rooms'); rooms.innerHTML = ''; [...new Set(Office.templates.map(x => x.room))].forEach(r => { const o = el('option'); o.value = r; rooms.appendChild(o); });
    // pyenv 는 파이썬 팀만 쓰는 값. 이 컴퓨터에 pyenv 가 없고 이 팀도 안 쓰면 칸 자체를 숨긴다 (Java·Vue 팀엔 의미 없음)
    const pys = $('#t-pyenvs'); pys.innerHTML = ''; const pyNames = [...new Set([...(Office.pyenvs || []), ...Office.templates.map(x => x.pyenv).filter(Boolean)])]; pyNames.forEach(r => { const o = el('option'); o.value = r; pys.appendChild(o); });
    $('#t-pyenv-wrap').hidden = !pyNames.length && !(t && t.pyenv);
    browseDirs(t ? t.cwd : '~/Documents');
    (t ? tv('name') : tv('id')).focus();
    loadMcp(t); loadSkills(t);
  }
  function loadSkills(t) {
    const sec = $('#t-skills'); if (!t) { sec.hidden = true; return; } sec.hidden = false;
    ['project', 'user', 'plugins'].forEach(k => { $('#sk-' + k).innerHTML = ''; });
    api(`/api/teams/${t.id}/skills/`).then(j => {
      if (tplEditing !== t.id) return;
      const fill = (id, items, fmt) => { const box = $('#sk-' + id); box.innerHTML = ''; if (!items.length) { box.appendChild(el('div', 'empty', '없음')); return; } items.forEach(it => { const r = el('div', 'skrow'); const [b, d] = fmt(it); r.appendChild(el('b', null, b)); if (d) r.appendChild(el('div', 'd', d)); r.title = it.path || ''; box.appendChild(r); }); };
      fill('project', j.project || [], it => [it.name + (it.kind === 'skill' ? '' : ' ·cmd'), it.desc]);
      fill('user', j.user || [], it => [it.name, it.desc]);
      fill('plugins', j.plugins || [], it => [it.name, `${it.marketplace} · ${it.scope}${it.updated ? ' · ' + it.updated : ''}`]);
    }).catch(() => {});
  }
  /* ---------- 팀 MCP: 목록 · 카탈로그 · 검색 · 복사 · 직접 입력 (claude mcp CLI 를 서버가 실행) ---------- */
  const mq = s => $('#mcp-' + s);
  let mcpCatalog = null, mcpPending = null;
  function loadMcp(t) {
    const sec = $('#t-mcp'); mq('panel').hidden = true; mq('need').hidden = true;
    if (!t) { sec.hidden = true; return; }
    sec.hidden = false; mq('list').innerHTML = ''; mq('list').appendChild(el('div', 'empty', '불러오는 중…'));
    api(`/api/teams/${t.id}/mcp/`).then(j => { if (tplEditing === t.id) renderMcp(j); }).catch(() => {});
  }
  function renderMcp(j) {
    const list = mq('list'); list.innerHTML = '';
    $('#mcp-meta').textContent = j.checked ? '이 팀 세션에 붙는 서버 · 상태 확인됨' : '이 팀 세션에 붙는 서버 · 상태 확인 중…';
    if (!j.items.length) { list.appendChild(el('div', 'empty', '붙은 MCP 가 없습니다. 「＋ 추가」로 골라 붙이세요.')); return; }
    j.items.forEach(it => {
      const r = el('div', 'mrow'); const st = el('i', 'st ' + (it.status || 'unknown')); st.title = it.status_text || '상태 미확인'; r.appendChild(st);
      const nm = el('div', 'nm'); nm.appendChild(el('b', null, it.name)); nm.appendChild(el('code', null, it.target)); r.appendChild(nm);
      const sc = el('span', 'sc ' + it.scope, it.scope === 'connector' ? 'claude.ai' : it.scope); sc.title = { local: '이 팀만', project: '레포의 .mcp.json (팀원과 공유)', user: '모든 팀', connector: 'claude.ai 커넥터 (설정에서 관리)', plugin: '플러그인' }[it.scope] || ''; r.appendChild(sc);
      if (['local', 'project', 'user'].includes(it.scope)) { const x = el('button', 'x', '✕'); x.type = 'button'; x.addEventListener('click', () => { if (!confirmBtn(x, '정말?')) return; Office.send({ cmd: 'mcp_remove', team: tplEditing, name: it.name, scope: it.scope, ref: 'mcp' }); }); r.appendChild(x); } else r.appendChild(el('span'));
      list.appendChild(r);
    });
    list.dataset.names = JSON.stringify(j.items.map(i => i.name));
  }
  const mcpHas = name => { try { return JSON.parse(mq('list').dataset.names || '[]').includes(name); } catch (e) { return false; } };
  const mcpScope = () => $('#mcp-all').checked ? 'user' : 'local';
  function mcpTab(which) { $$('.mtabs button[data-mt]').forEach(b => b.classList.toggle('on', b.dataset.mt === which)); $$('.madd .mt').forEach(d => d.hidden = d.dataset.mt !== which); mq('need').hidden = true; if (which === 'catalog') renderCatalog(); if (which === 'copy') renderCopy(); if (which === 'search') mq('q').focus(); }
  $$('.mtabs button[data-mt]').forEach(b => b.addEventListener('click', () => mcpTab(b.dataset.mt)));
  mq('add').addEventListener('click', () => { const p = mq('panel'); p.hidden = !p.hidden; if (!p.hidden) mcpTab('catalog'); });
  async function renderCatalog() {
    if (!mcpCatalog) { try { mcpCatalog = (await api('/api/mcp/catalog/')).items; } catch (e) { mcpCatalog = []; } }
    const box = mq('catalog'); box.innerHTML = '';
    mcpCatalog.forEach(c => {
      const d = el('div', 'mcard' + (mcpHas(c.id) ? ' on' : '')); d.appendChild(el('b', null, c.title)); d.appendChild(el('div', 'd', c.desc)); d.appendChild(el('div', 't', c.url || [c.command, ...(c.args || [])].join(' ')));
      d.addEventListener('click', () => { if (c.need && c.need.length) askNeed(c.title, c.need, vals => Office.send({ cmd: 'mcp_add', team: tplEditing, fields: { catalog: c.id, values: vals, scope: mcpScope() }, ref: 'mcp' })); else Office.send({ cmd: 'mcp_add', team: tplEditing, fields: { catalog: c.id, values: {}, scope: mcpScope() }, ref: 'mcp' }); });
      box.appendChild(d);
    });
  }
  function askNeed(title, need, done) {
    const box = mq('need'); box.hidden = false; $('#mn-title').textContent = `${title} — 필요한 값`; const f = $('#mn-fields'); f.innerHTML = '';
    need.forEach(n => { const l = el('label', null, n.label + (n.required === false ? ' (선택)' : '')); const i = el('input'); i.placeholder = n.placeholder || ''; i.dataset.key = n.key; l.appendChild(i); f.appendChild(l); });
    mcpPending = done; const first = f.querySelector('input'); if (first) first.focus();
  }
  $('#mn-ok').addEventListener('click', () => { const vals = {}; $$('#mn-fields input').forEach(i => { if (i.value.trim()) vals[i.dataset.key] = i.value.trim(); }); if (mcpPending) mcpPending(vals); mq('need').hidden = true; });
  $('#mn-cancel').addEventListener('click', () => { mq('need').hidden = true; mcpPending = null; });
  async function searchMcp() {
    const q = mq('q').value.trim(); const box = mq('results'); box.innerHTML = ''; if (!q) return; box.appendChild(el('div', 'empty', '검색 중…'));
    let items = []; try { items = (await api('/api/mcp/search/?q=' + encodeURIComponent(q))).items || []; } catch (e) {}
    box.innerHTML = ''; if (!items.length) { box.appendChild(el('div', 'empty', '결과 없음')); return; }
    if (items[0].error) { box.appendChild(el('div', 'empty', items[0].error)); return; }
    items.forEach(it => {
      const d = el('div', 'mcard'); d.appendChild(el('b', null, it.title)); d.appendChild(el('div', 'd', it.desc || it.name)); const opts = el('div', 'opts');
      it.options.forEach(o => { const b = el('button', null, o.label); b.type = 'button'; b.title = '이 방식으로 붙이기'; b.addEventListener('click', ev => { ev.stopPropagation(); const name = (it.name.split('/').pop() || 'mcp').replace(/[^\w.-]+/g, '-').toLowerCase().slice(0, 40); const need = [...(o.env || []).map(e => ({ key: 'env:' + e.key, label: e.label, required: e.required })), ...(o.headers || []).map(h => ({ key: 'hdr:' + h.key, label: h.label }))]; const send = vals => { const env = {}, headers = {}; Object.entries(vals).forEach(([k, v]) => { if (k.startsWith('env:')) env[k.slice(4)] = v; else if (k.startsWith('hdr:')) headers[k.slice(4)] = v; }); Office.send({ cmd: 'mcp_add', team: tplEditing, fields: { name, transport: o.transport, target: o.target, args: o.args, env, headers, scope: mcpScope() }, ref: 'mcp' }); }; if (need.length) askNeed(it.title, need, send); else send({}); }); opts.appendChild(b); });
      d.appendChild(opts); box.appendChild(d);
    });
  }
  mq('go').addEventListener('click', searchMcp); mq('q').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); searchMcp(); } });
  async function renderCopy() {
    const box = mq('copy'); box.innerHTML = ''; box.appendChild(el('div', 'empty', '다른 팀 설정 읽는 중…'));
    const others = Office.templates.filter(t => t.id !== tplEditing && t.mcp_n);
    const rows = []; for (const t of others) { try { const j = await api(`/api/teams/${t.id}/mcp/`); (j.items || []).filter(i => ['local', 'project'].includes(i.scope)).forEach(i => rows.push({ t, i })); } catch (e) {} }
    box.innerHTML = ''; if (!rows.length) { box.appendChild(el('div', 'empty', '다른 팀에 local/project MCP 가 없습니다.')); return; }
    rows.forEach(({ t, i }) => { const d = el('div', 'mcard' + (mcpHas(i.name) ? ' on' : '')); d.appendChild(el('b', null, i.name)); d.appendChild(el('div', 'd', `${t.name} 팀의 ${i.scope}`)); d.appendChild(el('div', 't', i.target)); d.addEventListener('click', () => Office.send({ cmd: 'mcp_add', team: tplEditing, fields: { copy_from: t.id, name: i.name, scope: mcpScope() }, ref: 'mcp' })); box.appendChild(d); });
  }
  $('#mm-save').addEventListener('click', () => {
    const tr = $('#mm-tr').value; const raw = $('#mm-target').value.trim(); if (!raw) { toast('명령 또는 URL 을 입력하세요'); return; }
    const parts = tr === 'stdio' ? raw.split(/\s+/) : [raw]; const kv = txt => Object.fromEntries(txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^([^=:]+)\s*[=:]\s*(.*)$/); return m ? [m[1].trim(), m[2].trim()] : null; }).filter(Boolean));
    Office.send({ cmd: 'mcp_add', team: tplEditing, fields: { name: $('#mm-name').value.trim(), transport: tr, target: parts[0], args: parts.slice(1), env: kv($('#mm-env').value), headers: kv($('#mm-headers').value), scope: mcpScope() }, ref: 'mcp' });
  });
  ['mm-name', 'mm-target', 'mm-env', 'mm-headers'].forEach(id => $('#' + id).addEventListener('keydown', e => e.stopPropagation()));
  function tplFields() {
    const args = [tv('skip').checked ? '--dangerously-skip-permissions' : '', tv('args').value.trim()].filter(Boolean).join(' ');
    return { id: tv('id').value.trim(), name: tv('name').value.trim(), cwd: tv('cwd').value.trim(), room: tv('room').value.trim(), pyenv: tv('pyenv').value.trim(), model: tv('model').value, permission: tv('perm').value, args, add_dirs: tv('adddirs').value.trim(), alias: tv('alias').value.trim(), active: tv('active').checked, worktree: tv('worktree').value, sandbox: tv('sandbox').checked };
  }
  let tplAfterSave = null;
  $('#t-form').addEventListener('submit', e => { e.preventDefault(); tplAfterSave = null; Office.send({ cmd: 'tpl_save', fields: tplFields(), ref: 'tpl' }); });
  tv('start').addEventListener('click', () => { const f = tplFields(); tplAfterSave = f.id; Office.send({ cmd: 'tpl_save', fields: f, ref: 'tpl' }); });
  tv('del').addEventListener('click', function () { Office.send({ cmd: 'tpl_delete', id: tplEditing, ref: 'tpl' }); });   // 한 번에 삭제 (company.yaml 에서 제거. 출근 중 직원은 서버가 거부)
  const tplM = makeModal(tplBox, () => { tplEditing = null; });
  $('#t-close').addEventListener('click', tplM.close);
  tplBox.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') tplM.close(); });
  $('#tpl-new').addEventListener('click', () => openTpl(null));
  const guideM = makeModal($('#guide'));
  $('#guide-btn').addEventListener('click', guideM.open); $('#t-guide').addEventListener('click', e => { e.preventDefault(); guideM.open(); });
  $('#g-close').addEventListener('click', guideM.close);
  function onTplAck(p) {
    if (p.ok === false) { toast(p.error || '저장 실패'); return; }
    if (p.cmd === 'tpl_save') { toast(`저장했습니다: ${p.id}`); tplM.close(); if (tplAfterSave) { Office.send({ cmd: 'start', employee: tplAfterSave }); tplAfterSave = null; } }
    else if (p.cmd === 'tpl_delete') { toast('삭제했습니다'); tplM.close(); }
  }

  /* ---------- 이전 세션 목록 ---------- */
  const sessBox = $('#sessions');
  async function openSessions(t, hereId) {   // hereId 가 있으면 그 자리에서 전환, 없으면 새 자리로 출근
    sessM.open();
    $('#s-title').textContent = hereId ? `${name(hereId)} · 세션 전환` : `${t.name} · 이전 세션`; $('#s-meta').textContent = hereId ? '클릭하면 이 자리에서 그 대화로 바꿉니다 (/resume)' : t.cwd;
    const list = $('#s-list'); list.innerHTML = ''; list.appendChild(el('div', 'msg tool', '불러오는 중…'));
    const j = await api(`/api/templates/${t.id}/sessions/`); list.innerHTML = '';
    if (!j.items.length) list.appendChild(el('div', 'msg tool', '이 폴더에 기록된 세션이 없습니다.'));
    j.items.forEach(it => {
      const row = el('div', 'srow' + (it.running ? ' on' : ''));
      const l = el('div'); l.appendChild(el('div', 't', it.title)); if (it.first && it.first !== it.title) l.appendChild(el('div', 'f', it.first)); row.appendChild(l);
      const m = el('div', 'm'); m.textContent = `${it.mtime.replace('T', ' ')}\n${it.messages}턴 · ${it.model || ''}\n${it.session_id.slice(0, 8)}${it.running ? '\n● ' + it.running : ''}`; m.style.whiteSpace = 'pre'; row.appendChild(m);
      row.addEventListener('click', () => { sessM.close(); if (hereId) { if (it.running === hereId) { toast('지금 열려 있는 세션입니다'); return; } Office.send({ cmd: 'resume_here', employee: hereId, session_id: it.session_id }); toast(`${name(hereId)}: 세션 ${it.session_id.slice(0, 8)} 로 전환`); } else if (it.running) openModal(it.running); else { Office.send({ cmd: 'start', employee: t.id, resume: it.session_id }); toast(`${t.name}: 세션 ${it.session_id.slice(0, 8)} 이어서 출근`); } });
      list.appendChild(row);
    });
  }
  const sessM = makeModal(sessBox);
  $('#s-close').addEventListener('click', sessM.close);

  /* ---------- 토스트 ---------- */
  function toast(msg, ms) { const t = el('div', 'toast', msg); document.body.appendChild(t); setTimeout(() => t.classList.add('show'), 10); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms || 3500); }

  /* ---------- 입력 (한글 IME 대응) ---------- */
  Office.setNear = function (id) { Office.near = id && Office.employees[id] ? id : null; };   // 맵에서 Enter 로 열 직원. (빠른 입력 패널은 2026-10-27 에 뺐다)
  /* ---------- 슬래시 명령 팝업: '/' 로 시작하면 CLI 와 같은 목록을 보여주고 ↑↓/Enter/Tab 으로 고른다 ---------- */
  const cmdCache = {};
  async function commandsFor(id) {
    if (!id) return [];
    if (!cmdCache[id]) { try { cmdCache[id] = (await api(`/api/employees/${id}/commands/`)).items || []; } catch (e) { cmdCache[id] = []; } }
    return cmdCache[id];
  }
  function makePopup(ta, pop, getTarget) {
    let items = [], sel = 0, open = false;
    const render = () => {
      pop.innerHTML = '';
      if (!items.length) { pop.appendChild(el('div', 'empty', '일치하는 명령이 없습니다')); return; }
      items.slice(0, 40).forEach((c, i) => { const d = el('div', 'ci' + (i === sel ? ' sel' : '')); d.appendChild(el('code', null, c.name)); d.appendChild(el('span', null, c.desc)); d.title = c.desc; d.addEventListener('mousedown', ev => { ev.preventDefault(); choose(i); }); pop.appendChild(d); });
      const s = pop.querySelector('.ci.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    };
    const close = () => { open = false; pop.hidden = true; };
    const choose = i => { const c = items[i]; if (!c) return; ta.value = c.name + ' '; close(); ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; };
    const update = async () => {
      const v = ta.value;
      if (!v.startsWith('/') || /\s/.test(v.trimEnd())) { close(); return; }
      const all = await commandsFor(getTarget()); const q = v.slice(1).toLowerCase();
      items = all.filter(c => c.name.slice(1).toLowerCase().startsWith(q)).concat(all.filter(c => !c.name.slice(1).toLowerCase().startsWith(q) && (c.name.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q))));
      sel = 0; open = true; pop.hidden = false; render();
    };
    ta.addEventListener('input', update);
    ta.addEventListener('blur', () => setTimeout(close, 150));
    return {
      isOpen: () => open,
      key(e) {   // true 면 처리됨
        if (!open) return false;
        if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, Math.min(items.length, 40) - 1); render(); return true; }
        if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); return true; }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229)) { if (items.length) { choose(sel); return true; } close(); return false; }
        if (e.key === 'Escape') { close(); return true; }
        return false;
      },
    };
  }

  /* ---------- 입력 히스토리: 프로젝트(템플릿)별 100개, ↑/↓ 로 불러오기 (CLI 와 동일) ---------- */
  const HIST_MAX = 100;
  const histKey = id => { const e = Office.employees[id]; return 'office.hist.' + ((e && e.template) || id || 'global'); };
  const histLoad = id => { try { return JSON.parse(localStorage.getItem(histKey(id)) || '[]'); } catch (e) { return []; } };
  const histPush = (id, text) => { try { const h = histLoad(id).filter(x => x !== text); h.push(text); while (h.length > HIST_MAX) h.shift(); localStorage.setItem(histKey(id), JSON.stringify(h)); } catch (e) {} };

  /* ---------- 첨부: ⌘V 붙여넣기 / 드롭 → 서버 업로드 → 칩 표시 → 전송 시 경로를 지시문에 덧붙임 ---------- */
  const filesOf = cd => cd && cd.files && cd.files.length ? [...cd.files] : [...((cd && cd.items) || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  async function uploadFile(id, file) {
    const fd = new FormData(); fd.append('file', file, file.name || 'image.png');
    const j = await api(`/api/employees/${id}/upload/`, { method: 'POST', body: fd });
    if (!j.ok) throw new Error(j.error || 'upload failed');
    return j.path;
  }
  function makeAttach(ta, box, getTarget) {
    const items = [];   // {path, name, el}
    const render = () => { box.hidden = items.length === 0; };
    const remove = it => { const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); it.el.remove(); render(); };
    async function add(file) {
      const id = getTarget(); if (!id) { toast('먼저 직원 옆으로 가거나 대화창을 여세요'); return; }
      const chip = el('span', 'chip up'); const img = el('img'); chip.appendChild(img);
      if (file.type.startsWith('image/')) img.src = URL.createObjectURL(file); else img.remove();
      chip.appendChild(el('span', null, file.name || 'image.png')); const x = el('span', 'x', '✕'); chip.appendChild(x);
      box.appendChild(chip); render();
      const it = { path: '', name: file.name || 'image.png', el: chip }; items.push(it);
      x.addEventListener('click', () => remove(it));
      try { it.path = await uploadFile(id, file); chip.classList.remove('up'); chip.title = it.path; }
      catch (e) { toast('첨부 실패: ' + e.message); remove(it); }
    }
    ta.addEventListener('paste', e => { const files = filesOf(e.clipboardData); if (!files.length) return; e.preventDefault(); files.forEach(f => add(f)); });
    ta.addEventListener('dragover', e => { e.preventDefault(); ta.classList.add('dragover'); });
    ta.addEventListener('dragleave', () => ta.classList.remove('dragover'));
    ta.addEventListener('drop', e => { e.preventDefault(); ta.classList.remove('dragover'); [...(e.dataTransfer?.files || [])].forEach(f => add(f)); });
    return {
      paths: () => items.filter(i => i.path).map(i => i.path),
      pending: () => items.some(i => !i.path),
      clear: () => { items.splice(0).forEach(i => i.el.remove()); render(); },
    };
  }

  function bindInput(ta, getTarget) {
    let sendOnUp = null; // 조합 중 Enter는 keydown에 isComposing=true 로 오고 두 번째 keydown이 없다 → keyup에서 보냄
    const popEl = ta.parentElement.querySelector('.cmdpop'); const popup = popEl ? makePopup(ta, popEl, getTarget) : null;
    const attEl = ta.parentElement.querySelector('.attach'); const attach = attEl ? makeAttach(ta, attEl, getTarget) : null;
    let hist = null, hidx = -1, draft = '';   // hist: 탐색 중인 목록, hidx: 현재 위치(-1 = 입력 중), draft: 탐색 시작 전 쓰던 글
    const resetHist = () => { hist = null; hidx = -1; };
    const fire = shift => { const id = getTarget(); const text = ta.value.trim(); const paths = attach ? attach.paths() : []; if (!id || (!text && !paths.length)) return; if (attach && attach.pending()) { toast('이미지 업로드 중입니다. 잠시 후 보내주세요'); return; } if (text) histPush(id, text); Office.say(id, text || '첨부한 파일을 봐줘', shift ? 'queue' : 'auto', paths); ta.value = ''; if (attach) attach.clear(); resetHist(); };
    ta.addEventListener('input', () => { if (hidx !== -1 && ta.value !== (hist && hist[hidx])) resetHist(); });
    const navigate = dir => {   // dir -1 = 더 예전, +1 = 더 최근
      if (!hist) { hist = histLoad(getTarget()); draft = ta.value; hidx = hist.length; }
      let n = hidx + dir;
      if (n < 0) n = 0;
      if (n >= hist.length) { ta.value = draft; hidx = -1; hist = null; return; }
      hidx = n; ta.value = hist[n]; ta.selectionStart = ta.selectionEnd = ta.value.length;
    };
    // 주의: 캡처 단계에서 stopPropagation 하면 같은 요소의 이 핸들러도 실행되지 않는다. 핸들러 안에서만 전파를 막는다 (Phaser로 키가 새지 않게).
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (popup && popup.key(e)) { e.preventDefault(); return; }
      if (e.key === 'Escape') { e.preventDefault(); ta.blur(); closeAll(); return; }   // 팝업이 없으면 Esc 로 모달 닫기
      // ↑/↓: 커서가 첫 줄/마지막 줄에 있을 때 히스토리 탐색 (여러 줄 글 안에서는 줄 이동)
      if (e.key === 'ArrowUp' && !e.isComposing) { const before = ta.value.slice(0, ta.selectionStart); if (!before.includes('\n')) { e.preventDefault(); navigate(-1); } return; }
      if (e.key === 'ArrowDown' && !e.isComposing) { const after = ta.value.slice(ta.selectionEnd); if (!after.includes('\n') && (hist || ta.value === '')) { e.preventDefault(); navigate(+1); } return; }
      if (e.key !== 'Enter') return;
      if (e.metaKey || e.ctrlKey) { const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '\n' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 1; e.preventDefault(); return; }
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) { sendOnUp = { shift: e.shiftKey }; return; }
      sendOnUp = null; fire(e.shiftKey);
    });
    ta.addEventListener('keyup', e => { e.stopPropagation(); if (e.key === 'Enter' && sendOnUp) { const s = sendOnUp.shift; sendOnUp = null; fire(s); } });
  }

  /* ---------- 대화 모달 ---------- */
  let modalFor = null;
  const modal = $('#modal'), chat = $('#m-chat');
  function refreshModalHead() {
    if (!modalFor) return; const e = Office.employees[modalFor]; if (!e) return;
    $('#m-name').textContent = e.name; $('#m-status').textContent = statusKo(e.status); $('#m-status').className = 'pill ' + e.status;
    $('#m-meta').textContent = `${e.id}${e.branch ? ' ·  ' + e.branch : ''} · 턴 ${e.turns || 0}${e.model ? ' · ' + e.model : ''}${e.permission ? ' · ' + e.permission : ''}${e.sandbox ? ' · 🛡 샌드박스' : ''}${e.ctx && e.ctx.pct != null ? ' · ctx ' + e.ctx.pct + '%' : ''}`;
    const mm = $('#m-mode'), me = $('#m-effort'), mo = $('#m-model'); if (document.activeElement !== mm) mm.value = e.mode_actual || e.permission || 'default'; if (document.activeElement !== me) me.value = e.effort || 'medium';
    if (document.activeElement !== mo) setModelSelect(mo, e);
    const hookAge = e.last_hook ? Math.round(Date.now() / 1000 - e.last_hook) : null;
    const hookNote = hookAge == null ? '' : ` · 마지막 훅 ${hookAge < 60 ? hookAge + '초' : Math.round(hookAge / 60) + '분'} 전`;
    $('#m-hint').textContent = (e.status === 'needs_input' ? '입력 대기 중: 터미널 탭에서 직접 답하세요 (선택지·권한·질문)'
      : ['working', 'meeting'].includes(e.status) ? `작업 중: Enter 는 턴이 끝난 뒤 전달(메모${e.queue_n ? ' ' + e.queue_n + '건 대기' : ''}). 바로 끼어들려면 터미널 탭에서 Esc`
      : e.status === 'away' ? '퇴근 상태입니다. 출근 관리에서 출근시키세요' : e.status === 'error' ? '응답 실패 상태입니다. Enter로 다시 지시하면 재시도합니다' : 'Enter: 지시 전송 · /로 시작하면 CLI 명령 그대로 (/compact, /model, /clear, /help …)') + hookNote;
    showPending();
  }
  function showPending() {
    const e = Office.employees[modalFor]; const box = $('#m-pending');
    if (e && e.status === 'needs_input') {
      box.hidden = false; const login = e.pending_kind === 'login';
      $('#m-pending-text').textContent = login ? '🔑 로그인이 필요합니다. 아래 버튼으로 /login 을 보내고, 열리는 주소에서 로그인하면 세션이 자동으로 이어집니다.' : (e.bubble || e.question || '입력을 기다리고 있습니다');
      $('#m-perm-btns').hidden = login || tab === 'term'; $('#m-login-btns').hidden = !login;
      let tip = box.querySelector('.tip'); if (!tip) { tip = el('div', 'tip'); box.appendChild(tip); } tip.hidden = login; tip.textContent = '터미널에서 직접 답하세요 (↑↓·숫자·y/n·Enter, Esc 취소). 글자 타이핑은 대화상자에 엉뚱하게 들어갈 수 있어 여기서는 보내지 않습니다.';
      const a = $('#m-login-url'); if (login && e.login_url) { a.href = e.login_url; a.hidden = false; } else a.hidden = true;
    } else box.hidden = true;
  }
  $('#m-login').addEventListener('click', () => Office.send({ cmd: 'login', employee: modalFor }));
  function appendChat(m) {
    const ph = chat.querySelector('.msg.tool[data-empty]'); if (ph) ph.remove();
    const d = el('div', 'msg ' + (m.channel === 'order' ? 'user' : m.channel === 'system' ? 'tool' : ''));
    d.textContent = m.text; d.appendChild(el('span', 'ts', fmt(m.ts))); chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
  }
  async function openModal(id, retry) {
    modalFor = id; modal.hidden = false; if (!retry) modalOpenedAt = Date.now(); refreshModalHead(); chat.innerHTML = '';
    if (!retry) { let want = 'term'; try { want = localStorage.getItem('office.tab') || 'term'; } catch (e) {} setTab(want); }
    else if (tab === 'term' && termFor() !== id) openTerm(id);
    // 터미널 연결은 탭이 보인 뒤(setTab 안)에서: 숨긴 채 연결하면 80×24 로 붙었다가 다시 크기를 맞추느라 화면이 두 번 그려진다
    chat.appendChild(el('div', 'msg tool', '이력 불러오는 중…'));
    try {
      const j = await api(`/api/employees/${id}/history/?limit=80`); chat.innerHTML = '';
      if (!j.items.length) { const ph = el('div', 'msg tool', '이 세션의 기록을 아직 못 읽었습니다. 첫 응답이 오면 채워집니다.'); ph.dataset.empty = '1'; chat.appendChild(ph); if (!retry) setTimeout(() => { if (modalFor === id && chat.querySelector('.msg.tool[data-empty]')) openModal(id, true); }, 2500); }
      j.items.forEach(it => {
        if (it.role === 'assistant') {
          const lines = it.text.split('\n'); const tools = lines.filter(l => l.startsWith('▸')); const text = lines.filter(l => !l.startsWith('▸')).join('\n').trim();
          if (tools.length) { const t = el('div', 'msg tool'); const det = el('details'); det.appendChild(el('summary', null, `▸ 도구 ${tools.length}회`)); det.appendChild(el('div', null, tools.join('\n'))); t.appendChild(det); chat.appendChild(t); }
          if (text) { const d = el('div', 'msg'); d.textContent = text; d.appendChild(el('span', 'ts', fmt(it.ts))); chat.appendChild(d); }
        } else { const d = el('div', 'msg user'); d.textContent = it.text; d.appendChild(el('span', 'ts', fmt(it.ts))); chat.appendChild(d); }
      });
    } catch (e) { chat.innerHTML = ''; chat.appendChild(el('div', 'msg tool', '이력 로드 실패: ' + e)); }
    chat.scrollTop = chat.scrollHeight; if (tab === 'chat') $('#m-text').focus();
    if (!retry || document.hasFocus()) {   // 자동 재열기(보고 도착)는 창이 활성일 때만 읽음 처리
      const e = Office.employees[id]; if (e) { e.unread = 0; e.last_report = null; }
      Office.send({ cmd: 'read', employee: id });
    }
    Office.emit('focus-input', true);
  }
  Office.openModal = openModal;
  let modalOpenedAt = 0;
  function closeModal() { modal.hidden = true; modalFor = null; closeTerm(); Office.emit('focus-input', false); }

  /* ---------- 터미널 탭: xterm.js ↔ /ws/term/<id>/ (pty 안의 tmux attach). CLI 그대로: 스트리밍·선택지·플랜 승인·Shift+Tab·Ctrl+C 전부 ----------
     패널(makePane) 하나 = xterm 하나 + 소켓 하나. 기본 패널 + ⌘D 분할 패널. 검색(⌘F)·글자 크기(⌘+ ⌘-)는 포커스된 패널에. */
  let tab = 'term', fontSize = 13;
  try { fontSize = +localStorage.getItem('office.font') || 13; } catch (e) {}
  const termBox = $('#m-term');
  function makePane(container, opts) {
    const pane = { id: null, ws: null, term: null, fit: null, search: null, el: container };
    const send = str => { if (pane.ws && pane.ws.readyState === 1) pane.ws.send(new TextEncoder().encode(str)); };
    pane.resize = () => {
      if (!pane.term || termBox.hidden || !container.clientHeight) return;
      try { pane.fit.fit(); } catch (e) { return; }
      if (pane.ws && pane.ws.readyState === 1) pane.ws.send(JSON.stringify({ resize: [pane.term.cols, pane.term.rows] }));
    };
    const upload = async file => {
      if (!pane.id) return;
      try { const path = await uploadFile(pane.id, file); send(path + ' '); toast('첨부: ' + path.split('/').pop()); }
      catch (e) { toast('첨부 실패: ' + e.message); }
    };
    const ensure = () => {
      if (pane.term) return pane.term;
      const t = pane.term = new Terminal({ fontFamily: '"IBM Plex Mono", Menlo, monospace', fontSize, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, macOptionIsMeta: false,
        theme: { background: '#0d1117', foreground: '#dfe5ee', cursor: '#7ea4f2', selectionBackground: 'rgba(126,164,242,.35)' } });
      pane.fit = new FitAddon.FitAddon(); t.loadAddon(pane.fit);
      try { t.loadAddon(new WebLinksAddon.WebLinksAddon((ev, uri) => window.open(uri, '_blank'))); } catch (e) {}
      try { pane.search = new SearchAddon.SearchAddon(); t.loadAddon(pane.search); } catch (e) {}
      t.open(container.querySelector('.xt'));
      // GPU 렌더러: Claude Code 는 키 하나마다 화면 전체를 다시 그려 DOM 렌더러로는 글자가 밀린다. 실패하면(WebGL 미지원·컨텍스트 유실) 기본 렌더러로.
      try { const gl = new WebglAddon.WebglAddon(); gl.onContextLoss(() => gl.dispose()); t.loadAddon(gl); } catch (e) { console.warn('webgl addon off', e); }
      t.onData(send);
      t.attachCustomKeyEventHandler(e => !(e.type === 'keydown' && isShortcut(e)));   // ⌘ 단축키는 문서 핸들러가 처리
      t.textarea.addEventListener('keydown', e => e.stopPropagation());   // 문서 Esc 핸들러·Phaser 로 새지 않게
      t.textarea.addEventListener('keyup', e => e.stopPropagation());
      t.textarea.addEventListener('focus', () => { focusedPane = pane; });
      t.textarea.addEventListener('paste', e => { const files = filesOf(e.clipboardData); if (!files.length) return; e.preventDefault(); e.stopImmediatePropagation(); files.forEach(upload); }, true);
      container.addEventListener('dragover', e => { e.preventDefault(); container.classList.add('dragover'); });
      container.addEventListener('dragleave', () => container.classList.remove('dragover'));
      container.addEventListener('drop', e => { e.preventDefault(); container.classList.remove('dragover'); [...(e.dataTransfer?.files || [])].forEach(upload); });
      new ResizeObserver(() => pane.resize()).observe(container);
      return t;
    };
    pane.open = id => {
      pane.close(); pane.id = id; const t = ensure(); pane.resize(); let fresh = true; container.classList.add('connecting');
      const ws = pane.ws = new WebSocket(window.OFFICE_WS.replace('/ws/office/', `/ws/term/${encodeURIComponent(id)}/`) + `&cols=${t.cols}&rows=${t.rows}`);
      ws.binaryType = 'arraybuffer';
      ws.onmessage = e => { if (ws !== pane.ws) return; if (fresh) { fresh = false; t.reset(); container.classList.remove('connecting'); } t.write(new Uint8Array(e.data)); };   // 첫 출력이 올 때 교체: 빈 화면 깜빡임 없음
      ws.onopen = () => { pane.resize(); if (opts.autofocus && tab === 'term' && !modal.hidden) t.focus(); };
      ws.onclose = ev => { if (ws !== pane.ws) return; container.classList.remove('connecting'); t.write(`\r\n\x1b[90m[터미널 연결 끊김${ev.code === 4404 ? ': 세션 창이 없습니다' : ''}]\x1b[0m\r\n`); };
      if (opts.onOpen) opts.onOpen(id);
    };
    pane.close = () => { if (pane.ws) { const w = pane.ws; pane.ws = null; try { w.close(); } catch (e) {} } pane.id = null; };
    pane.focus = () => { if (pane.term) pane.term.focus(); };
    pane.setFont = px => { if (pane.term) { pane.term.options.fontSize = px; pane.resize(); } };
    return pane;
  }
  const mainPane = makePane($('#m-pane-main'), { autofocus: true });
  const splitSel = $('#m-split-sel');
  function fillSplitSel(cur) {
    splitSel.innerHTML = '';
    instOrder().filter(x => x !== mainPane.id).forEach(id => { const o = el('option', null, `${name(id)} · ${id}`); o.value = id; splitSel.appendChild(o); });
    if (cur) splitSel.value = cur;
  }
  const splitPane = makePane($('#m-pane-split'), { autofocus: false, onOpen: id => fillSplitSel(id) });
  splitSel.addEventListener('change', () => { if (splitSel.value && splitSel.value !== splitPane.id) splitPane.open(splitSel.value); });
  splitSel.addEventListener('keydown', e => e.stopPropagation());
  let focusedPane = mainPane;
  const termFor = () => mainPane.id;
  function openTerm(id) { mainPane.open(id); }
  function closeTerm() { mainPane.close(); closeSplit(); }
  function termResize() { mainPane.resize(); splitPane.resize(); }
  /* 분할 (⌘D): 오른쪽에 다른 직원 터미널. 드롭다운으로 직원 바꾸기, ✕ 또는 ⌘D 로 닫기 */
  function openSplit(id) {
    if (!id) { const ids = instOrder().filter(x => x !== mainPane.id); if (!ids.length) { toast('분할할 다른 직원이 없습니다'); return; } id = ids[(ids.indexOf(splitPane.id) + 1) % ids.length]; }
    termBox.classList.add('split'); splitPane.el.hidden = false; divider.hidden = false; applySplit(splitRatio()); splitPane.open(id); termResize();
  }
  function closeSplit() { if (splitPane.el.hidden) return; splitPane.close(); splitPane.el.hidden = true; divider.hidden = true; mainPane.el.style.flex = ''; termBox.classList.remove('split'); focusedPane = mainPane; termResize(); mainPane.focus(); }
  /* 분할 너비: 손잡이(#m-divider)를 끌면 왼쪽 비율이 바뀌고 기억된다. 더블클릭 = 반반. 끄는 동안은 xterm 이 포인터를 못 잡게 pane 에 pointer-events 를 끈다 */
  const divider = $('#m-divider');
  const splitRatio = () => { try { const v = parseFloat(localStorage.getItem('office.split')); return v >= 0.2 && v <= 0.8 ? v : 0.5; } catch (e) { return 0.5; } };
  function applySplit(r) { mainPane.el.style.flex = `0 0 calc(${(r * 100).toFixed(1)}% - 7px)`; }
  divider.addEventListener('pointerdown', e => {
    e.preventDefault(); try { divider.setPointerCapture(e.pointerId); } catch (err) {} termBox.classList.add('dragging');
    const rect = termBox.getBoundingClientRect(); let r = splitRatio();
    const move = ev => { r = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width)); applySplit(r); };
    const up = () => { divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', up); termBox.classList.remove('dragging'); try { localStorage.setItem('office.split', r.toFixed(3)); } catch (e2) {} termResize(); };
    divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', up);
  });
  divider.addEventListener('dblclick', () => { try { localStorage.removeItem('office.split'); } catch (e) {} applySplit(0.5); termResize(); });
  function toggleSplit() { if (splitPane.el.hidden) openSplit(); else closeSplit(); }
  $('#m-split-close').addEventListener('click', closeSplit);
  /* 검색 (⌘F): 포커스된 패널에서. Enter 다음, Shift+Enter 이전, Esc 닫기 */
  const sbar = $('#m-search'), sinput = $('#m-search-q');
  function openSearch() { sbar.hidden = false; sinput.focus(); sinput.select(); }
  function closeSearch() { sbar.hidden = true; const p = focusedPane; if (p.search) p.search.clearDecorations(); p.focus(); }
  function doSearch(dir) { const p = focusedPane; if (!p.search || !sinput.value) return; const o = { caseSensitive: false, decorations: { matchBackground: '#5a4a00', activeMatchBackground: '#a07a00', matchOverviewRuler: '#a07a00', activeMatchColorOverviewRuler: '#ffd54a' } }; const ok = dir < 0 ? p.search.findPrevious(sinput.value, o) : p.search.findNext(sinput.value, o); sinput.classList.toggle('miss', !ok); }
  sinput.addEventListener('input', () => doSearch(1));
  sinput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); doSearch(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); } });
  $('#m-search-prev').addEventListener('click', () => doSearch(-1)); $('#m-search-next').addEventListener('click', () => doSearch(1)); $('#m-search-x').addEventListener('click', closeSearch);
  /* 글자 크기 (⌘+ ⌘-): 두 패널 공통, 기억 */
  function setFont(px) { fontSize = Math.max(9, Math.min(24, px)); try { localStorage.setItem('office.font', fontSize); } catch (e) {} mainPane.setFont(fontSize); splitPane.setFont(fontSize); toast(`터미널 글자 ${fontSize}px`); }
  function setTab(which) {
    tab = which; const isT = which === 'term';
    $('#m-tab-term').classList.toggle('on', isT); $('#m-tab-chat').classList.toggle('on', !isT);
    termBox.hidden = !isT; chat.hidden = isT; $('#m-form').hidden = isT;
    try { localStorage.setItem('office.tab', which); } catch (e) {}
    showPending();
    if (isT) { termResize(); if (modalFor && termFor() !== modalFor) openTerm(modalFor); mainPane.focus(); } else $('#m-text').focus();
  }
  $('#m-tab-term').addEventListener('click', () => setTab('term'));
  $('#m-tab-chat').addEventListener('click', () => setTab('chat'));
  window.addEventListener('resize', termResize);
  window.addEventListener('pagehide', closeTerm);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => termResize());   // 폰트 로드 뒤 글자폭이 바뀌면 다시 맞춤

  /* ---------- 단축키 (cmux 식): ⌘⇧U 다음 확인할 것 · ⌘[ ⌘] 이전/다음 · ⌘⇧I 탭 전환 · ⌘. 닫기 · ⌘/ 목록. ⌘숫자는 크롬 탭 전환이라 안 쓴다 ---------- */
  const isShortcut = e => e.metaKey && !e.ctrlKey && !e.altKey && (['Period', 'Slash', 'BracketLeft', 'BracketRight', 'KeyD', 'KeyF', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(e.code) || (e.shiftKey && (e.code === 'KeyU' || e.code === 'KeyI')));
  const instOrder = () => { const out = []; Office.templates.forEach(t => Object.values(Office.employees).filter(e => e.template === t.id && Office.present(e.id)).sort((a, b) => a.no - b.no).forEach(e => out.push(e.id))); return out; };
  const nextTodo = () => { const es = Object.values(Office.employees); const by = e => e.since || e.status_since || 0; const ask = es.filter(e => e.status === 'needs_input' || e.status === 'error').sort((a, b) => by(a) - by(b)); const done = es.filter(e => e.status === 'done' || (e.unread || 0) > 0).sort((a, b) => by(a) - by(b)); return ask[0] || done[0]; };
  document.addEventListener('keydown', e => {
    if (!isShortcut(e)) return;
    e.preventDefault(); e.stopPropagation();
    const termShown = modalFor && tab === 'term' && !modal.hidden;
    if (e.code === 'KeyD') { if (termShown) toggleSplit(); return; }
    if (e.code === 'KeyF') { if (termShown) openSearch(); return; }
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { if (termShown) setFont(fontSize + 1); return; }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') { if (termShown) setFont(fontSize - 1); return; }
    const ids = instOrder();
    if (e.code === 'Period') { closeAll(); return; }
    if (e.code === 'Slash') { if ($('#keysbox').hidden) keysM.open(); else keysM.close(); return; }
    if (e.shiftKey && e.code === 'KeyU') { const t = nextTodo(); if (t) openModal(t.id); else toast('확인할 것이 없습니다'); return; }
    if (e.shiftKey && e.code === 'KeyI') { if (modalFor) setTab(tab === 'term' ? 'chat' : 'term'); return; }
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') { if (!ids.length) return; let i = ids.indexOf(modalFor); i = i < 0 ? 0 : (i + (e.code === 'BracketRight' ? 1 : -1) + ids.length) % ids.length; openModal(ids[i]); return; }
  }, true);

  /* ---------- 소리: WebAudio 로 짧은 8bit 비프 (보고 ↗ 두 음, 질문 같은 음 두 번, 오류 낮은 음 두 번) ---------- */
  let audioCtx = null;
  const soundOn = () => { try { return localStorage.getItem('office.sound') !== '0'; } catch (e) { return true; } };
  function audio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {} return audioCtx; }
  function beep(kind) {
    if (!soundOn()) return; const ac = audio(); if (!ac || ac.state !== 'running') return;
    const notes = kind === 'report' ? [[660, 0, .09], [880, .11, .16]] : kind === 'error' ? [[196, 0, .18], [196, .26, .18]] : kind === 'whip' ? [[1600, 0, .025], [240, .025, .07]] : [[740, 0, .08], [740, .16, .08]];
    notes.forEach(([f, at, dur]) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = f; o.connect(g); g.connect(ac.destination); const t0 = ac.currentTime + at; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.start(t0); o.stop(t0 + dur + 0.02); });
  }
  Office.sfx = beep;   // 맵 효과음 (채찍)
  const soundBtn = $('#sound'); const renderSound = () => soundBtn.classList.toggle('off', !soundOn());
  soundBtn.addEventListener('click', () => { try { localStorage.setItem('office.sound', soundOn() ? '0' : '1'); } catch (e) {} renderSound(); if (soundOn()) { audio(); beep('report'); } toast(soundOn() ? '소리 알림 켬' : '소리 알림 끔'); });
  renderSound();
  /* 브라우저 알림 토글: 켜면 권한 요청. 탭이 가려져 있을 때만 뜬다 (notify) */
  const notifyOn = () => { try { return localStorage.getItem('office.notify') !== '0'; } catch (e) { return true; } };
  const notifyBtn = $('#notify'); const renderNotify = () => { const granted = 'Notification' in window && Notification.permission === 'granted'; notifyBtn.classList.toggle('off', !notifyOn() || !granted); notifyBtn.title = !('Notification' in window) ? '이 브라우저는 알림을 지원하지 않습니다' : Notification.permission === 'denied' ? '브라우저 설정에서 이 사이트의 알림이 차단돼 있습니다' : notifyOn() && granted ? '브라우저 알림 켬 (탭이 가려져 있을 때 보고·질문·오류)' : '브라우저 알림 끔 · 클릭해서 켜기'; };
  notifyBtn.addEventListener('click', () => {
    if (!('Notification' in window)) return;
    if (!notifyOn() || Notification.permission !== 'granted') {
      try { localStorage.setItem('office.notify', '1'); } catch (e) {}
      // 한 번 차단(또는 두 번 닫기)했으면 크롬은 묻지 않고 바로 denied 를 돌려준다 → 주소창에서 풀어야 함
      const blockedMsg = '크롬이 이 사이트의 알림을 차단했습니다. 주소창 왼쪽 ⓘ(사이트 정보) → 알림 → 허용 뒤 새로고침';
      if (Notification.permission === 'denied') { toast(blockedMsg, 8000); renderNotify(); return; }
      Notification.requestPermission().then(p => { renderNotify(); toast(p === 'granted' ? '브라우저 알림 켬 (탭이 가려져 있을 때)' : p === 'denied' ? blockedMsg : '알림 요청을 닫았습니다. 다시 누르면 다시 묻습니다', p === 'granted' ? undefined : 8000); });
    }
    else { try { localStorage.setItem('office.notify', '0'); } catch (e) {} renderNotify(); toast('브라우저 알림 끔'); }
  });
  renderNotify();
  const keysM = makeModal($('#keysbox')); $('#keys').addEventListener('click', keysM.open); $('#k-close').addEventListener('click', keysM.close);
  document.addEventListener('pointerdown', () => audio(), { once: true, capture: true });
  $('#m-close').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal && Date.now() - modalOpenedAt > 400) closeModal(); });
  bindInput($('#m-text'), () => modalFor);
  const bindSel = (sel, cmd, getId) => $(sel).addEventListener('change', e => { const v = e.target.value; if (v && v !== '__cur' && v !== e.target.dataset.key) Office.send({ cmd, employee: getId(), value: v }); });
  bindSel('#m-mode', 'permission_mode', () => modalFor); bindSel('#m-effort', 'effort', () => modalFor); bindSel('#m-model', 'model', () => modalFor);
  bindSel('#p-model', 'model', () => plateFor); bindSel('#p-perm', 'permission_mode', () => plateFor); bindSel('#p-effort', 'effort', () => plateFor);
  /* 모델 셀렉트: 현재 세션이 쓰는 모델을 선택된 상태로 보여주고(표시명 그대로), 바꾸면 /model 전송 */
  const modelKey = m => { m = String(m || '').toLowerCase(); return m.includes('fable') ? 'fable' : m.includes('opus') ? 'opus' : m.includes('sonnet') ? 'sonnet' : m.includes('haiku') ? 'haiku' : ''; };
  function setModelSelect(sel, e) {
    const cur = Office.modelOf(e); const key = modelKey(cur);
    let opt = sel.querySelector('option[data-cur]'); if (!opt) { opt = el('option'); opt.dataset.cur = '1'; sel.insertBefore(opt, sel.firstChild); }
    opt.value = key || '__cur'; opt.textContent = cur === '기본' ? '(기본)' : cur.replace(/^claude-/, '');
    [...sel.options].forEach(o => { if (!o.dataset.cur) o.hidden = o.value === key; });   // 현재 모델과 같은 항목은 중복이라 숨김
    sel.value = opt.value; sel.dataset.key = key;
  }
  $('#m-to-term').addEventListener('click', () => setTab('term'));
  $('#m-switch').addEventListener('click', () => { const e = Office.employees[modalFor]; const t = Office.templates.find(x => x.id === e.template); if (t) openSessions(t, modalFor); });

  /* ---------- 명패 모달 ---------- */
  let plateFor = null; const plate = $('#plate');
  Office.openPlate = function (id) {
    plateFor = id; const e = Office.employees[id]; plateM.open();
    $('#p-name').textContent = e.name; $('#p-id').textContent = `${e.id} · ${e.room} · ${statusKo(e.status)} · 모델 ${Office.modelOf(e)}`;
    setModelSelect($('#p-model'), e); $('#p-perm').value = e.mode_actual || e.permission || ''; $('#p-effort').value = e.effort || '';
    $('#p-cwd').textContent = e.cwd; $('#p-sbx').textContent = e.sandbox ? '켜짐 · 작업실 밖 쓰기·외부 네트워크 차단' : '꺼짐'; $('#p-sbx').className = e.sandbox ? 'on' : ''; $('#p-attach').textContent = `office attach ${e.id}`; $('#p-ide').hidden = !Office.editor; $('#p-ide').title = Office.editor ? `${Office.editor} 로 작업 폴더 열기` : '';
    refreshPlate();
  };
  function refreshPlate() {
    if (!plateFor) return; const e = Office.employees[plateFor]; if (!e) return;
    const wt = e.worktree && e.worktree.path ? e.worktree : null; $('#p-wt-row').hidden = !wt; if (wt) $('#p-wt').textContent = `${wt.branch || wt.name} · ${wt.path}`;
    const tk = e.tasks && e.tasks.total ? e.tasks : null; const ln = e.lines && (e.lines.added || e.lines.removed) ? e.lines : null; $('#p-tasks-row').hidden = !tk && !ln;
    if (tk || ln) $('#p-tasks').textContent = [tk ? `${tk.done}/${tk.total} 완료` : '', ln ? `변경 +${ln.added} −${ln.removed}` : ''].filter(Boolean).join(' · ');
    const pct = (e.ctx && e.ctx.pct) || 0; const g = $('#p-gauge'); g.className = 'gauge' + lvl(pct, 70, 85); g.querySelector('i').style.width = pct + '%';
    $('#p-ctx-text').textContent = e.ctx && e.ctx.ctx ? `${pct}% · ${fmtTok(e.ctx.ctx)} / ${fmtTok(e.ctx.window)}` : '아직 대화 없음';
    $('#p-sess-usage').textContent = e.session_out || e.session_cost ? `출력 ${fmtTok(e.session_out || 0)} tok · ≈$${(e.session_cost || 0).toFixed(2)}${e.ctx && e.ctx.model ? ' · ' + e.ctx.model.replace('claude-', '') : ''}` : '–';
    $('#p-session').textContent = e.session_id ? e.session_id.slice(0, 8) + ` · 턴 ${e.turns}` : '(없음)';
  }
  const plateM = makeModal(plate, () => { plateFor = null; });
  $('#p-close').addEventListener('click', plateM.close);
  $('#p-look').addEventListener('click', () => { const id = plateFor; let n = 0; try { n = (+localStorage.getItem('office.look.' + id) || 0) + 1; localStorage.setItem('office.look.' + id, n); } catch (e) {} Office.emit('relook', id); });
  $('#p-restart').addEventListener('click', () => { Office.send({ cmd: 'restart', employee: plateFor }); plateM.close(); });
  $('#p-stop').addEventListener('click', function () { const id = plateFor; if (!confirmBtn(this, '퇴근 확인')) return; Office.send({ cmd: 'stop', employee: id }); plateM.close(); });
  $('#p-compact').addEventListener('click', () => Office.send({ cmd: 'compact', employee: plateFor }));
  $('#p-clear').addEventListener('click', function () { if (!confirmBtn(this, '정말 비울까요? 다시 클릭')) return; Office.send({ cmd: 'clear', employee: plateFor }); });
  $('#p-copy').addEventListener('click', () => { const t = $('#p-attach').textContent; navigator.clipboard?.writeText(t).then(() => toast('복사했습니다: ' + t)).catch(() => {}); });
  $('#p-ide').addEventListener('click', () => Office.send({ cmd: 'open_ide', employee: plateFor }));

  /* ---------- 게시판 ---------- */
  const board = $('#board');
  /* 게시판: 최근 보고를 9건씩 3×3 카드로. 카드 클릭 → 상세(전문) → ‹ 목록 */
  let bItems = [], bPage = 0;
  const PAGE = 9;
  function renderBoard() {
    const list = $('#b-list'); list.innerHTML = ''; $('#b-detail').hidden = true; list.hidden = false; $('#b-back').hidden = true; $('#b-title').textContent = '게시판';
    const pages = Math.max(1, Math.ceil(bItems.length / PAGE)); bPage = Math.min(bPage, pages - 1);
    $('#b-page').textContent = `${bPage + 1}/${pages}`; $('#b-prev').disabled = bPage === 0; $('#b-next').disabled = bPage >= pages - 1;
    const slice = bItems.slice(bPage * PAGE, bPage * PAGE + PAGE);
    if (!slice.length) { list.appendChild(el('div', 'empty', '아직 보고가 없습니다.')); return; }
    slice.forEach(rp => {
      const c = el('div', 'card' + (rp.read ? '' : ' unread')); c.style.setProperty('--team', teamColor(teamOf(rp.employee)));
      const h = el('div', 'h'); const nm = el('b', null, name(rp.employee)); nm.appendChild(el('code', null, rp.employee)); h.appendChild(nm); h.appendChild(el('span', null, fmt(rp.ts))); c.appendChild(h);
      c.appendChild(el('div', 'b', rp.summary));
      const df = (rp.meta || {}).diff; if (df && (df.n_files || df.untracked)) { const d = el('div', 'd'); d.innerHTML = `<span class="add">+${df.added}</span> <span class="del">−${df.removed}</span> · 파일 ${df.n_files}${df.untracked ? ` · 새 파일 ${df.untracked}` : ''}`; c.appendChild(d); }
      c.addEventListener('click', () => showReport(rp)); list.appendChild(c);
    });
  }
  /* 보고 상세: 본문 아래 변경 요약(보고 시점의 git diff --numstat HEAD 상위 5파일), 「IDE 에서 열기」는 editor 가 있을 때만 */
  function showReport(rp) {
    $('#b-list').hidden = true; const d = $('#b-detail'); d.hidden = false; d.style.setProperty('--team', teamColor(teamOf(rp.employee)));
    $('#b-back').hidden = false; $('#b-title').textContent = '보고'; $('#bd-name').textContent = `${name(rp.employee)} · ${rp.employee}`; $('#bd-ts').textContent = new Date(rp.ts).toLocaleString('ko-KR'); $('#bd-text').textContent = rp.summary;
    $('#bd-open').onclick = () => { boardM.close(); openModal(rp.employee); };
    const meta = rp.meta || {}; const df = meta.diff; const box = $('#bd-diff'); box.innerHTML = ''; box.hidden = !(df && (df.n_files || df.untracked));
    if (!box.hidden) {
      const h = el('div'); h.innerHTML = `<b>변경 (보고 시점)</b><span class="add">+${df.added}</span><span class="del">−${df.removed}</span><span>파일 ${df.n_files}${df.untracked ? ` · 새 파일 ${df.untracked}` : ''}${df.n_files > (df.files || []).length ? ' · 상위 ' + df.files.length : ''}</span>`; box.appendChild(h);
      (df.files || []).forEach(f => { const r = el('div'); r.innerHTML = `<span title="${f.file}">${f.file}</span><span class="add">+${f.added}</span><span class="del">−${f.removed}</span>`; box.appendChild(r); });
    }
    const ide = $('#bd-ide'); ide.hidden = !Office.editor; ide.title = Office.editor ? `${Office.editor} 로 ${meta.cwd || '작업 폴더'} 열기` : '';
    ide.onclick = () => Office.send({ cmd: 'open_ide', employee: rp.employee, path: meta.cwd || '' });
  }
  Office.openBoard = async function () {
    boardM.open(); bPage = 0; renderBoard();
    try { bItems = (await api('/api/reports/')).items || []; } catch (e) { bItems = []; }
    renderBoard();
  };
  const boardM = makeModal(board);
  $('#b-close').addEventListener('click', boardM.close); $('#b-back').addEventListener('click', renderBoard);
  $('#b-prev').addEventListener('click', () => { bPage = Math.max(0, bPage - 1); renderBoard(); }); $('#b-next').addEventListener('click', () => { bPage += 1; renderBoard(); });
  $('#c-unread-wrap').addEventListener('click', Office.openBoard);
  $('#c-ask-wrap').addEventListener('click', () => { const t = nextTodo(); if (t) openModal(t.id); });

  /* ---------- 알림 ---------- */
  function notify(title, body, id) {
    if (document.visibilityState === 'visible' || !notifyOn()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, tag: id ? 'office-' + id : undefined });   // 같은 직원 알림은 교체
    n.onclick = () => { window.focus(); n.close(); if (id && Office.employees[id]) openModal(id); };
  }

  function closeAll() { closeModal(); [plateM, boardM, usageM, sessM, tplM, guideM, keysM].forEach(m => m.close()); Office.emit('focus-input', false); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
  $('#clock').textContent = fmt();
  connect();
})();
