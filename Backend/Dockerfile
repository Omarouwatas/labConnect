# Dockerfile
FROM python:3.11-slim

# Définir les variables d'environnement
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Définir le répertoire de travail
WORKDIR /app

# Installer les dépendances système
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Installer les dépendances Python
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# Copier le projet
COPY . .

# Créer un utilisateur non-root
RUN adduser --disabled-password --gecos '' django-user
USER django-user

# Commande par défaut
CMD ["gunicorn", "labconnect.wsgi:application", "--bind", "0.0.0.0:8000"]