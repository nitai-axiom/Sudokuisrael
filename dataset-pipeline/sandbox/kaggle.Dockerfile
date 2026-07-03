FROM node:22-alpine
RUN apk add --no-cache curl unzip coreutils
WORKDIR /work
