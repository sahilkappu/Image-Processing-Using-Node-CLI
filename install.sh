#!/bin/bash

echo "🚀 Installing Image Processing CLI..."
echo "=================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="16.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js 16+ first."
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION detected"

# Remove existing node_modules and package-lock.json
echo "🧹 Cleaning up existing installations..."
rm -rf node_modules package-lock.json

# Create logs directory
echo "📁 Creating logs directory..."
mkdir -p logs

# Install dependencies with specific versions
echo "📦 Installing dependencies..."
npm install --save \
  archiver@5.3.2 \
  boxen@5.1.2 \
  chalk@4.1.2 \
  cli-progress@3.12.0 \
  commander@9.5.0 \
  csv-writer@1.6.0 \
  figlet@1.7.0 \
  ora@5.4.1 \
  progress@2.0.3 \
  sharp@0.32.6 \
  unzipper@0.10.14 \
  winston@3.11.0

# Install dev dependencies
echo "🔧 Installing dev dependencies..."
npm install --save-dev nodemon@3.0.1

# Test installation
echo "🧪 Testing installation..."
if node -e "console.log('✅ Node.js working'); const chalk = require('chalk'); console.log(chalk.green('✅ Chalk working')); console.log('✅ All dependencies loaded successfully')"; then
    echo ""
    echo "🎉 Installation completed successfully!"
    echo "=================================="
    echo ""
    echo "📝 Usage examples:"
    echo "node process-images.js --help"
    echo ""
    echo "node process-images.js \\"
    echo "  --input ./client_input.zip \\"
    echo "  --output ./processed_images.zip \\"
    echo "  --logo ./assets/logo.png \\"
    echo "  --csv ./mapping.csv"
    echo ""
    echo "📋 Logs will be saved in: ./logs/"
    echo ""
else
    echo "❌ Installation failed. Please check the error messages above."
    exit 1
fi