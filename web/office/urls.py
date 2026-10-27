from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("hook/<str:event>/", views.hook, name="hook"),
    path("api/state/", views.api_state),
    path("api/up/", views.api_up),
    path("api/reports/", views.api_reports),
    path("api/employees/<str:emp_id>/history/", views.api_history),
    path("api/employees/<str:emp_id>/commands/", views.api_commands),
    path("api/employees/<str:emp_id>/upload/", views.api_upload),
    path("api/employees/<str:emp_id>/restart/", views.api_restart),
    path("api/templates/<str:tid>/sessions/", views.api_sessions),
    path("api/teams/<str:tid>/mcp/", views.api_mcp),
    path("api/teams/<str:tid>/skills/", views.api_skills),
    path("api/mcp/catalog/", views.api_mcp_catalog),
    path("api/mcp/search/", views.api_mcp_search),
    path("api/dirs/", views.api_dirs),
]
