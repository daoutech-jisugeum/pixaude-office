(function () {
  const W = 640, H = 400, WALL = 3, TOP = 14, DOOR = 22;
  const CORR = { y: 104, h: 30 };                 // 복도 띠
  const X = window.PX, PAL = X.P;   // sprites.js: Endesga 32 팔레트 + 스프라이트 데이터 + paint()
  const C = { text: '#ffffff', ok: PAL.lime };
  /* ---------- 직원 외모: 직원 id 를 시드로 부품(머리·옷·액세서리·특징)을 조합. 같은 직원은 늘 같은 얼굴 ---------- */
  const hashStr = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const SKINS = [PAL.cream, PAL.peach, PAL.tan, PAL.clay];
  const HAIRS = [PAL.ink, PAL.bark, PAL.cocoa, PAL.rust, PAL.gold, PAL.plum, PAL.navy, PAL.cloud];
  function describe(id, teamHex) {
    let off = 0; try { off = +localStorage.getItem('office.look.' + id) || 0; } catch (e) {}
    const r = rng(hashStr(id) + off * 7919);
    const pick = arr => arr[Math.floor(r() * arr.length)];
    const look = {
      skin: pick(SKINS), hair: pick(HAIRS), hairStyle: Math.floor(r() * 6), outfit: Math.floor(r() * 3),
      shirt: X.nearest(teamHex || '#7ea4f2'), dy: r() < 0.35 ? -1 : 0, acc: [], feature: r() < 0.3 ? Math.floor(r() * 3) : -1,
    };
    if (r() < 0.65) look.acc.push(Math.floor(r() * 8));
    if (r() < 0.25) { const a = Math.floor(r() * 8); if (!look.acc.includes(a) && !(a <= 1 && look.acc.some(x => x <= 1)) && !(a >= 3 && a <= 5 && look.acc.some(x => x >= 3 && x <= 5))) look.acc.push(a); }
    if (look.hairStyle === 5 && look.acc.some(x => x === 5)) look.acc = look.acc.filter(x => x !== 5);   // 대머리 + 고양이귀 조합은 어색
    if (look.acc.some(x => x === 3 || x === 4) && look.hairStyle === 3) look.hairStyle = 0;             // 모자 + 뾰족머리는 뚫고 나와서
    return look;
  }
  const inRect = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  /* ---------- 레이아웃 ---------- */
  function buildLayout(employees) {
    const rooms = {}; employees.forEach(e => (rooms[e.room] ||= []).push(e));
    const names = Object.keys(rooms);
    const L = { zones: [], desks: {}, walls: [], doors: [] };
    const upper = { y: 0, h: CORR.y };
    // 위층: 대표실, 회의실, 탕비실, 게시판 (전부 문으로 드나듦)
    const uw = [150, 190, 150, 150];
    const ux = [0, 150, 340, 490];
    L.zones.push({ x: ux[0], y: upper.y, w: uw[0], h: upper.h, label: '대표실', floor: 'wood', side: 'bottom' });
    L.zones.push({ x: ux[1], y: upper.y, w: uw[1], h: upper.h, label: '회의실', floor: 'carpet', side: 'bottom' });
    L.zones.push({ x: ux[2], y: upper.y, w: uw[2], h: upper.h, label: '탕비실', floor: 'tile', side: 'bottom' });
    L.zones.push({ x: ux[3], y: upper.y, w: uw[3], h: upper.h, label: '게시판', floor: 'rug', side: 'bottom' });
    L.meeting = { x: ux[1], y: 0, w: uw[1], h: upper.h, table: { x: ux[1] + 64, y: 42, w: 62, h: 26 }, seats: [[ux[1] + 50, 46], [ux[1] + 142, 46], [ux[1] + 78, 26], [ux[1] + 112, 26], [ux[1] + 78, 78], [ux[1] + 112, 78]] };
    L.pantry = { spots: [[ux[2] + 28, 66], [ux[2] + 58, 66], [ux[2] + 88, 66], [ux[2] + 118, 66]] };
    L.boardRect = { x: ux[3] + 22, y: 28, w: 106, h: 48 };
    // 아래층: 방 한 줄
    const by = CORR.y + CORR.h, bh = H - by;
    if (!names.length) names.push('빈 사무실 (출근 관리에서 출근시키세요)'), rooms[names[0]] = [];
    const DX = 66, DY = 70, ROWS = Math.max(1, Math.floor((bh - 40) / DY));   // 책상 간격, 방당 최대 줄 수
    // 방마다 필요한 열 수 → 너비. 남는 폭은 나눠 갖고, 넘치면 비례 축소(1열 폭은 보장)
    const cols = names.map(rn => Math.max(1, Math.ceil(rooms[rn].length / ROWS)));
    let widths = cols.map(c => c * DX + 18);
    const total = widths.reduce((a, b) => a + b, 0);
    if (total < W) { const extra = (W - total) / names.length; widths = widths.map(w => w + extra); }
    else if (total > W) { const k = W / total; widths = widths.map(w => Math.max(DX + 18, Math.floor(w * k))); }
    let cx = 0;
    names.forEach((rn, i) => {
      const x = Math.round(cx), w = i === names.length - 1 ? W - x : Math.round(widths[i]); cx += widths[i];
      L.zones.push({ x, y: by, w, h: bh, label: rn, floor: 'wood', side: 'top' });
      const per = Math.max(1, Math.floor((w - 14) / DX));
      const sorted = rooms[rn].slice().sort((a, b) => (a.template === b.template ? (a.no || 0) - (b.no || 0) : a.template < b.template ? -1 : 1));
      sorted.forEach((e, j) => {
        const dx = x + 9 + (j % per) * DX, dy = by + 32 + Math.floor(j / per) * DY;
        L.desks[e.id] = { x: dx, y: dy, seat: [dx + 21, dy + 24], zone: L.zones[L.zones.length - 1] };
      });
    });
    // 벽/문 계산
    L.zones.forEach(z => {
      z.doorX = z.x + DOOR / 2 + 6;   // 문은 왼쪽 끝(입구에서 가까워 출근 걸음이 짧다). 아래층 방 이름은 문 오른쪽에 적는다 (2026-10-27, 전엔 오른쪽 끝)
      const doorRect = z.side === 'bottom'
        ? { x: z.doorX - DOOR / 2, y: z.y + z.h - WALL - 1, w: DOOR, h: WALL + 2 }
        : { x: z.doorX - DOOR / 2, y: z.y, w: DOOR, h: TOP + 1 };
      z.door = doorRect;
      z.doorOut = z.side === 'bottom' ? [z.doorX, z.y + z.h + 8] : [z.doorX, z.y - 8];   // 복도 쪽 바로 앞
      z.doorIn = z.side === 'bottom' ? [z.doorX, z.y + z.h - 12] : [z.doorX, z.y + TOP + 8]; // 방 안쪽 바로 앞
      L.walls.push({ x: z.x, y: z.y, w: z.w, h: TOP, zone: z });                     // 위 벽(두꺼움)
      L.walls.push({ x: z.x, y: z.y, w: WALL, h: z.h }, { x: z.x + z.w - WALL, y: z.y, w: WALL, h: z.h });
      L.walls.push({ x: z.x, y: z.y + z.h - WALL, w: z.w, h: WALL });  // 아래 벽
      L.doors.push(doorRect);
    });
    L.entrance = { x: 0, y: CORR.y + 4, w: 5, h: CORR.h - 8, out: [-14, CORR.y + CORR.h / 2 + 4] };   // 사무실 입구: 복도 왼쪽 끝 문. 새로 출근한 직원은 여기로 들어온다
    L.spawn = [66, 92];   // 대표실 책상 앞
    L.folderPile = [92, 56];     // 책상 위 서류철 더미 위치
    return L;
  }

  /* ---------- 씬 ---------- */
  class OfficeScene extends Phaser.Scene {
    constructor() { super('office'); this.chars = {}; this.layout = null; this.inputFocused = false; this.target = null; }
    create() {
      window.OfficeScene = this;  // 디버그/테스트용 핸들
      this.gfx = this.add.graphics().setDepth(0);     // 바닥·벽
      this.deco = this.add.graphics().setDepth(1);    // 가구
      this.deskG = this.add.graphics().setDepth(1);   // 책상 (상태에 따라 다시 그림)
      this.labels = this.add.group();
      window.__scene = this;   // verify-ui(헤드리스 Chrome) 에서 방향·연출을 직접 확인하는 용도. 앱 로직은 쓰지 않는다
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D');
      this.input.keyboard.clearCaptures();   // 입력창에서 방향키·WASD·Enter 가 막히지 않도록 preventDefault 해제
      this.input.keyboard.disableGlobalCapture();
      this.input.keyboard.on('keydown-ENTER', () => { if (this.inputFocused) return; if (window.Office.near) window.Office.openModal(window.Office.near); else if (this.nearDesk) window.Office.openBoard(); });
      this.input.keyboard.on('keydown-SPACE', ev => { if (this.inputFocused) return; ev.preventDefault(); this.crackWhip(); });   // 스페이스: 채찍질
      this.input.on('pointerdown', (p, over) => { if (over.length) return; this.target = [p.worldX, p.worldY]; });
      this.player = this.makeChar({ hair: PAL.ink, skin: PAL.cream, shirt: PAL.peach, hat: 'drill', whip: true, uniform: true, hairStyle: 4 }, 20).setVisible(false);   // 첫 스냅샷 전엔 숨김 (0,0 에 깜빡이지 않게)
      const O = window.Office;
      O.on('snapshot', s => this.rebuild(s));
      O.on('templates', () => this.drawDesks());
      O.on('status', p => { this.applyStatus(p.id); this.syncHelpers(p.id); });
      O.on('activity', p => this.bubble(p.id, p.summary, 2500));
      O.on('report', p => { this.bubble(p.id, '! 끝났습니다', 4000); this.flashBoard(); this.drawFolders(window.Office.unread || 0); });   // 자리에서 ! 만. 배달 연출은 뺐다 (2026-10-27)
      O.on('unread', n => this.drawFolders(n));
      O.on('meeting.start', p => this.meetingStart(p));
      O.on('meeting.turn', p => this.bubble(p.from, p.text, 3500));
      O.on('meeting.end', p => this.meetingEnd(p));
      O.on('pantry.visit', p => this.pantryVisit(p.id));
      O.on('pantry.done', p => this.pantryDone(p.id));
      O.on('focus-input', f => { this.inputFocused = f; });
      O.on('presence', () => this.rebuild({}, true));   // 출근/퇴근 → 자리 생성/제거. 새 직원은 입구 문으로 걸어 들어온다
      O.on('relook', id => { const c = this.chars[id]; if (c) { c.destroy(); delete this.chars[id]; } this.rebuild({}); });   // 🎲 외모 바꾸기
      O.on('usage', p => { Object.entries(p.employees || {}).forEach(([id, u]) => { const c = this.chars[id]; if (c) this.setGauge(c, (u.ctx && u.ctx.pct) || 0); }); this.drawDesks(); const brKey = Object.values(window.Office.employees).map(e => e.room + ':' + (e.branch || '')).sort().join('|'); if (brKey !== this._brKey) { this._brKey = brKey; this.drawMap(); } });
      O.on('tick', p => this.setLighting(p.period));
      O.on('sky', sky => this.setSky(sky));   // 대표실 창문: 날씨·낮밤 (장식)
      this.tint = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0).setDepth(25);
      this.setLighting(document.getElementById('period') && document.getElementById('period').textContent);
      if (Object.keys(O.employees).length) this.rebuild({ employees: Object.values(O.employees) });
    }

    /* 픽셀 폰트 텍스트: 브라우저가 잰 글꼴 높이가 10.8px 같은 소수라 텍스처(정수)와 표시 높이가 어긋나 글자가 번진다 → 정수 metrics 로 고정 */
    text(x, y, str, style) {
      const m = style && style.fontFamily === 'Galmuri11' ? { ascent: 13, descent: 2, fontSize: 15 } : { ascent: 10, descent: 1, fontSize: 11 };
      return this.add.text(x, y, str, Object.assign({ metrics: m }, style));
    }
    /* ---------- 맵 ---------- */
    rebuild(snap, enter) {
      const emps = (snap.employees || Object.values(window.Office.employees)).filter(e => window.Office.present(e.id));
      // 퇴근 중(걸어 나가는 중)인 직원의 책상은 캐릭터가 사라질 때까지 남긴다 → 레이아웃엔 포함, 캐릭터 배치는 건너뜀
      // employee.remove 는 away 를 거치지 않고 바로 오므로, 아직 leaving 표시가 없어도 '더는 없는 직원'의 캐릭터는 전부 퇴근 중으로 본다
      const leaving = Object.values(this.chars).filter(c => c.empData && !emps.find(e => e.id === c.empId)).map(c => c.empData);
      this.layout = buildLayout(emps.concat(leaving));
      this.drawMap(); this.drawDesks();   // 책상은 바로 생긴다. 사람은 (출근 연출이면) 입구에서 걸어온다
      const arriving = [];
      emps.forEach((e, i) => {
        const isNew = !this.chars[e.id];
        if (isNew) { const hex = window.Office.teamColor ? window.Office.teamColor(e.template) : '#7ea4f2'; this.chars[e.id] = this.makeChar(describe(e.id, hex), 10); this.chars[e.id].teamColor = parseInt(hex.slice(1), 16); }
        const ch = this.chars[e.id]; ch.empId = e.id; ch.empData = e;
        const d = this.layout.desks[e.id]; ch.home = d.seat; ch.zone = d.zone;
        if (isNew && enter && this.spawned) { ch.entering = true; arriving.push(ch); } else if (!ch.entering) ch.setPosition(d.seat[0], d.seat[1]);
        this.applyStatus(e.id, true);
        if (e.pantry && !ch.entering) this.toPantrySpot(e.id, true);
      });
      arriving.forEach((ch, i) => this.enterOffice(ch, i * 500));
      Object.keys(this.chars).forEach(id => { if (!emps.find(e => e.id === id)) { const c = this.chars[id]; if (c.leaving) return; this.leaveOffice(c); } });   // 퇴근: 바로 지우지 않고 입구로 걸어 나간 뒤 사라진다
      emps.forEach(e => this.syncHelpers(e.id));
      if (!this.spawned) { this.player.setPosition(...this.layout.spawn); this.player.fx = this.player.x; this.player.fy = this.player.y; this.spawned = true; this.player.setVisible(true); document.getElementById('game').classList.add('ready'); } else if (this.blocked(this.player.x, this.player.y + 6)) { this.player.setPosition(...this.layout.spawn); this.player.fx = this.player.x; this.player.fy = this.player.y; } this.target = null;
      Object.entries(window.Office.meetings || {}).forEach(([id, parts]) => this.meetingStart({ id, participants: parts }));
      this.drawFolders(window.Office.unread || 0);
      if (!this.mascot) this.mascot = this.makeMascot();
      if (this.blocked(this.mascot.x, this.mascot.y + 4)) this.mascot.setPosition(...this.layout.pantry.spots[3]);
    }
    /* ---------- 부하(서브에이전트): 직원 책상 옆에 작은 조수들. SubagentStart/Stop 으로 늘고 줄고, 턴이 끝나면 사라진다 ---------- */
    syncHelpers(id) {
      const c = this.chars[id], e = window.Office.employees[id]; if (!c || !e) return;
      const want = (e.subagents || []).length; c.helpers = c.helpers || [];
      while (c.helpers.length > want) c.helpers.pop().destroy();
      while (c.helpers.length < want) {
        const i = c.helpers.length; const h = this.add.container(0, 0).setDepth(10); const g = this.add.graphics(); h.add(g);
        const team = X.ramp(c.teamColor || 0x7ea4f2);
        X.paint(g, X.HELPER, { O: team.ol, S: PAL.peach, K: PAL.ink, B: team.base }, -4, -8);
        const off = [[-16, 6], [16, 6], [-16, 14], [16, 14], [-24, 10], [24, 10], [0, 16], [-8, 18]][i % 8];
        h.setPosition(c.home[0] + off[0], c.home[1] + off[1]); h.setDepth(10 + h.y / 1000); h.bob = this.tweens.add({ targets: h, y: h.y - 1, duration: 350 + i * 40, yoyo: true, repeat: -1 });
        c.helpers.push(h);
      }
    }
    /* ---------- 보고 서류철: 대표실 책상 위 더미 = 미확인 보고 수 (보고가 오면 바로 쌓인다) ---------- */
    drawFolders(n) {
      if (!this.folderG) { this.folderG = this.add.graphics().setDepth(2); this.folderT = this.text(0, 0, '', { fontFamily: 'Galmuri9', fontSize: '9px', color: X.hex(PAL.ink) }).setDepth(2).setVisible(false); }
      const g = this.folderG, [x, y] = this.layout.folderPile; g.clear();
      for (let i = 0; i < Math.min(n, 6); i++) X.paint(g, X.FOLDER, X.FOLDER_LEGEND, x, y - i * 2);
      this.folderT.setVisible(n > 6).setPosition(x + 12, y - 14).setText(n > 6 ? String(n) : '');
    }
    /* ---------- 마스코트: 하늘색 토끼 후드를 쓴 흰 얼굴 친구. 돌아다니다 탕비실 소파에서 잔다 (세션과 무관한 장식) ---------- */
    makeMascot() {
      const c = this.add.container(0, 0).setDepth(10); const g = this.add.graphics(); c.add(g); c.body_ = g;
      c.zz = this.text(7, -18, 'z', { fontFamily: 'Galmuri9', fontSize: '9px', color: X.hex(PAL.sky) }).setVisible(false); c.add(c.zz);
      c.bubG = this.add.graphics().setVisible(false); c.add(c.bubG);
      c.say = this.text(0, -19, '', { fontFamily: 'Galmuri9', fontSize: '9px', color: X.hex(PAL.ink) }).setPadding(2, 1, 2, 1).setOrigin(0.5, 1).setVisible(false); c.add(c.say);
      c.setPosition(...this.layout.pantry.spots[3]); c.mode = 'sleep'; c.until = this.time.now + 20000; c.frame = 0; c.hops = 0;
      this.drawMascot(c, 'sleep', 0); return c;
    }
    drawMascot(c, mode, f) {
      const g = c.body_; g.clear();
      X.paint(g, X.SHADOW, { s: [PAL.ink, 0.25] }, -6, 3);
      const rows = X.MASCOT[mode === 'sleep' ? 'sleep' : 'roam'];
      X.paint(g, rows, X.MASCOT_LEGEND, -6, 5 - rows.length - (mode === 'sleep' ? 0 : f));   // 걸을 땐 한 프레임씩 1px 통통
    }
    mascotTick() {
      const m = this.mascot; if (!m || !this.layout) return; const now = this.time.now, P = this.player;
      const near = Phaser.Math.Distance.Between(m.x, m.y, P.x, P.y) < 26;
      if (m.mode === 'sleep') {
        m.zz.setVisible(Math.floor(now / 700) % 2 === 0);
        if (near && !m.greeted) { m.greeted = true; m.mode = 'roam'; m.hops = 0; m.until = now; m.zz.setVisible(false); this.mascotSay(m, '냐…?'); }
        else if (now > m.until) { m.mode = 'roam'; m.hops = 0; m.until = now; m.zz.setVisible(false); this.drawMascot(m, 'roam', 0); }
        return;
      }
      if (!near) m.greeted = false; else if (!m.greeted) { m.greeted = true; this.mascotSay(m, ['야옹', '냐~', '냥!', '골골…'][Math.floor(Math.random() * 4)]); }
      if (m.walkTween) { const f = Math.floor(now / 250) % 2; if (f !== m.frame) { m.frame = f; this.drawMascot(m, 'roam', f); } m.setDepth(10 + m.y / 1000); return; }
      if (now < m.until) return;
      if (m.hops >= 3 + Math.floor(Math.random() * 4)) {   // 충분히 돌아다녔으면 소파로 가서 잔다
        const sp = this.layout.pantry.spots[3]; this.walkPath(m, this.route([m.x, m.y], [sp[0] + 10, sp[1]]), () => { m.mode = 'sleep'; m.until = this.time.now + 60000 + Math.random() * 120000; this.drawMascot(m, 'sleep', 0); });
        m.hops = 0; return;
      }
      // 복도나 방 안 무작위 지점 (막힌 곳이면 다시 뽑음)
      for (let i = 0; i < 12; i++) {
        const z = this.layout.zones[Math.floor(Math.random() * this.layout.zones.length)];
        const x = Math.round(z.x + 14 + Math.random() * (z.w - 28)), y = Math.round(z.y + 26 + Math.random() * Math.max(8, z.h - 40));
        if (this.blocked(x, y + 4)) continue;
        m.hops++; m.until = now + 2500 + Math.random() * 5000;
        const pts = this.route([m.x, m.y], [x, y]); let j = 0;
        const step = () => { if (j >= pts.length) { m.walkTween = null; this.drawMascot(m, 'roam', 0); return; } const [tx, ty] = pts[j++]; const d = Phaser.Math.Distance.Between(m.x, m.y, tx, ty); m.walkTween = this.tweens.add({ targets: m, x: tx, y: ty, duration: Math.max(200, d * 40), ease: 'Linear', onComplete: step }); };
        step(); return;
      }
    }
    mascotSay(m, text) { m.say.setText(text).setVisible(true); this.drawBubbleBox(m.bubG, m.say); if (m.sayTimer) m.sayTimer.remove(); m.sayTimer = this.time.delayedCall(1500, () => { m.say.setVisible(false); m.bubG.setVisible(false); }); }
    drawMap() {
      const g = this.gfx, d = this.deco, L = this.layout; g.clear(); d.clear();
      this.labels.clear(true, true);
      if (this.boardZone) { this.boardZone.destroy(); this.boardGlow.destroy(); }
      const T = 16;
      // 복도: 두 톤 체크 (8px)
      for (let y = CORR.y; y < CORR.y + CORR.h; y += 8) for (let x = 0; x < W; x += 8) g.fillStyle(((x + y) / 8) % 2 ? PAL.steel : PAL.cloud, 1).fillRect(x, y, 8, 8);
      // 방 바닥: 16px 격자 두 톤 + 가끔 1px 액센트
      L.zones.forEach(z => {
        for (let y = z.y; y < z.y + z.h; y += T) for (let x = z.x; x < z.x + z.w; x += T) {
          const i = (Math.floor(x / T) + Math.floor(y / T)) % 2;
          if (z.floor === 'carpet') { g.fillStyle(PAL.slate, 1).fillRect(x, y, T, T); g.fillStyle(PAL.dusk, 1).fillRect(x + (i ? 4 : 12), y + 4, 1, 1).fillRect(x + (i ? 12 : 4), y + 12, 1, 1); g.fillStyle(PAL.steel, 1).fillRect(x + 8, y + 8, 1, 1); }
          else if (z.floor === 'tile') { g.fillStyle(i ? PAL.cloud : PAL.white, 1).fillRect(x, y, T, T); g.fillStyle(PAL.steel, 1).fillRect(x, y + T - 1, T, 1).fillRect(x + T - 1, y, 1, T); }
          else if (z.floor === 'rug') { g.fillStyle(PAL.cocoa, 1).fillRect(x, y, T, T); g.fillStyle(PAL.bark, 1).fillRect(x, y, T, 1).fillRect(x, y, 1, T); g.fillStyle(PAL.rust, 1).fillRect(x + 7, y + 7, 2, 2); }
          else { g.fillStyle(PAL.clay, 1).fillRect(x, y, T, T); g.fillStyle(PAL.brown, 1).fillRect(x, y + T - 1, T, 1).fillRect(x + (i ? 3 : 11), y, 1, T - 1); g.fillStyle(PAL.peach, 1).fillRect(x + (i ? 5 : 13), y + 2, 1, 4); }   // 나무 판자
        }
      });
      // 벽: 윗면 어두운 띠 2px · 밝은 선 · 벽면 · 굽도리. 옆·아래 벽(3px)은 어두운 색 + 안쪽 밝은 선
      L.walls.forEach(w => {
        if (w.zone) { g.fillStyle(PAL.night, 1).fillRect(w.x, w.y, w.w, 2); g.fillStyle(PAL.slate, 1).fillRect(w.x, w.y + 2, w.w, 1); g.fillStyle(PAL.dusk, 1).fillRect(w.x, w.y + 3, w.w, TOP - 5); g.fillStyle(PAL.night, 1).fillRect(w.x, w.y + TOP - 2, w.w, 1); g.fillStyle(PAL.ink, 1).fillRect(w.x, w.y + TOP - 1, w.w, 1); }
        else { g.fillStyle(PAL.night, 1).fillRect(w.x, w.y, w.w, w.h); g.fillStyle(PAL.dusk, 1).fillRect(w.x + (w.w > w.h ? 0 : 1), w.y + (w.w > w.h ? 1 : 0), w.w > w.h ? w.w : 1, w.w > w.h ? 1 : w.h); }
      });
      // 문: 벽을 비우고 문틀 + 발매트
      L.doors.forEach(dr => {
        if (dr.h > 6) {   // 아래층 방: 위쪽 벽면에 진짜 문짝 (문틀 + 나무 문 + 패널 2장 + 손잡이) 과 문 앞 매트
          g.fillStyle(PAL.bark, 1).fillRect(dr.x - 1, dr.y + 1, dr.w + 2, dr.h - 1);
          g.fillStyle(PAL.cocoa, 1).fillRect(dr.x + 1, dr.y + 2, dr.w - 2, dr.h - 3);
          g.fillStyle(PAL.orange, 1).fillRect(dr.x + 3, dr.y + 4, dr.w - 6, 3).fillRect(dr.x + 3, dr.y + 9, dr.w - 6, 3);
          g.fillStyle(PAL.brown, 1).fillRect(dr.x + 3, dr.y + 6, dr.w - 6, 1).fillRect(dr.x + 3, dr.y + 11, dr.w - 6, 1);
          g.fillStyle(PAL.gold, 1).fillRect(dr.x + dr.w - 5, dr.y + 8, 2, 1);
          g.fillStyle(PAL.steel, 1).fillRect(dr.x + 3, dr.y + dr.h, dr.w - 6, 2); g.fillStyle(PAL.slate, 1).fillRect(dr.x + 3, dr.y + dr.h + 1, dr.w - 6, 1);
        } else {          // 위층 방: 아래쪽 얇은 벽을 트고 문턱 + 복도 쪽 매트
          g.fillStyle(PAL.cloud, 1).fillRect(dr.x, dr.y, dr.w, dr.h); g.fillStyle(PAL.bark, 1).fillRect(dr.x - 1, dr.y, 1, dr.h).fillRect(dr.x + dr.w, dr.y, 1, dr.h);
          g.fillStyle(PAL.cocoa, 1).fillRect(dr.x, dr.y + dr.h - 1, dr.w, 1);
          g.fillStyle(PAL.steel, 1).fillRect(dr.x + 3, dr.y + dr.h, dr.w - 6, 2); g.fillStyle(PAL.slate, 1).fillRect(dr.x + 3, dr.y + dr.h + 1, dr.w - 6, 1);
        }
      });
      // 입구 문 (복도 왼쪽 끝): 문짝 + 손잡이 + 발매트
      const en = L.entrance; g.fillStyle(PAL.bark, 1).fillRect(en.x, en.y - 3, en.w + 1, en.h + 6); g.fillStyle(PAL.cocoa, 1).fillRect(en.x, en.y, en.w, en.h); g.fillStyle(PAL.orange, 1).fillRect(en.x + 1, en.y + 2, en.w - 2, 4).fillRect(en.x + 1, en.y + en.h - 7, en.w - 2, 4); g.fillStyle(PAL.gold, 1).fillRect(en.x + 3, en.y + en.h / 2 - 1, 1, 2);
      g.fillStyle(PAL.slate, 1).fillRect(en.x + en.w + 1, en.y + 6, 10, en.h - 12); g.fillStyle(PAL.dusk, 1).fillRect(en.x + en.w + 2, en.y + 7, 8, 1);
      L.zones.forEach(z => {
        const occupants = Object.values(window.Office.employees).filter(e => e.room === z.label && window.Office.present(e.id));
        // 같은 방 = 같은 프로젝트 → 레포 본체의 브랜치만 방 이름 옆에. worktree 직원은 각자 임시 브랜치라 제외 (그건 명패에)
        const br = (occupants.find(e => e.branch && !e.worktree_on && !(e.worktree && e.worktree.path)) || {}).branch;
        this.labels.add(this.text(z.side === 'top' ? z.x + DOOR + 12 : z.x + 5, z.y + 1, z.label + (br ? '   ' + br : ''), { fontFamily: 'Galmuri11', fontSize: '11px', color: C.text, shadow: { offsetX: 1, offsetY: 1, color: X.hex(PAL.ink), blur: 0, fill: true } }).setPadding(0, 0, 1, 1).setDepth(2));
      });
      const pr = (rows, legend, x, y) => X.paint(d, rows, legend, x, y);
      // 대표실: 러그, 창문, 책장, 집무 책상, 가죽 의자, 손님 의자, 꽃화분, 스탠드
      d.fillStyle(PAL.wine, 1).fillRect(14, 36, 122, 62); d.fillStyle(PAL.red, 1).fillRect(16, 38, 118, 58); d.fillStyle(PAL.wine, 1).fillRect(20, 42, 110, 50); d.fillStyle(PAL.gold, 1).fillRect(18, 40, 114, 1).fillRect(18, 93, 114, 1).fillRect(18, 40, 1, 54).fillRect(131, 40, 1, 54);
      d.fillStyle(PAL.ink, 1).fillRect(55, 1, 42, 12); d.fillStyle(PAL.sky, 1).fillRect(56, 2, 40, 10); d.fillStyle(PAL.white, 1).fillRect(58, 3, 6, 2).fillRect(72, 5, 8, 2); d.fillStyle(PAL.ink, 1).fillRect(75, 2, 1, 10).fillRect(56, 7, 40, 1);   // 창문 + 구름
      d.fillStyle(PAL.bark, 1).fillRect(103, 13, 42, 28); d.fillStyle(PAL.cocoa, 1).fillRect(104, 14, 40, 26); d.fillStyle(PAL.orange, 1).fillRect(105, 15, 38, 1).fillRect(105, 23, 38, 1).fillRect(105, 31, 38, 1);   // 책장
      [[107, 16, PAL.red], [111, 16, PAL.blue], [115, 16, PAL.gold], [119, 16, PAL.green], [123, 16, PAL.white], [127, 16, PAL.plum], [131, 16, PAL.red], [135, 16, PAL.sky],
       [107, 24, PAL.sky], [111, 24, PAL.lemon], [115, 24, PAL.blue], [121, 24, PAL.red], [125, 24, PAL.green], [131, 24, PAL.gold], [136, 24, PAL.berry],
       [107, 32, PAL.white], [112, 32, PAL.green], [117, 32, PAL.red], [123, 32, PAL.blue], [128, 32, PAL.gold]].forEach(b => { d.fillStyle(b[2], 1).fillRect(b[0], b[1], 3, 6); d.fillStyle(PAL.ink, 1).fillRect(b[0] + 3, b[1], 1, 6); });
      d.fillStyle(PAL.ink, 1).fillRect(39, 45, 24, 12); d.fillStyle(PAL.night, 1).fillRect(40, 46, 22, 10); d.fillStyle(PAL.dusk, 1).fillRect(41, 47, 20, 2); d.fillStyle(PAL.ink, 1).fillRect(48, 57, 6, 3);   // 가죽 의자
      d.fillStyle(PAL.bark, 1).fillRect(29, 59, 72, 26); d.fillStyle(PAL.cocoa, 1).fillRect(30, 60, 70, 24); d.fillStyle(PAL.brown, 1).fillRect(30, 60, 70, 2); d.fillStyle(PAL.bark, 1).fillRect(30, 82, 70, 2);   // 집무 책상
      pr(X.MONITOR, X.MONITOR_LEGEND, 52, 61);
      d.fillStyle(PAL.gold, 1).fillRect(36, 62, 8, 4); d.fillStyle(PAL.cloud, 1).fillRect(39, 66, 2, 6); d.fillStyle(PAL.lemon, 0.3).fillRect(32, 66, 16, 8); d.fillStyle(PAL.ink, 1).fillRect(36, 61, 8, 1);   // 스탠드
      pr(X.MUG, X.MUG_LEGEND, 84, 66);
      pr(X.CHAIR, X.CHAIR_LEGEND, 36, 90); pr(X.CHAIR, X.CHAIR_LEGEND, 78, 90);   // 손님 의자
      pr(X.FLOWERS, X.FLOWERS_LEGEND, 12, 68); pr(X.FLOWERS, X.FLOWERS_LEGEND, 136, 84); pr(X.PLANT, X.PLANT_LEGEND, 8, 18);
      // 회의 테이블 + 화이트보드
      const m = L.meeting, t = m.table; d.fillStyle(PAL.cocoa, 1).fillRect(t.x - 1, t.y - 1, t.w + 2, t.h + 2); d.fillStyle(PAL.orange, 1).fillRect(t.x, t.y, t.w, t.h); d.fillStyle(PAL.tan, 1).fillRect(t.x, t.y, t.w, 2); d.fillStyle(PAL.rust, 1).fillRect(t.x, t.y + t.h - 3, t.w, 3);
      m.seats.forEach(sd => pr(X.CHAIR, X.CHAIR_LEGEND, sd[0] - 5, sd[1] + 10));
      d.fillStyle(PAL.white, 1).fillRect(t.x + 12, t.y + 6, 14, 10); d.fillStyle(PAL.cloud, 1).fillRect(t.x + 14, t.y + 8, 10, 1).fillRect(t.x + 14, t.y + 11, 8, 1).fillRect(t.x + 14, t.y + 14, 6, 1);   // 서류
      d.fillStyle(PAL.slate, 1).fillRect(m.x + 60, 2, 70, 11); d.fillStyle(PAL.white, 1).fillRect(m.x + 61, 3, 68, 9); d.fillStyle(PAL.blue, 1).fillRect(m.x + 64, 5, 20, 1).fillRect(m.x + 64, 8, 30, 1); d.fillStyle(PAL.red, 1).fillRect(m.x + 100, 5, 12, 1);   // 화이트보드
      // 탕비실: 상판(커피머신·전자레인지·과일·빵·컵), 냉장고, 선반(과자·음료), 테이블(간식), 소파
      const px = L.zones[2].x;
      d.fillStyle(PAL.slate, 1).fillRect(px + 5, 13, 140, 20); d.fillStyle(PAL.cloud, 1).fillRect(px + 6, 14, 138, 18); d.fillStyle(PAL.white, 1).fillRect(px + 6, 14, 138, 2); d.fillStyle(PAL.steel, 1).fillRect(px + 6, 30, 138, 2);
      d.fillStyle(PAL.ink, 1).fillRect(px + 11, 16, 16, 15); d.fillStyle(PAL.dusk, 1).fillRect(px + 12, 17, 14, 13); d.fillStyle(PAL.sky, 1).fillRect(px + 15, 20, 8, 4); d.fillStyle(PAL.white, 1).fillRect(px + 17, 26, 4, 3); d.fillStyle(PAL.red, 1).fillRect(px + 14, 18, 2, 1);   // 커피머신
      d.fillStyle(PAL.slate, 1).fillRect(px + 33, 14, 20, 30); d.fillStyle(PAL.white, 1).fillRect(px + 34, 15, 18, 28); d.fillStyle(PAL.cloud, 1).fillRect(px + 35, 28, 16, 1).fillRect(px + 35, 16, 16, 1); d.fillStyle(PAL.steel, 1).fillRect(px + 48, 18, 2, 6).fillRect(px + 48, 31, 2, 6);   // 냉장고
      d.fillStyle(PAL.ink, 1).fillRect(px + 57, 17, 20, 13); d.fillStyle(PAL.dusk, 1).fillRect(px + 58, 18, 18, 11); d.fillStyle(PAL.slate, 1).fillRect(px + 60, 20, 10, 7); d.fillStyle(PAL.gold, 1).fillRect(px + 72, 21, 2, 2);   // 전자레인지
      d.fillStyle(PAL.red, 1).fillRect(px + 82, 22, 5, 5); d.fillStyle(PAL.green, 1).fillRect(px + 84, 20, 1, 2); d.fillStyle(PAL.lemon, 1).fillRect(px + 89, 23, 6, 4); d.fillStyle(PAL.red, 1).fillRect(px + 97, 23, 4, 4); d.fillStyle(PAL.gold, 1).fillRect(px + 96, 21, 6, 2);   // 사과·바나나·사과
      d.fillStyle(PAL.tan, 1).fillRect(px + 106, 21, 9, 6); d.fillStyle(PAL.brown, 1).fillRect(px + 106, 24, 9, 1).fillRect(px + 106, 26, 9, 1);   // 식빵
      pr(X.MUG, X.MUG_LEGEND, px + 120, 23); pr(X.MUG, X.MUG_LEGEND, px + 127, 23);
      d.fillStyle(PAL.cocoa, 1).fillRect(px + 60, 40, 76, 3).fillRect(px + 60, 52, 76, 3); d.fillStyle(PAL.orange, 1).fillRect(px + 60, 40, 76, 1).fillRect(px + 60, 52, 76, 1);   // 벽 선반
      [[px + 63, 33, PAL.gold], [px + 70, 33, PAL.red], [px + 77, 33, PAL.sky], [px + 84, 33, PAL.lemon], [px + 91, 33, PAL.plum], [px + 98, 33, PAL.blue]].forEach(b => { d.fillStyle(PAL.ink, 1).fillRect(b[0] - 1, b[1] - 1, 7, 9); d.fillStyle(b[2], 1).fillRect(b[0], b[1], 5, 7); d.fillStyle(PAL.white, 0.5).fillRect(b[0] + 1, b[1] + 1, 3, 1); });   // 과자 봉지
      [[px + 108, 34, PAL.red], [px + 114, 34, PAL.blue], [px + 120, 34, PAL.green], [px + 126, 34, PAL.gold]].forEach(b => { d.fillStyle(b[2], 1).fillRect(b[0], b[1], 4, 6); d.fillStyle(PAL.cloud, 1).fillRect(b[0], b[1], 4, 1); });   // 캔 음료
      [[px + 64, 46, PAL.tan], [px + 72, 46, PAL.tan], [px + 80, 46, PAL.cream], [px + 88, 46, PAL.orange]].forEach(b => { d.fillStyle(b[2], 1).fillRect(b[0], b[1], 6, 5); d.fillStyle(PAL.cocoa, 1).fillRect(b[0], b[1] + 5, 6, 1); });   // 쿠키·크래커
      d.fillStyle(PAL.cloud, 1).fillRect(px + 98, 44, 3, 7).fillRect(px + 103, 44, 3, 7).fillRect(px + 108, 44, 3, 7); d.fillStyle(PAL.sky, 1).fillRect(px + 98, 47, 3, 4).fillRect(px + 103, 47, 3, 4).fillRect(px + 108, 47, 3, 4);   // 생수
      d.fillStyle(PAL.white, 1).fillRect(px + 116, 45, 7, 6); d.fillStyle(PAL.blue, 1).fillRect(px + 117, 47, 5, 2);   // 우유
      d.fillStyle(PAL.cocoa, 1).fillRect(px + 19, 79, 112, 16); d.fillStyle(PAL.orange, 1).fillRect(px + 20, 80, 110, 14); d.fillStyle(PAL.tan, 1).fillRect(px + 20, 80, 110, 2); d.fillStyle(PAL.rust, 1).fillRect(px + 20, 92, 110, 2);   // 테이블
      d.fillStyle(PAL.tan, 1).fillRect(px + 26, 74, 10, 6); d.fillStyle(PAL.pink, 1).fillRect(px + 28, 73, 6, 3); d.fillStyle(PAL.cocoa, 1).fillRect(px + 30, 76, 2, 2);   // 도넛
      d.fillStyle(PAL.tan, 1).fillRect(px + 44, 72, 14, 8); d.fillStyle(PAL.red, 1).fillRect(px + 46, 74, 10, 4); d.fillStyle(PAL.lemon, 1).fillRect(px + 47, 75, 2, 2).fillRect(px + 52, 75, 2, 2);   // 피자
      pr(X.MUG, X.MUG_LEGEND, px + 66, 75);
      d.fillStyle(PAL.tan, 1).fillRect(px + 80, 74, 12, 6); d.fillStyle(PAL.green, 1).fillRect(px + 82, 73, 8, 2); d.fillStyle(PAL.red, 1).fillRect(px + 84, 75, 4, 2);   // 샌드위치
      d.fillStyle(PAL.lemon, 1).fillRect(px + 98, 72, 7, 4).fillRect(px + 100, 70, 3, 2);   // 바나나
      d.fillStyle(PAL.sky, 1).fillRect(px + 110, 73, 8, 7); d.fillStyle(PAL.white, 1).fillRect(px + 112, 75, 4, 2);   // 도시락
      pr(X.CHAIR, X.CHAIR_LEGEND, px + 28, 95); pr(X.CHAIR, X.CHAIR_LEGEND, px + 70, 95);
      pr(X.SOFA, X.SOFA_LEGEND, L.pantry.spots[3][0] - 11, L.pantry.spots[3][1] - 1);   // 마스코트가 자는 소파
      // 게시판
      const b = L.boardRect; d.fillStyle(PAL.bark, 1).fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2); d.fillStyle(PAL.cocoa, 1).fillRect(b.x, b.y, b.w, b.h); d.fillStyle(PAL.tan, 1).fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6); d.fillStyle(PAL.clay, 1).fillRect(b.x + 3, b.y + b.h - 4, b.w - 6, 1);
      [[b.x + 10, b.y + 10, PAL.lemon], [b.x + 36, b.y + 12, PAL.sky], [b.x + 60, b.y + 9, PAL.pink], [b.x + 84, b.y + 14, PAL.lime]].forEach(n => { d.fillStyle(PAL.ink, 0.25).fillRect(n[0] + 1, n[1] + 1, 18, 16); d.fillStyle(n[2], 1).fillRect(n[0], n[1], 18, 16); d.fillStyle(PAL.slate, 0.5).fillRect(n[0] + 3, n[1] + 5, 12, 1).fillRect(n[0] + 3, n[1] + 9, 9, 1); d.fillStyle(PAL.red, 1).fillRect(n[0] + 8, n[1] - 1, 2, 2); });
      this.boardZone = this.add.zone(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h).setInteractive({ useHandCursor: true }).on('pointerdown', () => window.Office.openBoard());
      this.boardGlow = this.add.rectangle(b.x + b.w / 2, b.y + b.h / 2, b.w + 6, b.h + 6).setStrokeStyle(2, C.ok, 0).setDepth(1);
      // 식물 (아래층 방마다 오른쪽 아래)
      L.zones.slice(4).forEach(z => pr(X.PLANT, X.PLANT_LEGEND, z.x + z.w - 16, z.y + z.h - 18));
    }
    drawDesks() {
      const d = this.deskG, L = this.layout; d.clear();
      if (this.deskLabels) this.deskLabels.forEach(l => l.destroy());
      this.deskLabels = [];
      const shadow = { offsetX: 1, offsetY: 1, color: X.hex(PAL.ink), blur: 0, fill: true };
      Object.entries(L.desks).forEach(([id, dk]) => {
        const e = window.Office.employees[id], lit = e && e.status === 'done', x = dk.x, y = dk.y;
        if (lit) d.fillStyle(PAL.lime, 0.18).fillRect(x - 3, y - 3, 48, 32);
        X.paint(d, X.CHAIR, X.CHAIR_LEGEND, x + 16, y + 22);
        X.paint(d, X.DESK, X.WOOD, x, y);
        X.paint(d, X.MONITOR, lit ? X.MONITOR_DONE : X.MONITOR_LEGEND, x + 13, y + 1);
        X.paint(d, X.KEYBOARD, X.KEYBOARD_LEGEND, x + 12, y + 14);
        X.paint(d, X.MUG, X.MUG_LEGEND, x + 34, y + 9);
        const short = this.shortName(id);
        // 이름표: 픽셀 폰트(Galmuri9)를 원본 크기로 찍고 정수 배율로만 확대 → 선명. 배경 대신 1px 하드 섀도
        const lbl = this.text(x + 21, y + 32, short, { fontFamily: 'Galmuri9', fontSize: '9px', color: C.text, shadow }).setPadding(0, 0, 1, 1).setOrigin(0.5, 0).setDepth(2)
          .setInteractive({ useHandCursor: true }).on('pointerdown', () => window.Office.openPlate(id));
        const sbx = !!(e && e.sandbox), mname = (sbx ? '격리·' : '') + String(window.Office.modelOf(e || {})).replace(/^claude-/, '');   // 격리 = 샌드박스 세션 (이모지는 픽셀 폰트에서 깨짐)
        const mdl = this.text(x + 21, y + 44, mname, { fontFamily: 'Galmuri9', fontSize: '9px', color: X.hex(sbx ? PAL.lime : PAL.sky), shadow }).setPadding(0, 0, 1, 1).setOrigin(0.5, 0).setDepth(2)
          .setInteractive({ useHandCursor: true }).on('pointerdown', () => window.Office.openPlate(id));
        this.deskLabels.push(lbl, mdl);
      });
    }
    /* 이름표: 같은 방 직원들이 첫 단어를 공유하면("채용 백엔드"/"채용 프론트") 뒷부분만, 길면 6자로 */
    shortName(id) {
      const e = window.Office.employees[id] || (this.chars[id] && this.chars[id].empData); if (!e) return id;
      const tpl = (window.Office.templates || []).find(t => t.id === e.template); let nm = tpl ? tpl.name : e.name.replace(/ #\d+$/, '');
      const mates = Object.values(window.Office.employees).filter(x => window.Office.present(x.id) && x.room === e.room);
      const first = nm.split(' ')[0];
      const templatesInRoom = new Set(mates.map(x => x.template));
      if (templatesInRoom.size === 1 && nm.includes(' ')) nm = first;                       // 방에 한 프로젝트뿐이면 앞말만 ("부스터 #5")
      else if (mates.length > 1 && nm.includes(' ') && mates.every(x => (x.name || '').split(' ')[0] === first)) nm = nm.slice(first.length + 1);   // 앞말이 같은 여러 프로젝트면 뒷말 ("백엔드"/"프론트")
      if (nm.length > 5) nm = nm.slice(0, 5) + '…';
      return e.no ? `${nm} #${e.no}` : nm;
    }
    flowers(d, x, y) { X.paint(d, X.FLOWERS, X.FLOWERS_LEGEND, x, y); }
    plant(d, x, y) { X.paint(d, X.PLANT, X.PLANT_LEGEND, x, y); }

    /* ---------- 충돌 ---------- */
    blocked(x, y) {
      const L = this.layout; if (!L) return false;
      if (x < 4 || x > W - 4 || y < 4 || y > H - 4) return true;
      for (const dr of L.doors) if (inRect(x, y, dr)) return false;
      for (const w of L.walls) if (inRect(x, y, w)) return true;
      // 가구: 회의 테이블, 책상
      const t = L.meeting.table; if (inRect(x, y, { x: t.x - 2, y: t.y - 6, w: t.w + 4, h: t.h + 6 })) return true;
      if (inRect(x, y, { x: 28, y: 44, w: 74, h: 42 })) return true;   // 대표 책상·의자
      if (inRect(x, y, { x: 102, y: 14, w: 44, h: 26 })) return true;  // 책장
      for (const dk of Object.values(L.desks)) if (inRect(x, y, { x: dk.x - 2, y: dk.y - 8, w: 46, h: 26 })) return true;
      return false;
    }
    /* 대표가 직원을 밟고 지나가지 않게: 직원 몸통 둘레(가로 ±8, 세로 -8..+12)로는 못 들어간다. 이미 겹쳐 있으면(직원이 걸어와 부딪힌 경우) 멀어지는 방향은 허용 */
    bumps(nx, ny) {
      const P = this.player;
      for (const c of Object.values(this.chars)) {
        if (!c.visible) continue;
        const inside = Math.abs(nx - c.x) < 8 && ny > c.y - 8 && ny < c.y + 12;
        if (!inside) continue;
        const now = Math.hypot(P.fx - c.x, P.fy - c.y), next = Math.hypot(nx - c.x, ny - c.y);
        if (next < now) return true;
      }
      return false;
    }
    zoneAt(x, y) { return this.layout.zones.find(z => inRect(x, y, z)) || null; }
    /* 방 → 문 → 복도 → 문 → 목적지 경로 */
    route(from, to) {
      const za = this.zoneAt(from[0], from[1]), zb = this.zoneAt(to[0], to[1]);
      const pts = [];
      if (za && za !== zb) pts.push(za.doorIn, za.doorOut);
      if (zb && za !== zb) {
        const last = pts.length ? pts[pts.length - 1] : from;
        pts.push([zb.doorOut[0], last[1] >= CORR.y && last[1] < CORR.y + CORR.h ? last[1] : zb.doorOut[1]]);
        pts.push(zb.doorOut, zb.doorIn);
      }
      pts.push(to);
      return pts;
    }

    /* ---------- 캐릭터 ---------- */
    makeChar(p, depth) {
      const c = this.add.container(0, 0).setDepth(depth);
      const body = this.add.container(0, 0); c.add(body); c.body_ = body;   // 몸 전체(그림자·다리·몸통·눈). face() 가 통째로 뒤집고, 작업 중엔 1px 들썩인다
      const sh = this.add.graphics(); X.paint(sh, X.SHADOW, { s: [PAL.ink, 0.28] }, -6, 8); body.add(sh);
      const skin = X.ramp(p.skin), hair = X.ramp(p.hair), shirt = p.uniform ? X.ramp(PAL.peach) : X.ramp(p.shirt);
      c.legLegend = p.uniform ? { P: PAL.green, p: PAL.forest, K: PAL.cocoa, O: PAL.bark } : { P: PAL.dusk, p: PAL.night, K: PAL.ink, O: PAL.ink };
      c.legs_ = this.add.graphics(); body.add(c.legs_); this.drawLegs(c, 1);
      const g = this.add.graphics(); body.add(g); c.bodyG_ = g;
      X.paint(g, X.BODY, { C: shirt.base, c: shirt.sh, O: shirt.ol, S: skin.base }, ...X.BODY_AT);
      if (!p.uniform && p.outfit != null && X.OUTFIT[p.outfit]) { const o = X.OUTFIT[p.outfit]; X.paint(g, o.rows, { W: PAL.white, T: PAL.red, B: shirt.base, b: shirt.sh, O: shirt.ol }, ...o.at); }
      if (p.uniform) X.paint(g, X.UNIFORM_EXTRA.rows, { O: shirt.ol, G: PAL.gold, K: PAL.ink, Y: PAL.gold }, ...X.UNIFORM_EXTRA.at);
      X.paint(g, X.HEAD, { O: skin.ol, S: skin.base, H: skin.hi }, ...X.HEAD_AT);
      if (p.feature >= 0) { const f = X.FEATURE[p.feature]; X.paint(g, f.rows, Object.assign({ H: hair.base }, f.legend || {}), ...f.at); }
      c.eyes_ = this.add.graphics(); body.add(c.eyes_); this.drawEyes(c, false);
      if (p.uniform) { g.fillStyle(skin.sh, 1).fillRect(-5, -10, 10, 2); g.fillStyle(PAL.cocoa, 1).fillRect(-1, -5, 3, 1); }   // 챙 그늘 · 굳게 다문 입
      const hs = X.HAIR[p.hairStyle != null ? p.hairStyle : 0], hairLegend = { O: hair.ol, H: hair.base, h: hair.sh };
      if (p.hairStyle === 5) X.paint(g, X.BEARD, hairLegend, ...X.BEARD_AT);
      X.paint(g, p.hat ? X.HAIR[4] : hs, hairLegend, ...X.HAIR_AT);
      (p.acc || []).forEach(a => { const A = X.ACC[a]; X.paint(g, A.rows, { O: hair.ol, F: PAL.ink, G: [PAL.sky, 0.5], B: shirt.base, b: shirt.sh, P: PAL.pink, Y: PAL.lemon, W: PAL.white, H: hair.base, K: PAL.ink }, ...A.at); });
      if (p.hat === 'drill') X.paint(g, X.CAP, X.CAP_LEGEND, ...X.CAP_AT);
      if (p.whip) { c.whipG = this.add.graphics(); c.add(c.whipG); this.drawWhip(c, 0); }   // 오른손 채찍 (별도 레이어: 스페이스로 휘두름)
      c.icon = this.add.graphics().setVisible(false); c.add(c.icon);            // 머리 위 상태 말풍선 아이콘 (11×13)
      c.bubG = this.add.graphics().setVisible(false); c.add(c.bubG);            // 말풍선 상자
      c.bub = this.text(0, -37, '', { fontFamily: 'Galmuri9', fontSize: '9px', color: X.hex(PAL.ink), wordWrap: { width: 64 } }).setPadding(2, 1, 2, 1).setOrigin(0.5, 1).setVisible(false); c.add(c.bub);
      c.gauge = this.add.graphics(); c.add(c.gauge); c.gaugePct = -1;
      c.setSize(16, 24).setInteractive({ useHandCursor: true }).on('pointerdown', () => { if (c.empId) window.Office.openModal(c.empId); });
      c.blinkEv = this.time.addEvent({ delay: 2800 + Math.random() * 2500, loop: true, callback: () => { if (!c.scene) return; this.drawEyes(c, true); this.time.delayedCall(110, () => { if (c.scene) this.drawEyes(c, false); }); } });   // 눈 깜빡임 (장식)
      c.once('destroy', () => { if (c.blinkEv) c.blinkEv.remove(); if (c.walkAnim) c.walkAnim.remove(); });
      return c;
    }
    drawEyes(c, closed) { const g = c.eyes_; g.clear(); X.EYES[closed ? 'closed' : 'open'].forEach(([k, x, y]) => g.fillStyle(k === 'W' ? PAL.white : PAL.ink, 1).fillRect(x, y, 1, 1)); }
    drawLegs(c, f) { if (!c.legs_ || c.legFrame === f) return; c.legFrame = f; const g = c.legs_; g.clear(); X.paint(g, X.LEGS[f], c.legLegend, ...X.LEGS_AT); }
    /* 채찍 프레임: 0 쉼 · 1 뒤로 들기 · 2 앞으로 휘두름 · 3 끝이 꺾이며 딱! */
    drawWhip(c, f) {
      const g = c.whipG; g.clear(); const tail = X.WHIP_FRAMES[f];
      g.fillStyle(PAL.cocoa, 1); if (f === 1) g.fillRect(5, -2, 2, 6); else g.fillRect(6, 0, 2, 6);   // 손잡이
      g.fillStyle(PAL.bark, 1); if (f === 1) g.fillRect(5, -2, 1, 1); else g.fillRect(6, 0, 1, 1);
      g.fillStyle(PAL.night, 1); tail.forEach(([x, y]) => g.fillRect(x, y, 1, 1));
      if (f === 3) { g.fillStyle(PAL.lemon, 1).fillRect(27, -5, 1, 1).fillRect(29, -3, 1, 1).fillRect(28, 0, 1, 1).fillRect(26, -6, 1, 1); }   // 불꽃
    }
    face(c, dir) { if (c.facing === dir) return; c.facing = dir; if (c.whipG) c.whipG.setScale(dir, 1); if (c.body_) c.body_.setScale(dir, 1); }   // 몸통(모자 챙 포함)과 채찍을 같이 뒤집는다. 이름표·말풍선은 텍스트라 그대로
    crackWhip() {
      const P = this.player; if (!P.whipG || P.whipping) return;
      P.whipping = true; const O = window.Office; const f = P.facing || 1;
      this.drawWhip(P, 1);
      this.time.delayedCall(80, () => this.drawWhip(P, 2));
      this.time.delayedCall(150, () => {
        this.drawWhip(P, 3); if (O.sfx) O.sfx('whip');
        const t = this.text(P.x + 30 * f, P.y - 10, '딱!', { fontFamily: 'Galmuri11', fontSize: '11px', color: '#fee761', stroke: '#181425', strokeThickness: 2 }).setOrigin(0.5).setDepth(31);
        this.tweens.add({ targets: t, y: t.y - 8, alpha: 0, duration: 450, onComplete: () => t.destroy() });
        if (O.near) this.bubble(O.near, ['넵!', '헉!', '열심히 하겠습니다!', '죄송합니다!'][Math.floor(Math.random() * 4)], 1500);
      });
      this.time.delayedCall(380, () => { this.drawWhip(P, 0); P.whipping = false; });
    }
    walkPath(c, pts, done, msPerPx = 10) {   // 기본 10ms/px. 출근은 이 속도, 퇴근은 더 빠르게(6)
      if (c.walkTween) { c.walkTween.stop(); c.walkTween = null; }
      if (c.legs_) { if (c.walkAnim) c.walkAnim.remove(); c.walkI = 0; c.walkAnim = this.time.addEvent({ delay: 140, loop: true, callback: () => { c.walkI = (c.walkI + 1) % 4; this.drawLegs(c, [0, 1, 2, 1][c.walkI]); } }); }   // 다리 3프레임 (0-1-2-1). 장식, 이동 로직과 무관
      let i = 0; const step = () => {
        if (i >= pts.length) { c.walkTween = null; this.stopWalkAnim(c); done && done(); return; }
        const [x, y] = pts[i++]; const dist = Phaser.Math.Distance.Between(c.x, c.y, x, y);
        if (Math.abs(x - c.x) > 2) this.face(c, x < c.x ? -1 : 1);   // 걷는 방향을 본다
        c.walkTween = this.tweens.add({ targets: c, x, y, duration: Math.max(100, dist * msPerPx), ease: 'Linear', onUpdate: () => { c.x = Math.round(c.x); c.y = Math.round(c.y); }, onComplete: step });   // 정수 좌표: 픽셀 폰트(이름표·말풍선)가 걷는 동안 뭉개지지 않게
      }; step();
    }
    stopWalkAnim(c) { if (c.walkAnim) { c.walkAnim.remove(); c.walkAnim = null; } this.drawLegs(c, 1); }
    walkTo(c, x, y, done) { this.walkPath(c, this.route([c.x, c.y], [x, y]), done); }
    bubble(id, text, ms) {
      const c = id === '__ceo' ? this.player : this.chars[id]; if (!c || !text) return;
      c.bub.setText(text.length > 60 ? text.slice(0, 60) + '…' : text).setVisible(true);
      const half = c.bub.width / 2; c.bub.x = Math.round(Math.min(Math.max(0, half + 2 - c.x), W - 2 - half - c.x));   // 맵 가장자리(입구 근처)에서 잘리지 않게 안쪽으로 민다
      this.drawBubbleBox(c.bubG, c.bub);
      if (c.bubTimer) c.bubTimer.remove(); c.bubTimer = this.time.delayedCall(ms || 3000, () => { c.bub.setVisible(false); c.bubG.setVisible(false); });
    }
    /* 말풍선 상자: 흰 바탕 + 1px 외곽선 + 계단 모서리 + 꼬리 + (1,1) 그림자. 텍스트(origin 0.5,1) 크기에 맞춰 그린다 */
    drawBubbleBox(g, t) {
      const w = Math.round(t.width) + 2, h = Math.round(t.height) + 2, x = Math.round(t.x - w / 2), y = Math.round(t.y - h + 1);
      g.clear().setVisible(true);
      g.fillStyle(PAL.ink, 0.25).fillRect(x + 1, y + 2, w, h);                                   // 그림자
      g.fillStyle(PAL.slate, 1).fillRect(x + 1, y, w - 2, h).fillRect(x, y + 1, w, h - 2);        // 외곽선 (모서리 1px 컷)
      g.fillStyle(PAL.white, 1).fillRect(x + 1, y + 1, w - 2, h - 2);
      const tx = Math.round(t.x) - 1;                                                             // 꼬리 (머리 쪽으로 3px)
      g.fillStyle(PAL.slate, 1).fillRect(tx - 1, y + h, 5, 1).fillRect(tx, y + h + 1, 3, 1).fillRect(tx + 1, y + h + 2, 1, 1);
      g.fillStyle(PAL.white, 1).fillRect(tx, y + h - 1, 3, 1).fillRect(tx, y + h, 3, 1).fillRect(tx + 1, y + h + 1, 1, 1);
    }
    /* 머리 위 컨텍스트 게이지 (60% 노랑, 80% 빨강) */
    /* HP 바 스타일 컨텍스트 게이지: 남은 양이 줄어드는 느낌으로 (100% = 가득 찼음 = 빨강) */
    setGauge(c, pct) {
      if (pct === c.gaugePct) return; c.gaugePct = pct; const g = c.gauge; g.clear();
      if (!pct) return;   // 컨텍스트 없음(= 새 세션) 이면 바 자체를 그리지 않는다
      const w = 22, x = -11, y = -20;
      g.fillStyle(PAL.ink, 1).fillRect(x - 1, y - 1, w + 2, 5);
      g.fillStyle(PAL.dusk, 1).fillRect(x, y, w, 3);
      const fill = Math.max(1, Math.round(w * Math.min(100, pct) / 100));
      const col = pct >= 80 ? [PAL.red, PAL.pink] : pct >= 60 ? [PAL.gold, PAL.lemon] : [PAL.green, PAL.lime];
      g.fillStyle(col[0], 1).fillRect(x, y, fill, 3); g.fillStyle(col[1], 1).fillRect(x, y, fill, 1);
    }
    /* 머리 위 상태 아이콘: 11×13 픽셀 말풍선(색 바탕 + 어두운 외곽선 + 꼬리)에 흰 글리프 (… 작업 중 · ? 질문 · ! 완료 · ⚠ 오류) */
    setIcon(c, s, color) {
      const g = c.icon; if (!s) { g.setVisible(false); return; }
      const bg = X.nearest(color || '#7ea4f2'), x = -5, y = -34; g.clear().setVisible(true);
      g.fillStyle(PAL.ink, 1).fillRect(x + 1, y, 9, 11).fillRect(x, y + 1, 11, 9).fillRect(x + 4, y + 11, 3, 1).fillRect(x + 5, y + 12, 1, 1);
      g.fillStyle(bg, 1).fillRect(x + 1, y + 1, 9, 9).fillRect(x + 4, y + 10, 3, 1).fillRect(x + 5, y + 11, 1, 1);
      g.fillStyle(PAL.white, 1);
      if (s === '…') g.fillRect(x + 2, y + 6, 2, 2).fillRect(x + 5, y + 6, 2, 2).fillRect(x + 8, y + 6, 1, 2);
      else if (s === '!') g.fillRect(x + 5, y + 2, 2, 5).fillRect(x + 5, y + 8, 2, 2);
      else if (s === '?') g.fillRect(x + 3, y + 2, 5, 1).fillRect(x + 3, y + 3, 1, 1).fillRect(x + 7, y + 3, 1, 2).fillRect(x + 5, y + 5, 2, 2).fillRect(x + 5, y + 8, 2, 1);
      else { g.fillRect(x + 5, y + 2, 1, 1).fillRect(x + 4, y + 3, 3, 1).fillRect(x + 3, y + 4, 5, 1).fillRect(x + 2, y + 5, 7, 1).fillRect(x + 1, y + 6, 9, 1).fillRect(x + 1, y + 7, 9, 1); g.fillStyle(bg, 1).fillRect(x + 5, y + 4, 1, 2); }
    }
    applyStatus(id, immediate) {
      const e = window.Office.employees[id], c = this.chars[id]; if (!e || !c || !this.layout) return;
      const st = e.status;
      if (c.leaving) return;
      if (st === 'away') { this.leaveOffice(c); return; }   // 퇴근 중(/exit 가 끝나기까지 몇 초) 걸어 나가는 연출로 채운다
      if (c.bobTween) { c.bobTween.stop(); c.bobTween = null; c.body_.y = 0; }
      if (c.blinkTween) { c.blinkTween.stop(); c.blinkTween = null; c.icon.setAlpha(1); }
      // 움직임은 '작업 중'에만. 끝나면 '!' 로 멈춰 서 있고, 물어볼 게 있으면 '?' 가 깜빡인다. 확인하면(idle) 아무 표시 없이 조용히.
      if (st === 'working') {
        this.goHome(c, immediate);
        c.bobTween = this.tweens.add({ targets: c.body_, y: -1, duration: 160, yoyo: true, repeat: -1 });
        this.setIcon(c, '…', '#7ea4f2');
        if (e.bubble) this.bubble(id, e.bubble, 2500);
      } else if (st === 'needs_input') {
        this.goHome(c, immediate); this.setIcon(c, '?', '#f0a33a');
        c.blinkTween = this.tweens.add({ targets: c.icon, alpha: 0.2, duration: 400, yoyo: true, repeat: -1 });
        if (e.bubble) this.bubble(id, e.bubble, 6000);
      } else if (st === 'done') { this.goHome(c, immediate); this.setIcon(c, '!', '#1f8a5a'); }
      else if (st === 'meeting') { this.setIcon(c, '…', '#6d7f93'); this.toMeetingSeat(id); if (e.bubble) this.bubble(id, e.bubble, 3500); }
      else if (st === 'error') { this.goHome(c, immediate); this.setIcon(c, '⚠', '#ef4444'); if (e.bubble) this.bubble(id, e.bubble, 8000); }
      else { this.goHome(c, immediate); this.setIcon(c, ''); if (c.bub) c.bub.setVisible(false); }
      this.setGauge(c, e.ctx && e.ctx.pct != null ? e.ctx.pct : 0);
      this.drawDesks();
    }
    /* 출근 연출: 입구 문 밖에서 복도로 들어와 방 문을 지나 자리에 앉는다. 걷는 동안 상태 변화로 자리에 순간이동하지 않게 entering 으로 막는다 */
    enterOffice(c, delay) {
      const L = this.layout, en = L.entrance, z = c.zone;
      c.setPosition(en.out[0], en.out[1]); this.face(c, 1);
      const pts = [[z.doorOut[0], en.out[1]], z.doorOut, z.doorIn, c.home];
      const go = () => { if (!this.chars[c.empId]) return; this.bubble(c.empId, '출근했습니다', 2500); this.walkPath(c, pts, () => { c.entering = false; this.face(c, 1); this.applyStatus(c.empId, true); }); };
      if (delay) this.time.delayedCall(delay, go); else go();
    }
    /* 퇴근 연출: 인사하고 방 문 → 복도 → 입구 문 밖으로 걸어 나간 뒤 사라진다. 서버가 /exit 를 보내고 창을 닫는 동안의 시간과 맞물린다 */
    leaveOffice(c) {
      if (c.leaving) return; c.leaving = true; c.entering = false;
      const id = c.empId, L = this.layout, en = L.entrance, z = c.zone;
      (c.helpers || []).forEach(h => h.destroy()); c.helpers = [];
      if (c.bobTween) { c.bobTween.stop(); c.bobTween = null; c.body_.y = 0; }
      if (c.blinkTween) { c.blinkTween.stop(); c.blinkTween = null; }
      this.setIcon(c, ''); c.setVisible(true);
      this.bubble(id, '먼저 퇴근해보겠습니다.', 3000);
      const pts = z ? [z.doorIn, z.doorOut, [z.doorOut[0], en.out[1]], en.out] : [en.out];
      const finish = () => { if (this.chars[id] === c) delete this.chars[id]; c.destroy(); this.rebuild({}); };   // 나간 뒤에야 책상이 사라진다
      this.time.delayedCall(600, () => { if (!c.scene) return; this.walkPath(c, pts, finish, 6); });   // 인사 한 박자 뒤 출발, 출근보다 빠르게
    }
    goHome(c, immediate) {
      if (!c.home || c.entering) return;
      const e = c.empId && window.Office.employees[c.empId];
      if (e && e.meeting) { this.toMeetingSeat(c.empId); return; }   // 회의 중엔 회의실에 머문다
      if (e && e.pantry) { this.toPantrySpot(c.empId); return; }     // 압축 중엔 탕비실에서 커피
      if (immediate || c.walkTween) { if (c.walkTween) { c.walkTween.stop(); c.walkTween = null; } c.setPosition(c.home[0], c.home[1]); }
      else if (Math.abs(c.x - c.home[0]) + Math.abs(c.y - c.home[1]) > 2) this.walkTo(c, c.home[0], c.home[1]);
    }
    toMeetingSeat(id) {
      const c = this.chars[id]; if (!c || !this.layout) return;
      const parts = Object.values(window.Office.meetings || {}).find(ps => ps.includes(id)) || [id];
      const seats = this.layout.meeting.seats; const seat = seats[parts.indexOf(id) % seats.length];
      if (Math.abs(c.x - seat[0]) + Math.abs(c.y - seat[1]) > 2 && !c.walkTween) this.walkTo(c, seat[0], seat[1]);
    }
    /* 탕비실: compact 동안 커피 한 잔 */
    toPantrySpot(id, immediate) {
      const c = this.chars[id]; if (!c || !this.layout) return;
      const spots = this.layout.pantry.spots; const sp = spots[Object.keys(this.chars).indexOf(id) % spots.length];
      if (immediate) { c.setPosition(sp[0], sp[1]); return; }
      if (Math.abs(c.x - sp[0]) + Math.abs(c.y - sp[1]) > 2 && !c.walkTween) this.walkTo(c, sp[0], sp[1], () => this.setIcon(c, '☕', '#8a6a4a'));
    }
    pantryVisit(id) { const c = this.chars[id]; if (!c) return; this.toPantrySpot(id); this.bubble(id, '☕ 커피 한 잔 (컨텍스트 정리)', 4000); this.steam = true; }
    pantryDone(id) {
      const c = this.chars[id]; if (!c) return; this.bubble(id, '재충전 완료', 3000);
      this.steam = Object.values(window.Office.employees).some(e => e.pantry);
      this.goHome(c); const e = window.Office.employees[id]; if (e) this.applyStatus(id);
    }
    meetingStart(p) {
      const seats = this.layout.meeting.seats;
      p.participants.forEach((id, i) => { const c = this.chars[id]; if (c) { this.walkTo(c, seats[i % seats.length][0], seats[i % seats.length][1]); this.setIcon(c, '…', '#6d7f93'); } });
    }
    meetingEnd(p) { p.participants.forEach(id => { const c = this.chars[id]; const e = window.Office.employees[id]; if (e) e.meeting = null; if (c) this.goHome(c); }); }
    /* 시간대별 조명 (컬러 오버레이) */
    setLighting(period) {
      const map = { '이른 아침': [0xffd9a0, 0.10], '오전': [0xffffff, 0], '점심': [0xfff3c0, 0.05], '오후': [0xffffff, 0], '저녁': [0xf77622, 0.12], '야근': [0x262b44, 0.38] };
      const [color, alpha] = map[period] || [0xffffff, 0];
      if (this.tint.fillColor === color && Math.abs(this.tint.fillAlpha - alpha) < 0.01) return;
      this.tint.setFillStyle(color, this.tint.fillAlpha);
      this.tweens.add({ targets: this.tint, fillAlpha: alpha, duration: 1500 });
    }
    /* 대표실 창문(56,2 · 40×10): 실제 날씨대로. 맑음=해+구름, 흐림=구름, 비=빗줄기, 눈=눈송이, 밤=달+별. 250ms 마다 한 프레임씩 흐른다 */
    setSky(sky) {
      this.sky = sky || this.sky; if (!this.sky) return;
      if (!this.winG) { this.winG = this.add.graphics().setDepth(2); this.winF = 0; this.winEv = this.time.addEvent({ delay: 250, loop: true, callback: () => { this.winF++; this.drawWindow(); } }); }
      this.drawWindow();
    }
    drawWindow() {
      const g = this.winG, s = this.sky; if (!g || !s) return; g.clear();
      const X0 = 56, Y0 = 2, Wd = 40, Hg = 10, f = this.winF, day = !!s.is_day, k = s.kind || 'clear';
      const glass = !day ? PAL.night : k === 'clear' ? PAL.sky : k === 'snow' ? PAL.cloud : k === 'rain' || k === 'storm' ? PAL.slate : PAL.steel;
      g.fillStyle(glass, 1).fillRect(X0, Y0, Wd, Hg);
      const dot = (x, y, c, w = 1, h = 1) => { x = X0 + ((x % Wd) + Wd) % Wd; if (x + w > X0 + Wd) w = X0 + Wd - x; y = Y0 + y; if (y >= Y0 && y + h <= Y0 + Hg) g.fillStyle(c, 1).fillRect(x, y, w, h); };
      if (!day) { dot(6, 2, PAL.lemon, 3, 3); dot(5, 3, PAL.lemon); dot(8, 1, PAL.night, 2, 2); [[16, 3], [24, 1], [31, 5], [36, 2]].forEach(([x, y]) => dot(x, y, (f + x) % 7 < 5 ? PAL.white : PAL.cloud)); }   // 달 + 깜빡이는 별
      else if (k === 'clear') { dot(5, 1, PAL.lemon, 4, 4); dot(4, 2, PAL.lemon, 6, 2); dot(6, 0, PAL.lemon, 2, 6); dot(6, 2, PAL.white, 2, 2); }   // 해
      if (k === 'clear' || k === 'cloud' || k === 'fog') {   // 구름: 천천히 오른쪽으로
        const cc = k === 'clear' ? PAL.white : PAL.cloud, n = k === 'clear' ? 2 : 4;
        for (let i = 0; i < n; i++) { const x = 14 + i * 11 + Math.floor(f / 4), y = 2 + (i % 2) * 4; dot(x, y, cc, 6, 2); dot(x + 1, y - 1, cc, 3, 1); }
        if (k === 'fog') for (let i = 0; i < 5; i++) dot(i * 9 + Math.floor(f / 3), 6 + (i % 2), PAL.cloud, 5, 1);
      }
      if (k === 'rain' || k === 'storm') { for (let i = 0; i < 9; i++) dot(i * 5 + (f % 3), (i * 4 + f * 2) % Hg, PAL.sky, 1, 2); if (k === 'storm' && f % 16 === 0) g.fillStyle(PAL.lemon, 0.6).fillRect(X0, Y0, Wd, Hg); }   // 빗줄기 (+번개)
      if (k === 'snow') { for (let i = 0; i < 8; i++) dot(i * 5 + ((f + i) % 3), (i * 3 + Math.floor(f / 2)) % Hg, PAL.white); }   // 눈송이
      g.fillStyle(PAL.ink, 1).fillRect(X0 + 19, Y0, 1, Hg).fillRect(X0, Y0 + 5, Wd, 1);   // 창살
    }
    flashBoard() { this.tweens.add({ targets: this.boardGlow, strokeAlpha: { from: 1, to: 0 }, duration: 1500, repeat: 2 }); }

    /* ---------- 매 프레임: 대표 이동(충돌), 근접 판정 ---------- */
    update() {
      if (!this.layout) return;
      const P = this.player, sp = 1.5; let dx = 0, dy = 0;
      if (P.fx == null) { P.fx = P.x; P.fy = P.y; }
      if (!this.inputFocused) {
        if (this.cursors.left.isDown || this.wasd.A.isDown) dx -= sp; if (this.cursors.right.isDown || this.wasd.D.isDown) dx += sp;
        if (this.cursors.up.isDown || this.wasd.W.isDown) dy -= sp; if (this.cursors.down.isDown || this.wasd.S.isDown) dy += sp;
      }
      if (dx || dy) this.target = null;
      else if (this.target) {
        const tx = this.target[0] - P.fx, ty = this.target[1] - P.fy, d = Math.hypot(tx, ty);
        if (d < 2) this.target = null; else { dx = tx / d * sp; dy = ty / d * sp; }
      }
      if (dx && !this.blocked(P.fx + dx, P.fy + 6) && !this.bumps(P.fx + dx, P.fy)) P.fx += dx; else if (dx && this.target) this.target = null;
      if (dy && !this.blocked(P.fx, P.fy + dy + 6) && !this.bumps(P.fx, P.fy + dy)) P.fy += dy; else if (dy && this.target) this.target = null;
      P.setPosition(Math.round(P.fx), Math.round(P.fy));   // 픽셀 격자에 맞춰 그려야 이동 중 번지지 않는다
      if (dx) this.face(P, dx < 0 ? -1 : 1);
      P.setDepth(10 + P.y / 1000);
      if (!this.steamG) { this.steamG = this.add.graphics().setDepth(3); }
      this.steamG.clear();
      if (this.steam) { const px = this.layout.zones[2].x, t = Math.floor(this.time.now / 300) % 3; this.steamG.fillStyle(0xffffff, 0.8).fillRect(px + 16, 12 - t, 1, 1).fillRect(px + 20, 10 + t, 1, 1).fillRect(px + 18, 8 + ((t + 1) % 3), 1, 1); }
      let best = null, bd = 40;
      Object.values(this.chars).forEach(c => { if (!c.walkTween && c.walkAnim) this.stopWalkAnim(c); if (!c.visible || c.leaving) return; if (c.walkTween) c.setPosition(Math.round(c.x), Math.round(c.y)); const d = Phaser.Math.Distance.Between(c.x, c.y, P.x, P.y); c.setDepth(10 + c.y / 1000); if (d < bd) { bd = d; best = c.empId; } });
      if (best !== window.Office.near) window.Office.setNear(best);
      const fp = this.layout.folderPile; this.nearDesk = !best && Phaser.Math.Distance.Between(P.x, P.y, fp[0], fp[1] + 30) < 40;
      this.mascotTick();
    }
  }

  /* 부모(#game) 크기에 맞춰 정수 배율로 확대. FIT은 그리드 셀 높이를 잘못 읽어 캔버스가 넘치므로 직접 계산한다. */
  const parentEl = document.getElementById('game');
  function fitZoom() {
    const pw = parentEl.clientWidth || W, ph = parentEl.clientHeight || H;
    const raw = Math.min(pw / W, ph / H) * 0.97;
    let z = Math.floor(raw);                     // 정수 배율: 픽셀 폰트·타일이 그대로 확대되어 선명
    if (z < 1) z = Math.max(0.5, Math.floor(raw * 2) / 2);
    return z;
  }
  let game;
  const fontsReady = (document.fonts && document.fonts.load) ? Promise.all([document.fonts.load('9px Galmuri9'), document.fonts.load('11px Galmuri11')]).catch(() => {}) : Promise.resolve();
  fontsReady.then(() => { game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', width: W, height: H, pixelArt: true, roundPixels: true, backgroundColor: '#2a2622',
    scale: { mode: Phaser.Scale.NONE, zoom: fitZoom() }, scene: [OfficeScene],
    input: { windowEvents: false },   // 모달 버튼(✕ 등) 클릭이 캔버스 아래 오브젝트(게시판)로 새지 않게: 캔버스 위 이벤트만
  }); });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (game) game.scale.setZoom(fitZoom()); }, 100); });
})();
