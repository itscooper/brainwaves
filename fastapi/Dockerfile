# Stage 1: Build the client with Parcel
FROM node:22 AS bwclient

WORKDIR /app

# Copy package.json and lockfile for dependency installation
COPY client/package.json ./
RUN npm install

# Copy the rest of the client source code and build it
COPY client/ ./
RUN npm run build

# Stage 2: Build and run the FastAPI server
FROM python:bookworm

# Set up pip configuration
RUN mkdir -p /root/.pip
COPY pip.conf /root/.pip/pip.conf
COPY api/requirements.txt /requirements.txt

# Install FastAPI dependencies
RUN pip install --no-cache-dir -r /requirements.txt

# Copy FastAPI application code
COPY api /app
WORKDIR /app

# Copy built client files from the Parcel build stage
COPY --from=bwclient /app/dist /client

# Set PYTHONPATH
ENV PYTHONPATH=/app

# Copy and set up startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["/app/start.sh"]
