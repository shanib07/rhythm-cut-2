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

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]