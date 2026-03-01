#!/bin/bash
# =============================================================================
# TAMS — Production Update Script
# =============================================================================
# Pulls latest code, installs dependencies, and rebuilds the server.
# Place this on your production server and run after deploying new code.
#
# Deployment location: /opt/tams (or wherever you cloned the repo)
# =============================================================================

set -euo pipefail

DEPLOY_DIR="/opt/tams"
LOG_PREFIX="[update_tams]"

echo "$LOG_PREFIX Starting update at $(date -u '+%Y-%m-%d %H:%M:%S UTC')..."

# Pull latest code (reset any local changes from yarn install / build artifacts)
cd "$DEPLOY_DIR"
echo "$LOG_PREFIX Resetting working tree..."
git reset --hard HEAD
echo "$LOG_PREFIX Pulling latest changes..."
git pull origin master

# Install dependencies
echo "$LOG_PREFIX Installing dependencies..."
corepack enable
corepack yarn install --immutable

# Build all workspace packages
echo "$LOG_PREFIX Building..."
corepack yarn build

echo "$LOG_PREFIX Update complete at $(date -u '+%Y-%m-%d %H:%M:%S UTC')."
