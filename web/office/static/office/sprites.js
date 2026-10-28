(function () {
  const P = {   // Endesga 32 (lospec.com/palette-list/endesga-32)
    rust: 0xbe4a2f, orange: 0xd77643, cream: 0xead4aa, tan: 0xe4a672, brown: 0xb86f50, cocoa: 0x733e39, bark: 0x3e2731,
    wine: 0xa22633, red: 0xe43b44, flame: 0xf77622, gold: 0xfeae34, lemon: 0xfee761, lime: 0x63c74d, green: 0x3e8948, forest: 0x265c42, pine: 0x193c3e,
    navy: 0x124e89, blue: 0x0099db, sky: 0x2ce8f5, white: 0xffffff, cloud: 0xc0cbdc, steel: 0x8b9bb4, slate: 0x5a6988, dusk: 0x3a4466, night: 0x262b44, ink: 0x181425,
    hot: 0xff0044, plum: 0x68386c, berry: 0xb55088, pink: 0xf6757a, peach: 0xe8b796, clay: 0xc28569,
  };
  const LIST = Object.values(P);
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  const rgb = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  /* 임의 색(팀 색 등)을 팔레트에서 가장 가까운 색으로 */
  function nearest(color) {
    const c = typeof color === 'string' ? parseInt(color.replace('#', ''), 16) : color; const [r, g, b] = rgb(c);
    let best = LIST[0], bd = 1e9;
    for (const p of LIST) { const [pr, pg, pb] = rgb(p); const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  /* 램프: 기본색을 주면 [하이라이트, 기본, 그림자, 외곽선] 을 팔레트 안에서 고른다. 그림자는 어둡고 차갑게, 하이라이트는 밝고 따뜻하게 */
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return (Math.round(A[0] + (B[0] - A[0]) * t) << 16) | (Math.round(A[1] + (B[1] - A[1]) * t) << 8) | Math.round(A[2] + (B[2] - A[2]) * t); };
  function ramp(base) {
    const b = nearest(base);
    const hi = nearest(mix(b, P.lemon, 0.35)), sh = nearest(mix(b, P.navy, 0.35)), ol = nearest(mix(b, P.ink, 0.6));
    return { hi: hi === b ? nearest(mix(b, P.white, 0.4)) : hi, base: b, sh: sh === b ? nearest(mix(b, P.ink, 0.3)) : sh, ol: ol === b || ol === sh ? P.ink : ol };
  }
  function paint(g, rows, legend, x0 = 0, y0 = 0) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y]; let x = 0;
      while (x < row.length) {
        const ch = row[x]; if (ch === '.' || ch === ' ') { x++; continue; }
        let x2 = x + 1; while (x2 < row.length && row[x2] === ch) x2++;
        const col = legend[ch]; if (col != null) { const a = Array.isArray(col) ? col[1] : 1; g.fillStyle(Array.isArray(col) ? col[0] : col, a).fillRect(x0 + x, y0 + y, x2 - x, 1); }
        x = x2;
      }
    }
  }

  /* ---------- 캐릭터 16×24 (x -8..7, y -15..9, 발끝 9). 2등신: 머리 11 · 몸 8 · 다리 4 ---------- */
  // 머리(피부). O 외곽선 · S 피부 · H 하이라이트
  const HEAD = [
    '..OOOOOOOO..',   // -13
    '.OHHSSSSSSO.',   // -12
    'OHSSSSSSSSSO',   // -11
    'OSSSSSSSSSSO',   // -10
    'OSSSSSSSSSSO',   // -9
    'OSSSSSSSSSSO',   // -8
    'OSSSSSSSSSSO',   // -7
    'OSSSSSSSSSSO',   // -6
    '.OSSSSSSSSO.',   // -5
    '..OOOOOOOO..',   // -4
    '....OSSO....',   // -3 목
  ];
  const HEAD_AT = [-6, -13];
  const EYES = { open: [['K', -3, -8], ['K', -2, -8], ['K', -3, -7], ['K', -2, -7], ['K', 1, -8], ['K', 2, -8], ['K', 1, -7], ['K', 2, -7], ['W', -3, -8], ['W', 1, -8]], closed: [['K', -3, -7], ['K', -2, -7], ['K', 1, -7], ['K', 2, -7]] };
  // 몸(셔츠 C/그림자 c/외곽선 O, 손 S)
  const BODY = [
    '.OCCCCCCCCO.',   // -2 어깨
    'OCCCCCCCCCCO',   // -1
    'OCCCCCCCCccO',   // 0
    'OSCCCCCCCcSO',   // 1 손
    '.OCCCCCCCcO.',   // 2
    '.OccCCCcccO.',   // 3
    '..OOOOOOOO..',   // 4
  ];
  const BODY_AT = [-6, -2];
  // 다리 3프레임 (P 바지, p 바지 그림자, K 신발, O 외곽선). 프레임 1 = 서 있음
  const LEGS = [
    ['..OPPO.OppO.', '..OPpO.OppO.', '..OKKO..OO..', '..OOOO......'],
    ['..OPpO.OPpO.', '..OPpO.OPpO.', '..OKKO.OKKO.', '..OOOO.OOOO.'],
    ['..OppO.OPPO.', '..OppO.OPpO.', '...OO..OKKO.', '.......OOOO.'],
  ];
  const LEGS_AT = [-6, 5];
  const SHADOW = ['..ssssssss..', '.ssssssssss.'];   // 발 그림자 (반투명)
  // 머리카락 6종 (H 기본, h 그림자, O 외곽선). 14 폭, 머리 위 -16 부터
  const HAIR = [
    [ // 0 단발
      '....OOOOOO....', '..OOHHHHHHOO..', '.OHHHHHHHHHHO.', '.OHHHHHHHHHHO.', '.OHHHHHHHHHhO.', '.OHhO....OhhO.', '.OHhO....OhhO.', '.OHhO....OhhO.', '.OhhO....OhhO.', '..OO......OO..'],
    [ // 1 포니테일
      '....OOOOOO....', '..OOHHHHHHOO..', '.OHHHHHHHHHHO.', '.OHHHHHHHHHHOO', '.OHHHHHHHHHhHO', '.OhO......OHhO', '..O.......OHhO', '..........OhhO', '..........OhhO', '...........OO.'],
    [ // 2 곱슬
      '...OO.OOO.OO..', '..OHHOHHHOHHO.', '.OHHHHHHHHHHHO', 'OHHHHHHHHHHHHO', 'OHHHHHHHHHHHhO', 'OHhOHHHHHHOhhO', '.OO.OhhhhO.OO.', '.....OOOO.....'],
    [ // 3 뾰족
      '..O...OO...O..', '.OHO.OHHO.OHO.', '.OHHOHHHHOHHO.', '.OHHHHHHHHHHO.', '.OHHHHHHHHHhO.', '..OhHHHHHHhO..', '...OOOOOOOO...'],
    [ // 4 가르마
      '....OOOOOO....', '..OOHHHhHHOO..', '.OHHHHHhHHHHO.', '.OHHHHHhHHHHO.', '.OHhHHHhHHHhO.', '.OhO.OhhO.OhO.', '..O...OO...O..'],
    [ // 5 대머리 (수염은 아래 BEARD)
      '....OOOOOO....', '..OO......OO..'],
  ];
  const HAIR_AT = [-7, -16];
  const BEARD = ['.OHHHHHHO.', 'OHhHHHHhHO', '.OhhOOhhO.'];   // -5 부터
  const BEARD_AT = [-5, -5];
  // 액세서리 8종: [rows, x, y, legend 키 설명]. G 안경 유리, F 안경테, B 셔츠색, b 셔츠 그림자, P 분홍, Y 노랑, W 흰, K 검정, H 머리색
  const ACC = [
    { rows: ['.FFF..FFF.', 'FGGGFFGGGF', '.FFF..FFF.'], at: [-5, -9] },                                   // 0 둥근 안경
    { rows: ['FFFF..FFFF', 'FGGF..FGGF', 'FFFFFFFFFF'], at: [-5, -9] },                                   // 1 각진 안경
    { rows: ['...OOOOOOO...', '..OO.....OO..', '.OBO.....OBO.', '.OBO.....OBO.', '..O.......O..'], at: [-6, -17] },   // 2 헤드폰
    { rows: ['...OOOOOOO...', '.OOBBBBBBBOO.', 'OBBBbBBBBBBBO', 'OBbbBBBBBBbbO', '.OOOOOOOOOOO.'], at: [-6, -17] },  // 3 비니
    { rows: ['...OOOOOOO...', '..OBBBBBBBO..', '.OBBBBBBBBBOOO', '.ObbbbbbbbbbbO', '..OOOOOOOOOOO.'], at: [-6, -17] }, // 4 야구모자 (챙 오른쪽)
    { rows: ['OO.........OO', 'OHO.......OHO', 'OPHO.....OHPO', 'OPHO.....OHPO', '.OO.......OO.'], at: [-6, -19] },     // 5 고양이귀
    { rows: ['.P.', 'PYP', '.P.'], at: [3, -14] },                                                          // 6 꽃핀
    { rows: ['OWWWWWWWWO', 'OWWWWWWWWO', '.OWWWWWWO.'], at: [-5, -6] },                                      // 7 마스크
  ];
  const FEATURE = [
    { rows: ['K.K...K.K'], at: [-4, -5], legend: { K: P.brown } },           // 0 주근깨
    { rows: ['PP......PP'], at: [-5, -6], legend: { P: P.pink } },           // 1 홍조
    { rows: ['.HHHH.'], at: [-3, -4] },                                       // 2 콧수염 (머리색)
  ];
  // 옷 3종 (몸 위에 덧그림). T 넥타이, W 흰 깃, B 셔츠색, b 그림자
  const OUTFIT = [
    null,                                                                                     // 0 티셔츠
    { rows: ['....WTTW....', '.....TT.....', '.....TT.....', '.....TT.....', '......T.....'], at: [-6, -2] },   // 1 셔츠+넥타이
    { rows: ['.OBBBBBBBBO.', 'OBbBBBBBBbBO', '.....OO.....', '....OBBO....', '....ObbO....', '....OOOO....'], at: [-6, -3] },   // 2 후드 (목둘레 + 주머니)
  ];
  // 대표: 군복 + 교관모 + 채찍. 군복은 BODY/LEGS 와 같은 틀에 색만 다름(셔츠 카키, 바지 녹색, 군화 갈색)
  const UNIFORM_EXTRA = { rows: ['.OGG....GGO.', '', '', '', '.OKKKKYYKKO.'], at: [-6, -1] };   // 견장(G, y-1) · 벨트(K)+버클(Y, y3)
  const CAP = [   // 교관모: 빨강 크라운 낮게 + 금색 줄 + 긴 챙(오른쪽=앞) + 월계수·휘장. favicon.py 가 읽는다
    '....OOOOOOO.....',
    '..OORRRRRRROO...',
    '.ORRRhRRRRRRRO..',
    '.ORRRRRRRRRRRO..',
    '.ORrRRRRRYYRRO..',
    '.OGGGGGGGGGGGO..',
    '..OrrrrrrrrrrrOOO',
    '...OOOOOOYOYOYOO',
  ];
  const CAP_AT = [-8, -17];
  const CAP_LEGEND = { O: P.wine, R: P.red, r: P.wine, h: P.pink, G: P.gold, Y: P.lemon };
  const WHIP_FRAMES = [
    [[8, -1], [9, -3], [9, -4], [10, -5], [10, -6], [11, -7], [11, -8], [12, -8], [13, -8]],
    [[6, -2], [5, -4], [4, -6], [3, -8], [2, -10], [1, -12], [0, -13], [-1, -14], [-2, -14]],
    [[8, 1], [10, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 0], [22, 0], [24, -1]],
    [[8, 3], [10, 4], [12, 4], [14, 3], [16, 2], [18, 1], [20, 0], [22, -1], [24, -2], [26, -2]],
  ];

  /* ---------- 조수(서브에이전트) 8×10 · 마스코트(토끼 후드) ---------- */
  const HELPER = ['..OOOO..', '.OSSSSO.', '.OSKSKSO', '..OSSO..', '.OBBBBO.', 'OBBBBBBO', '.OBBBBO.', '..OKOK..'];
  const MASCOT = {
    roam: ['..OO....OO..', '.OBLO..OLBO.', '.OBLO..OLBO.', '.OBLO..OLBO.', '.OBBOOOOBBO.', '.OBBBBBBBBO.', 'OBBWWWWWWBBO', 'OBWWWWWWWWBO', 'OBWWKWWKWWBO', 'OBWPWWWWPWBO', '.OWWWRRWWWO.', '.OBBBBBBBBO.', 'OBbBBBBBBbBO', 'OBbBBBBBBbBO', '.OBBBBBBBBO.', '..OKKO.OKKO.'],
    sleep: ['..OO....OO..', '.OBLO..OLBO.', '.OBLO..OLBO.', '.OBBOOOOBBO.', '.OBBBBBBBBO.', 'OBBWWWWWWBBO', 'OBWWWWWWWWBO', 'OBWKKWWKKWBO', 'OBWPWWWWPWBO', '.OWWWWWWWWO.', 'OBbBBBBBBbBO', 'OBbBBBBBBbBO', '.OOOOOOOOOO.'],
  };
  const MASCOT_LEGEND = { O: P.navy, B: P.sky, b: P.blue, L: P.pink, W: P.white, K: P.ink, P: P.pink, R: P.red };

  /* ---------- 가구·소품 ---------- */
  const WOOD = { h: P.tan, m: P.orange, d: P.rust, o: P.cocoa, k: P.bark };
  const DESK = [   // 42×22. 상판(h/m/d) · 앞판 · 다리
    '.oooooooooooooooooooooooooooooooooooooooo.',
    'ohhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhho',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'ohmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmo',
    'odddddddddddddddddddddddddddddddddddddddddo',
    '.oooooooooooooooooooooooooooooooooooooooo.',
    '..okko..................................okko',
    '..okko..................................okko',
    '..oooo..................................oooo',
  ];
  const MONITOR = [   // 16×12. o 외곽 · f 프레임 · s 화면 · g 화면 하이라이트 · t 스탠드
    '.oooooooooooooo.', 'offffffffffffffo', 'ofssssssssssssfo', 'ofsgggssssssssfo', 'ofsgssssssssssfo', 'ofssssssssssssfo', 'ofssssssssssssfo', 'ofssssssssssssfo', 'offffffffffffffo', '.oooooooooooooo.', '......ottto.....', '....ooooooooo...',
  ];
  const MONITOR_LEGEND = { o: P.ink, f: P.dusk, s: P.navy, g: P.blue, t: P.night };
  const MONITOR_DONE = Object.assign({}, MONITOR_LEGEND, { s: P.green, g: P.lime });
  const KEYBOARD = ['oooooooooooooooooo', 'ocscscscscscscscso', 'ocscscscscscscscso', 'oooooooooooooooooo'];
  const KEYBOARD_LEGEND = { o: P.slate, c: P.cloud, s: P.steel };
  const MUG = ['.ooo.', 'owwoo', 'owwoo', '.ooo.'];
  const MUG_LEGEND = { o: P.slate, w: P.white };
  const CHAIR = ['.oooooooo.', 'obbbbbbbbo', 'obhhhhhhbo', 'obbbbbbbbo', '.oooooooo.', '..o....o..', '.oo....oo.'];   // 10×7
  const CHAIR_LEGEND = { o: P.night, b: P.dusk, h: P.slate };
  const PLANT = ['....oo....', '...oLLo...', '..oLGLLo..', '.oLLGGLLo.', 'oLGGLLGGLo', 'oLLGGGLLLo', '.oGGoGGGo.', '..ooo.oo..', '..opppo...', '..opmpo...', '..ommmo...', '...ooo....'];   // 10×12
  const PLANT_LEGEND = { o: P.pine, L: P.lime, G: P.green, p: P.orange, m: P.rust };
  const FLOWERS = ['.P.Y.P.', 'PYPYPYP', '.P.Y.P.', '.oGGGo.', 'opppppo', 'opmmmpo', 'opmmmpo', '.ooooo.'];   // 7×8 (화분 꽃)
  const FLOWERS_LEGEND = { P: P.pink, Y: P.lemon, o: P.cocoa, G: P.green, p: P.orange, m: P.rust };
  const FOLDER = ['oooooooooo', 'oYYYYYYYYo', 'oyyyyyyyyo'];   // 서류철 한 권 10×3
  const FOLDER_LEGEND = { o: P.cocoa, Y: P.gold, y: P.flame };
  const SOFA = ['.oooooooooooooooooooo.', 'oRRRRRRRRRRRRRRRRRRRRo', 'oRrrrrrrrrrrrrrrrrrrRo', 'oRrRRRRRRRRRRRRRRRRrRo', 'oRrRRRRRRRRRRRRRRRRrRo', 'oRRRRRRRRRRRRRRRRRRRRo', '.oooooooooooooooooooo.', '..oo..............oo..'];   // 22×8
  const SOFA_LEGEND = { o: P.wine, R: P.red, r: P.pink };

  window.PX = { P, hex, nearest, ramp, paint, HEAD, HEAD_AT, EYES, BODY, BODY_AT, LEGS, LEGS_AT, SHADOW, HAIR, HAIR_AT, BEARD, BEARD_AT, ACC, FEATURE, OUTFIT, UNIFORM_EXTRA, CAP, CAP_AT, CAP_LEGEND, WHIP_FRAMES,
    HELPER, MASCOT, MASCOT_LEGEND, WOOD, DESK, MONITOR, MONITOR_LEGEND, MONITOR_DONE, KEYBOARD, KEYBOARD_LEGEND, MUG, MUG_LEGEND, CHAIR, CHAIR_LEGEND, PLANT, PLANT_LEGEND, FLOWERS, FLOWERS_LEGEND, FOLDER, FOLDER_LEGEND, SOFA, SOFA_LEGEND };
})();
