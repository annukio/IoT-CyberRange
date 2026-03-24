# Use the official Kali Linux rolling image
FROM kalilinux/kali-rolling

# Install the basic networking and scanning tools the student will need
RUN apt-get update && apt-get install -y \
    nmap \
    iputils-ping \
    iproute2 \
    netcat-traditional \
    nano \
    curl

# Keep the container running in the background so the student can access it
CMD ["sleep", "infinity"]