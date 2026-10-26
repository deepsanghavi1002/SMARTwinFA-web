FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/.openai ./.openai
COPY --from=build /app/vite.config.ts /app/next.config.ts ./
# The invite command (scripts/auth-invite.mts) and the sources it runs, for: docker exec <client>-web node scripts/auth-invite.mts ...
COPY --from=build /app/scripts/auth-invite.mts ./scripts/
COPY --from=build /app/lib/db.ts ./lib/
COPY --from=build /app/lib/auth ./lib/auth
EXPOSE 3000
CMD ["npm", "run", "start", "--", "--host", "0.0.0.0"]
