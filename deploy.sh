#!/bin/bash
# Deploy to Railway by pushing to origin/main
set -e

echo "=== Deploying to Railway ==="

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "Uncommitted changes detected:"
    git status -s
    echo ""
    read -p "Commit all changes before deploying? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Commit message: " msg
        git add -A
        git commit -m "$msg"
    else
        echo "Aborting. Commit your changes first."
        exit 1
    fi
fi

echo "Pushing to origin/main..."
git push origin main

echo ""
echo "=== Deployed! Railway will auto-build from the push. ==="
echo "Check status at: https://railway.app/dashboard"
