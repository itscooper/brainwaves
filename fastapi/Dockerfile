# Stage 1: Build the client with Parcel
FROM node:22 AS bwclient

WORKDIR /app

# Copy package.json and lockfile for dependency installation
COPY fastapi/client/package.json ./
RUN npm install

# Copy the rest of the client source code and build it
COPY fastapi/client/ ./
RUN npm run build

# Stage 2: Build and run the FastAPI server
FROM python:bookworm

# Create app directory structure
WORKDIR /app

# Copy the entire api directory first
COPY fastapi/api /app/api

# Copy and install requirements
COPY fastapi/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Install our api package in development mode
RUN pip install -e /app

# Copy built client files from the Parcel build stage
COPY --from=bwclient /app/dist /app/client

# Copy and set up startup script
COPY fastapi/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Make sure Python can find our modules
ENV PYTHONPATH=/app

CMD ["/app/start.sh"]
