# Pre-test questionnaire on catalog + answers snapshot on TestOrder.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('analyses', '0003_testorder_cnam_split_testresult_original_value'),
    ]

    operations = [
        migrations.AddField(
            model_name='testcatalogentry',
            name='prerequisite_questions',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='testorder',
            name='prerequisite_answers',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='testorder',
            name='prerequisite_questions_snapshot',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
