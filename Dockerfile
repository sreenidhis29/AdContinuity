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

# Production Config
ENV PORT=3001
ENV NODE_ENV=production
EXPOSE 3001

# Clean up
RUN rm -rf /root/.cache

CMD ["node", "server.js"]
