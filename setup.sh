#!/bin/bash

# YTM Free - Setup Script
# This script helps set up the development environment

echo "🎵 YTM Free Setup"
echo "=================="

# Check for yt-dlp
echo ""
echo "Checking yt-dlp installation..."
if command -v yt-dlp &> /dev/null; then
    VERSION=$(yt-dlp --version)
    echo "✅ yt-dlp found: $VERSION"
else
    echo "❌ yt-dlp not found!"
    echo ""
    echo "Install yt-dlp:"
    echo "  Windows: winget install yt-dlp"
    echo "  macOS:   brew install yt-dlp"
    echo "  Linux:   pip install yt-dlp"
    exit 1
fi

# Check for Node.js
echo ""
echo "Checking Node.js installation..."
if command -v node &> /dev/null; then
    VERSION=$(node --version)
    echo "✅ Node.js found: $VERSION"
else
    echo "❌ Node.js not found! Please install from https://nodejs.org/"
    exit 1
fi

# Check for Rust
echo ""
echo "Checking Rust installation..."
if command -v rustc &> /dev/null; then
    VERSION=$(rustc --version)
    echo "✅ Rust found: $VERSION"
else
    echo "❌ Rust not found! Install from https://rustup.rs/"
    exit 1
fi

# Install dependencies
echo ""
echo "Installing Node dependencies..."
npm install

# Generate Tauri icons (if tauri-cli is installed)
echo ""
echo "Checking Tauri CLI..."
if command -v cargo-tauri &> /dev/null || cargo tauri --version &> /dev/null; then
    echo "✅ Tauri CLI found"
    echo ""
    echo "To generate app icons from icon.svg:"
    echo "  cd src-tauri && cargo tauri icon icons/icon.svg"
else
    echo "⚠️  Tauri CLI not installed"
    echo "  Install: cargo install tauri-cli"
fi

echo ""
echo "=================="
echo "Setup complete! Run the app with:"
echo "  npm run tauri dev"
echo ""
