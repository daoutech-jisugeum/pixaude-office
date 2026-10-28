import hashlib
import os
from pathlib import Path

from office.services.hooks import load_token

BASE_DIR = Path(__file__).resolve().parent.parent
OFFICE_HOME = Path(os.environ.get("OFFICE_HOME") or BASE_DIR.parent).resolve()


def _server_cfg() -> dict:
    try:
        import yaml

        with open(OFFICE_HOME / "company.yaml", encoding="utf-8") as f:
            return (yaml.safe_load(f) or {}).get("server") or {}
    except Exception:  # noqa: BLE001  (첫 실행 전엔 파일이 없을 수 있다)
        return {}


_SERVER = _server_cfg()
OFFICE_PORT = int(os.environ.get("OFFICE_PORT") or _SERVER.get("port") or 4800)
TMUX_SESSION = str(_SERVER.get("tmux_session") or "office")
WEATHER_CMD = str(_SERVER.get("weather_cmd") or "")
_W = _SERVER.get("weather") or {}
WEATHER_LAT = float(_W.get("lat") or 37.4386)   # 기본 성남시 (Open-Meteo 무료 API, 키 불필요)
WEATHER_LON = float(_W.get("lon") or 127.1378)
NOTIFY_MACOS = bool(_SERVER.get("notify_macos") or False)   # 질문·오류 때 macOS 알림(osascript). 브라우저 알림과 별개
EDITOR_CMD = str(_SERVER.get("editor") or "")              # 「IDE 에서 열기」 명령 (code · cursor · idea). 비우면 PATH 에서 탐지
# 화면 긁기 패턴·훅을 실제로 확인한 Claude Code 버전 범위. 밖이면 런처 doctor/up 과 상단바에 경고만 (동작은 막지 않음)
CLAUDE_TESTED = ("2.1.299", "2.1.312")

OFFICE_TOKEN = load_token(OFFICE_HOME)          # 브라우저·훅·상태줄이 쓰는 설치별 비밀 (.office-token)
SECRET_KEY = hashlib.sha256(("django:" + OFFICE_TOKEN).encode()).hexdigest()
DEBUG = os.environ.get("OFFICE_DEBUG") == "1"
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

# 로그인·세션·admin 은 쓰지 않는다 (127.0.0.1 전용 + 설치 토큰)
INSTALLED_APPS = ["daphne", "django.contrib.staticfiles", "channels", "office"]
MIDDLEWARE = ["django.middleware.common.CommonMiddleware"]

ROOT_URLCONF = "config.urls"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [], "APP_DIRS": True, "OPTIONS": {}}]

ASGI_APPLICATION = "config.asgi.application"
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": OFFICE_HOME / "office.sqlite3", "OPTIONS": {"timeout": 5}}}   # 훅·tick 동시 쓰기 → "database is locked" 방지

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

COMPANY_YAML = OFFICE_HOME / "company.yaml"
UPLOAD_DIR = OFFICE_HOME / "uploads"   # 대화창에 붙인 이미지 저장소. 직원별 하위 폴더만 그 세션에 --add-dir
