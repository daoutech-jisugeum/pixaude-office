from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("office", "0003_delete_meeting")]
    operations = [migrations.AddField(model_name="report", name="meta", field=models.JSONField(blank=True, default=dict))]
