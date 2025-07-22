# Use official Node.js runtime with FFmpeg
FROM node:18-slim

# Install FFmpeg and required dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --omit=dev

# Run build script (no-op for this service)
RUN npm run build

# Copy app source
COPY index.js ./

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "index.js"]