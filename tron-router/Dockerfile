# Use the official, lightweight Node.js 20 image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of your application code
COPY . .

# Expose the API port
EXPOSE 3000

# Default command (can be overridden by docker-compose)
CMD ["node", "src/index.js"]