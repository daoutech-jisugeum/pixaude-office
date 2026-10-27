from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("office", "0002_employeestate")]
    operations = [migrations.DeleteModel(name="Meeting")]
