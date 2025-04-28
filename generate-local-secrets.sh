#!/bin/bash

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    # Generate a secure random password
    RANDOM_PASSWORD=$(openssl rand -base64 32)
    
    # Create .env file with the password
    echo "POSTGRES_PASSWORD=$RANDOM_PASSWORD" > .env
    echo "Created new .env file with secure random password"
else
    echo ".env file already exists, keeping existing configuration"
fi
