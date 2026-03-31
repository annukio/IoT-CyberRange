FROM python:3.9-slim
# Install the networking tool needed to route traffic to the firewall
RUN apt-get update && apt-get install -y iproute2
WORKDIR /app