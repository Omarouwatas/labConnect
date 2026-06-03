# Adds CNAM split fields on TestOrder + audit field for biologist edits on TestResult.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('analyses', '0002_rename_catalog_lab_active_idx_analyses_te_laborat_66cc20_idx_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='testorder',
            name='cnam_covered_mru',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name='testorder',
            name='patient_due_mru',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name='testresult',
            name='original_value',
            field=models.CharField(blank=True, max_length=160),
        ),
    ]
