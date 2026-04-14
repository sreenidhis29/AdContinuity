FROM mcr.microsoft.com/playwright:v1.50.0-focal

WORKDIR /app

# Copy package files from backend directory
COPY backend/package*.json ./

# Install production dependencies
RUN npm install --production

# Copy the rest of the backend source
COPY backend/ .

# Railway provides the PORT environment variable automatically
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]
