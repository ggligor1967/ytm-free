#!/bin/bash

# YTM Free - Setup Script
# This script helps set up the development environment

echo "🎵 YTM Free Setup"
echo "=================="

# Check for yt-dlp
echo ""
echo "Checking yt-dlp installation..."
MIN_YTDLP_VERSION="2026.08.19"

if command -v yt-dlp &> /dev/null; then
    VERSION=$(yt-dlp --version)

    if [[ "$VERSION" =~ ^([0-9]{4})\.([0-9]{1,2})\.([0-9]{1,2}) ]]; then
        YEAR=$((10#${BASH_REMATCH[1]}))
        MONTH=$((10#${BASH_REMATCH[2]}))
        DAY=$((10#${BASH_REMATCH[3]}))

        if (( MONTH < 1 || MONTH > 12 || DAY < 1 || DAY > 31 )); then
            echo "❌ Unrecognized yt-dlp version: $VERSION"
            exit 1
        fi

        VERSION_KEY=$((YEAR * 10000 + MONTH * 100 + DAY))
        MIN_VERSION_KEY=20260819

        if (( VERSION_KEY < MIN_VERSION_KEY )); then
            echo "❌ yt-dlp $MIN_YTDLP_VERSION or newer is required. Found: $VERSION"
            echo "   Update yt-dlp before continuing."
            exit 1
        fi

        echo "✅ yt-dlp found: $VERSION (minimum $MIN_YTDLP_VERSION)"
    else
        echo "❌ Unable to verify yt-dlp version: $VERSION"
        exit 1
    fi
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
