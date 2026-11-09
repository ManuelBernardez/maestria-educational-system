FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements-prod.txt ./requirements-prod.txt
RUN pip install --no-cache-dir -r requirements-prod.txt
COPY backend ./backend
COPY frontend ./frontend
WORKDIR /app/backend
RUN DEBUG=True DJANGO_SECRET_KEY=build-only-not-a-production-secret python manage.py collectstatic --noinput
EXPOSE 8000
CMD ["sh", "-c", "gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --worker-class gthread --workers 2 --threads 6 --timeout 150 --keep-alive 5 --access-logfile - --error-logfile -"]
