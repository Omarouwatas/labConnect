# Generated for CNAM coverage on PatientProfile.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0004_alter_staffprofile_user_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='patientprofile',
            name='cnam_number',
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name='patientprofile',
            name='cnam_coverage_pct',
            field=models.PositiveSmallIntegerField(
                default=0,
                help_text='0–100. 0 = pas couvert. Typique CNAM Mauritanie : 80.',
            ),
        ),
    ]
