#!/bin/bash
cd /c/Users/gglig/.ytm-free

echo "Starting Tauri dev..."
npm run tauri dev 2>&1 &
TAURI_PID=$!

echo "Waiting for app to start..."
sleep 25

echo "Checking Vite..."
curl -s http://localhost:5173 2>&1 | head -5

echo "Checking stream server..."
curl -s http://localhost:3456/health 2>&1

echo "Checking if app is still running..."
if kill -0 $TAURI_PID 2>/dev/null; then
    echo "App is running (PID: $TAURI_PID)"
else
    echo "App has exited"
fi
