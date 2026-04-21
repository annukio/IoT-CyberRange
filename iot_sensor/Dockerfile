FROM python:3.9-slim
RUN apt-get update && apt-get install -y iproute2 curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY sensor.py .
CMD ["/bin/sh", "-c", "while true; do curl -s http://172.21.0.10/ > /dev/null 2>&1; echo 'Telemetry sent'; sleep 5; done"]
