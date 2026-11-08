FROM node:22-slim AS build
WORKDIR /app
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build \
  # Next standalone file-tracing can miss nested normalizer modules on some
  # filesystems (QNAP), which then crash at boot with MODULE_NOT_FOUND.
  && mkdir -p .next/standalone/node_modules/next/dist/server/normalizers \
  && cp -a node_modules/next/dist/server/normalizers/. .next/standalone/node_modules/next/dist/server/normalizers/

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
