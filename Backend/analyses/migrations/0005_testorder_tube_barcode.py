from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("analyses", "0004_questionnaire"),
    ]

    operations = [
        migrations.AddField(
            model_name="testorder",
            name="tube_barcode",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Code-barre du tube utilisé pour ce test.",
                max_length=64,
            ),
        ),
    ]
