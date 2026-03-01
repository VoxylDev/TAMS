#!/bin/bash
# Enables the ltree extension required by TAMS.
# Runs automatically as a PostgreSQL init script in Docker.

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS ltree;
EOSQL
