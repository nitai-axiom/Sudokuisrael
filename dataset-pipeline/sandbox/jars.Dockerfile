# Untrusted-tool image: HoDoKu + serate (SukakuExplainer). Acquired + integrity-verified
# entirely in build stages; nothing touches the host. Runtime stage carries only the
# verified artifacts + a JRE and is meant to be run with `docker run --network none`.

# ---- hodoku fetch stage: download + verify hash ----
FROM debian:bookworm-slim AS hodoku
ARG HODOKU_URL
ARG HODOKU_SHA256
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN curl -fsSL -o hodoku.jar "$HODOKU_URL" \
 && echo "${HODOKU_SHA256}  hodoku.jar" | sha256sum -c -

# ---- serate build stage: clone pinned commit + compile from source ----
# NOTE: At the pinned SukakuExplainer commit the repo is an Eclipse project (raw
# .java sources under diuf/, plus .classpath/.project) with NO pom.xml or build.xml,
# so it is NOT a Maven project. We honor the "build from source at a pinned commit"
# security rule by compiling the sources directly with the JDK 17 in this image
# (javac + jar). The commit-drift guard below still fails the build on drift.
# Sources are ISO-8859-1 encoded (degree symbols), hence -encoding ISO-8859-1.
# Main-class is diuf.sudoku.test.serate (the batch-rating entry point).
FROM maven:3-eclipse-temurin-17 AS serate
ARG SERATE_REPO
ARG SERATE_COMMIT
WORKDIR /src
RUN git clone "$SERATE_REPO" . \
 && git checkout "$SERATE_COMMIT" \
 && git rev-parse HEAD | grep -q "^${SERATE_COMMIT}"
RUN set -e \
 && mkdir -p out \
 && find diuf -name '*.java' > /tmp/srcs.txt \
 && javac -encoding ISO-8859-1 -d out @/tmp/srcs.txt \
 && find diuf -type f ! -name '*.java' -exec cp --parents {} out/ \; \
 && jar cfe /serate.jar diuf.sudoku.test.serate -C out .

# ---- runtime stage: JRE + artifacts only, no network at run ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
COPY --from=hodoku /opt/hodoku.jar /opt/hodoku.jar
COPY --from=serate /serate.jar /opt/serate.jar
ENTRYPOINT []
