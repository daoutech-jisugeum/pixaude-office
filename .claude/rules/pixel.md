# 픽셀 아트 (sprites.js · game.js 그리기 함수 · favicon)

- **팔레트는 Endesga 32 하나** (`sprites.js` 의 `P`). 새 색을 만들지 않는다. 임의 색(팀 색)은 `X.nearest()`, 램프는 `X.ramp(base)` → `{hi, base, sh, ol}`.
- 스프라이트는 문자열 행 + legend 로 쓰고 `X.paint(g, rows, legend, x, y)` 로 찍는다. fillRect 를 직접 나열하지 않는다(소품의 큰 면만 예외).
- **1px 외곽선**, 색은 그 물체 램프의 가장 어두운 단계(순흑 금지, 머리카락이 벽에 묻힐 때만 ink). 면당 최대 3톤, 광원 왼쪽 위, 그림자는 파랑 쪽·하이라이트는 노랑 쪽.
- 금지: 필로우 셰이딩, 외톨이 픽셀, 16px 이하 안티앨리어싱, 소수 좌표·소수 패딩(글자 번짐). "1배에서 안 읽히면 디테일을 뺀다."
- 캐릭터 16×24 셀(x -8..7, y -15..9, 발끝 9), 2등신. 부품: HEAD/BODY/LEGS(3프레임)/HAIR 6/ACC 8/FEATURE 3/OUTFIT 3. 외모 조합(`describe`)은 시드라 같은 직원은 같은 얼굴.
- 캐릭터 안 레이어: `c.body_`(컨테이너: 그림자·다리·몸통·눈) · `c.whipG` · `c.icon`(11×13 말풍선 아이콘) · `c.bubG`+`c.bub`(말풍선) · `c.gauge`. `face()` 는 body_ 와 whipG 만 뒤집는다.
- 애니메이션은 장식: 걷기 다리 3프레임(`walkAnim`, walkPath 안), 눈 깜빡임(`blinkEv`), 작업 중 1px bob. 좌표·경로·상태 로직을 건드리지 않는다.
- 대표 모자 `CAP` 를 바꾸면 `python3 .claude/skills/verify-ui/favicon.py` 로 파비콘을 다시 만든다.
- 확인: 1배·2배(`__scene.game.scale.setZoom(2)`) 스크린샷 둘 다 본다. 글자는 `height == canvas.height`.
