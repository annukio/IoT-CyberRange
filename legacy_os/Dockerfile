# Use Ubuntu 18.04 (End of Standard Support: 2023) to act as our Legacy OS
FROM ubuntu:18.04

# Prevent apt-get from getting stuck asking for user input
ENV DEBIAN_FRONTEND=noninteractive

# Since 18.04 repos are still alive, we don't need any hacky archive links!
RUN apt-get update && apt-get install -y \
    telnetd \
    openbsd-inetd \
    samba \
    iptables \
    iproute2 \
    nano \
    && rm -rf /var/lib/apt/lists/*

# Configure a dummy SMB share to make it look realistic
RUN echo "[ot_share]\n   path = /tmp\n   browseable = yes\n   guest ok = yes" >> /etc/samba/smb.conf

# Start the insecure services and keep the container running
CMD /etc/init.d/openbsd-inetd start && /etc/init.d/smbd start && tail -f /dev/null