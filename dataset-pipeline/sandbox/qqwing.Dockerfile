# Trusted qqwing: distro-signed apt package. Network used ONLY at build time.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends qqwing \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT []
