# Use the official Playwright image that matches our package.json version
FROM mcr.microsoft.com/playwright:v1.49.0-focal

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install

# Install the chromium browser specifically (even though image has it, this ensures the links are correct)
RUN npx playwright install chromium

# Copy the source code
COPY backend/ .

# Ensure the app binds to 0.0.0.0 so Railway can reach it
ENV PORT=3001
EXPOSE 3001

# Clean up any cache to keep the image slim
RUN rm -rf /root/.cache

CMD ["node", "server.js"]
