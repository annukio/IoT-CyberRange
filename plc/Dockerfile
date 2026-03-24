FROM alpine:latest
# Install netcat to simulate an open Modbus port
RUN apk add --no-cache netcat-openbsd
# Keep port 502 open and listen indefinitely
CMD ["nc", "-l", "-k", "-p", "502"]