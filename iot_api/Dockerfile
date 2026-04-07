FROM python:3.9-slim
# Install networking tools for routing, and procps so the student can use 'pkill'
RUN apt-get update && apt-get install -y iproute2 procps
WORKDIR /app