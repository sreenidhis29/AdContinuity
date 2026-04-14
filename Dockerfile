# Use the most stable Jammy-based Playwright image
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install

# Ensure browsers are installed
RUN npx playwright install chromium

# Copy the source code
COPY backend/ .

# Sync with Railway's default Port
ENV PORT=8080
EXPOSE 8080

# Production Config
ENV NODE_ENV=production

# Clean up
RUN rm -rf /root/.cache

CMD ["node", "server.js"]
