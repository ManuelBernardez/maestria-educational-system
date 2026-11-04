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
CMD ["sh", "-c", "gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 90 --access-logfile - --error-logfile -"]
