---
paths:
  - bin/office
  - hooks/**
---

# 런처 (bin/office, zsh) · 상태줄 래퍼

- `office up`/`restart` 는 웹 서버 API 를 호출한다. 출근 로직을 zsh 에 복제하지 않는다. tmux 직접 조작은 `down`·`status`·`attach` 뿐.
- 웹 서버 pid 는 `exec` 로 띄운 daphne 의 것이어야 한다. 서브셸 pid 를 적으면 옛 daphne 가 쌓인다(6개 쌓였던 사고). 종료는 pgrep 으로 한 번 더 정리.
- zsh 함정: `${x%_[0-9]##}` 는 EXTENDED_GLOB 없이는 안 됨(sed 사용). 함수 안 루프의 `local last` 재선언은 값을 출력한다(`local last=""`).
- 상태줄 래퍼(`hooks/office-statusline.sh`)는 원래 statusLine 명령을 `.generated/original-statusline.cmd` 에 보존하고 그대로 실행한다. `office statusline uninstall` 은 래퍼 경로가 자기 OFFICE_HOME 일 때만 건드린다(다른 clone 이 전역 상태줄을 지운 사고).
- 상시 실행은 `office up` 의 nohup+disown 으로 충분(터미널 닫아도 유지, `office down` 으로 종료). launchd 는 `~/Documents` 아래에서 TCC 때문에 불가라 선택 기능으로만 둔다. `~/Applications/Pixaude Office.app`(= `office up`) 만 쓴다.
- 이 세션(cc-ai)에서 복잡한 셸은 rtk 훅이 토큰(`echo ====`, `--include=`, `grep -v`)을 다시 써서 깨질 수 있다. 스크립트 파일로 저장해 `python3 file.py` 로 실행한다.
