#!/bin/bash
# Double-click this file on Mac to launch Tarot & Oracle
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  osascript -e 'display alert "Node.js required" message "Please install Node.js from https://nodejs.org (LTS version), then double-click this file again."'
  open "https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

echo "Starting Tarot & Oracle..."
npx electron .
