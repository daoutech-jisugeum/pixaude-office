"""설치 토큰 검사. /api·/hook 뷰는 token_required, 웹소켓 컨슈머는 token_ok."""
from functools import wraps
from urllib.parse import parse_qs

from django.conf import settings
from django.http import HttpResponseForbidden


def token_required(view):
    """X-Office-Token 헤더 또는 ?t= 가 설치 토큰과 같아야 한다. 페이지(index)는 토큰을 템플릿에 넣어준다."""

    @wraps(view)
    def inner(request, *a, **kw):
        t = request.headers.get("X-Office-Token") or request.GET.get("t", "")
        if t != settings.OFFICE_TOKEN:
            return HttpResponseForbidden("bad token")
        return view(request, *a, **kw)

    return inner


def token_ok(scope) -> bool:
    qs = parse_qs(scope.get("query_string", b"").decode())
    return (qs.get("t") or [""])[0] == settings.OFFICE_TOKEN
