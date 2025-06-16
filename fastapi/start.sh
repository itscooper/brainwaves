#!/bin/sh
echo "==============================================="
echo "START.SH: Beginning startup sequence"
echo "START.SH: INIT_DB value is set to: '$INIT_DB'"
echo "==============================================="

# Convert to lowercase and trim whitespace
init_db_value=$(echo "$INIT_DB" | tr '[:upper:]' '[:lower:]' | xargs)

if [ "$init_db_value" = "true" ] || [ "$init_db_value" = "1" ] || [ "$init_db_value" = "yes" ]; then
    echo "START.SH: Initializing database..."
    cd /app && python -m api.init_db
else
    echo "START.SH: INIT_DB is not true, skipping initialization"
    echo "START.SH: (normalized INIT_DB value=$init_db_value)"
fi

echo "START.SH: Starting Uvicorn server..."
cd /app && exec uvicorn api.main:app --host 0.0.0.0 --port 8000