#!/bin/bash
cd "$(dirname "$0")"
MOCK_EMBEDDINGS=true node dist/test.js
