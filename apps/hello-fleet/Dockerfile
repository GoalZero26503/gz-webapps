# syntax=docker/dockerfile:1
# Build context is the MONOREPO ROOT (the CDK stack arranges this). APP_DIR
# selects which app to build, so scaffolded copies of this file work unchanged.
ARG APP_DIR=apps/_template

# Build stage runs on the builder's native arch (no QEMU needed in CI); the
# runtime stage below is COPY-only, so BuildKit assembles the arm64 image
# without emulation. CAVEAT: this works because all prod deps are pure JS —
# if an app ever adds a native module, its node_modules become arch-specific
# and this must switch to a native arm64 runner or QEMU.
FROM --platform=$BUILDPLATFORM public.ecr.aws/docker/library/node:22-slim AS build
ARG APP_DIR
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY ${APP_DIR}/package.json ${APP_DIR}/
COPY packages/ packages/
RUN pnpm install --frozen-lockfile --filter "./${APP_DIR}"
COPY ${APP_DIR}/ ${APP_DIR}/
RUN pnpm --filter "./${APP_DIR}" build && \
    pnpm --filter "./${APP_DIR}" --prod deploy /out

# Runtime: plain Node container + Lambda Web Adapter extension. The adapter
# translates Lambda invocations into HTTP against the Fastify server, holding
# traffic until /healthz responds. The same image minus the adapter runs on
# any container host (ECS, local Docker) — Lambda is a deploy choice, not a
# code constraint.
FROM public.ecr.aws/docker/library/node:22-slim
ARG APP_DIR
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1-aarch64 /lambda-adapter /opt/extensions/lambda-adapter
ENV NODE_ENV=production \
    PORT=8080 \
    AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/healthz
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/${APP_DIR}/dist ./dist
COPY --from=build /repo/${APP_DIR}/views ./views
COPY --from=build /repo/${APP_DIR}/public ./public
EXPOSE 8080
CMD ["node", "dist/server.js"]
