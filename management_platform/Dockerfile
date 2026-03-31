# Use Node.js LTS
FROM node:18-bullseye

# 1. Install build tools for node-pty and the Docker CLI
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    && curl -fsSL https://get.docker.com | sh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. Copy dependency files
COPY package.json ./

# 3. Install dependencies
RUN npm install

# 4. Copy the rest of the code (index.html, server.js)
COPY . .

EXPOSE 3000

# 5. Start the server
CMD ["node", "server.js"]