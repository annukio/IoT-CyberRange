FROM alpine:latest
RUN apk add --no-cache curl
# Send a fake telemetry request to the API every 5 seconds
CMD ["/bin/sh", "-c", "while true; do curl -s http://iot_api > /dev/null; echo 'Telemetry sent'; sleep 5; done"]