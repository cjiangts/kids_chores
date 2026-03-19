# Kids Learning App - Docker Configuration for Railway

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (for better caching)
COPY backend/requirements.txt /app/backend/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the entire project
COPY . /app

# Create data directory for DuckDB files
RUN mkdir -p /app/backend/data

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/backend
ENV FLASK_ENV=production

# Expose port
EXPOSE 5001

# Run the Flask app with a production WSGI server
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-5001} --workers 1 --threads 8 --timeout 120 --access-logfile - --error-logfile - 'src.app:create_app()'"]
