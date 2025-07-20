# Use official Node.js runtime with FFmpeg
FROM node:18-slim

# Install FFmpeg and required dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (production only, no dev dependencies)
RUN npm ci --only=production

# Copy app source (only the files we need)
COPY index.js ./
COPY deploy.sh ./

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]