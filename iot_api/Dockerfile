FROM python:3.9-slim
RUN apt-get update && apt-get install -y iproute2 procps curl && \
    pip install --no-cache-dir flask && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY app.py .
CMD ["python", "app.py"]
