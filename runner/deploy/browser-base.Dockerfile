# office-runner browser base: the pinned Node 22 image plus Playwright's headless Chromium and the
# system libraries it needs. Built once by the operator from this reviewed file (install.sh
# --with-browser-base); app builds only ever start FROM it, under runsc.
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@1.65.0 install --with-deps --only-shell chromium \
 && chown -R 10001:10001 /ms-playwright \
 && rm -rf /root/.npm /root/.cache /tmp/* /var/lib/apt/lists/*
LABEL office.runner=base org.opencontainers.image.description="Node 22 + Playwright 1.65.0 chromium-headless-shell"
