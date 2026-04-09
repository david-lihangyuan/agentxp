#!/bin/bash
cd "$(dirname "$0")"
export MOCK_EMBEDDINGS=true
export DB_URL="file::memory:"
node dist/test.js
