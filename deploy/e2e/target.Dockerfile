# a disposable "Linux host" for exercising the Ansible deployment.
#
# This is a throwaway SSH-reachable target (a container running systemd + sshd)
# that lets the Ansible role (`deploy/ansible/`) install Docker and deploy the
# collector/processor Compose stack end-to-end. Run it privileged with host
# cgroupns so the real `dockerd` the role installs works inside (Docker-in-systemd).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# sshd + the Python/apt tooling Ansible needs, plus sudo for the deploy user.
# The Ansible docker.yml role installs the rest (curl/gnupg/lsb-release/Docker).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssh-server \
        sudo \
        python3 \
        python3-apt \
        python3-debian \
        rsync \
        systemd \
        systemd-sysv \
        dbus \
        iproute2 \
        curl \
        gnupg \
        lsb-release \
    && rm -rf /var/lib/apt/lists/*

# The deploy user (locked password, key-only SSH), with passwordless sudo so
# the role's `become: true` works.
RUN useradd -m -s /bin/bash sirento \
    && mkdir -p /home/sirento/.ssh \
    && chmod 700 /home/sirento/.ssh \
    && echo 'sirento ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/sirento \
    && chmod 440 /etc/sudoers.d/sirento

# Accept a public key via build arg and install it as the only SSH credential.
# Password auth stays disabled.
ARG SSH_PUBLIC_KEY
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh \
    && echo "${SSH_PUBLIC_KEY}" > /home/sirento/.ssh/authorized_keys \
    && chown -R sirento:sirento /home/sirento/.ssh \
    && echo "PermitRootLogin no" >> /etc/ssh/sshd_config \
    && echo "PasswordAuthentication no" >> /etc/ssh/sshd_config

# Docker-in-Docker inside Rancher Desktop cannot nest overlayfs; pre-configure the
# dockerd the Ansible role installs to use the vfs storage driver. This is a
# dev-harness-only setting — a real host keeps its own storage driver.
RUN mkdir -p /etc/docker && echo '{"storage-driver": "vfs"}' > /etc/docker/daemon.json

# systemd as PID 1; the host mounts /sys/fs/cgroup and gives --privileged so the
# Ansible role's `systemctl start docker` works.
CMD ["/sbin/init"]
