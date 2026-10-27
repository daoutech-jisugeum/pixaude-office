from django.db import models


class Message(models.Model):
    """직원별 발화 기록 (지시·보고·귓속말·질문·시스템). 브라우저엔 웹소켓으로 흘리고 DB 는 기록용."""

    CHANNELS = [
        ("order", "지시"), ("reply", "응답"), ("whisper", "귓속말"),
        ("report", "보고"), ("question", "질문"), ("system", "시스템"),
    ]
    employee = models.CharField(max_length=64, db_index=True)
    channel = models.CharField(max_length=16, choices=CHANNELS, db_index=True)
    peer = models.CharField(max_length=64, blank=True, default="")
    text = models.TextField()
    session_id = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def as_dict(self):
        return {
            "id": self.id, "employee": self.employee, "channel": self.channel,
            "peer": self.peer, "text": self.text, "ts": self.created_at.isoformat(),
        }


class Report(models.Model):
    """Stop 시점의 마지막 응답 = 보고. 대표가 확인하면 read_at."""

    employee = models.CharField(max_length=64, db_index=True)
    summary = models.TextField()
    session_id = models.CharField(max_length=64, blank=True, default="")
    meta = models.JSONField(default=dict, blank=True)   # {"diff": repo.diff_stat, "lines": {added, removed}, "cwd": 실제 작업 경로(worktree)}
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def as_dict(self):
        return {
            "id": self.id, "employee": self.employee, "summary": self.summary,
            "ts": self.created_at.isoformat(), "read": self.read_at is not None, "meta": self.meta or {},
        }


class EmployeeState(models.Model):
    """직원(인스턴스) 상태 스냅샷. 웹 서버를 재시작해도 상태·미읽음·메모 큐·마지막 알림이 이어지도록 상태가 바뀔 때마다 저장한다."""

    iid = models.CharField(max_length=64, primary_key=True)
    data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)
