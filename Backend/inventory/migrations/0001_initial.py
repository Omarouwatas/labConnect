# Initial migration for the inventory app.

import uuid

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('laboratories', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='InventoryItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uuid', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('name', models.CharField(db_index=True, max_length=160)),
                ('code', models.CharField(blank=True, db_index=True, help_text='Référence interne / SKU (facultatif).', max_length=40)),
                ('category', models.CharField(choices=[('reagent', 'Réactif'), ('consumable', 'Consommable'), ('equipment', 'Équipement'), ('other', 'Autre')], db_index=True, default='reagent', max_length=12)),
                ('unit', models.CharField(default='unité', help_text='Ex : "boîte de 100", "mL", "tube", "kit".', max_length=24)),
                ('current_stock', models.DecimalField(decimal_places=2, default=0, max_digits=12, validators=[django.core.validators.MinValueValidator(0)])),
                ('min_stock', models.DecimalField(decimal_places=2, default=0, help_text="Seuil d'alerte. 0 = pas d'alerte.", max_digits=12, validators=[django.core.validators.MinValueValidator(0)])),
                ('unit_cost_mru', models.DecimalField(decimal_places=2, default=0, help_text="Coût unitaire d'achat (informatif, pour valoriser le stock).", max_digits=10, validators=[django.core.validators.MinValueValidator(0)])),
                ('supplier', models.CharField(blank=True, max_length=160)),
                ('notes', models.TextField(blank=True)),
                ('laboratory', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='inventory_items', to='laboratories.laboratory')),
            ],
            options={
                'verbose_name': 'inventory item',
                'verbose_name_plural': 'inventory items',
                'ordering': ('name',),
            },
        ),
        migrations.CreateModel(
            name='InventoryMovement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uuid', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('delta', models.DecimalField(decimal_places=2, max_digits=12)),
                ('reason', models.CharField(choices=[('delivery', 'Livraison'), ('consumption', 'Consommation'), ('adjustment', "Ajustement d'inventaire"), ('expiry', 'Péremption / casse')], max_length=16)),
                ('notes', models.CharField(blank=True, max_length=255)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='inventory_movements', to=settings.AUTH_USER_MODEL)),
                ('item', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='movements', to='inventory.inventoryitem')),
            ],
            options={
                'verbose_name': 'inventory movement',
                'verbose_name_plural': 'inventory movements',
                'ordering': ('-created_at',),
            },
        ),
        migrations.AddIndex(
            model_name='inventoryitem',
            index=models.Index(fields=['laboratory', 'category'], name='inventory_i_laborat_5b7a6f_idx'),
        ),
        migrations.AddIndex(
            model_name='inventorymovement',
            index=models.Index(fields=['item', '-created_at'], name='inventory_m_item_id_1f8e25_idx'),
        ),
    ]
