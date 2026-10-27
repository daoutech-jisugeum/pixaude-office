from django.urls import path

from .consumers import BrowserConsumer
from .terminal import TerminalConsumer

websocket_urlpatterns = [
    path("ws/office/", BrowserConsumer.as_asgi()),
    path("ws/term/<str:iid>/", TerminalConsumer.as_asgi()),
]
