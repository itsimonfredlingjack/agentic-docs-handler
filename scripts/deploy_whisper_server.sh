#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-ai-server2}"
REMOTE_ROOT="${REMOTE_ROOT:-/home/ai-server2/01_PROJECTS/agentic-docs-handler}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
CUDA_LIBRARY_PATH="${CUDA_LIBRARY_PATH:-/usr/local/lib/ollama/cuda_v12}"

ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_ROOT}"

rsync -az --delete \
  --exclude node_modules \
  --exclude .pytest_cache \
  --exclude __pycache__ \
  --exclude .venv \
  --exclude .venv-whisper \
  --exclude .git \
  --exclude server/logs/llm \
  --exclude server/logs/validation \
  --exclude dist \
  ./ "${REMOTE_HOST}:${REMOTE_ROOT}/"

ssh "${REMOTE_HOST}" "cd ${REMOTE_ROOT} && rm -rf .venv-whisper && ${PYTHON_BIN} -m venv .venv-whisper && . .venv-whisper/bin/activate && pip install --upgrade pip && pip install -r whisper-server/requirements.txt"
ssh "${REMOTE_HOST}" "cd ${REMOTE_ROOT} && test -f .env || cp .env.example .env"
ssh "${REMOTE_HOST}" "tmux kill-session -t adh-whisper 2>/dev/null || true"
ssh "${REMOTE_HOST}" "fuser -k 8090/tcp 2>/dev/null || true"
ssh "${REMOTE_HOST}" "cd ${REMOTE_ROOT} && tmux new-session -d -s adh-whisper 'cd ${REMOTE_ROOT} && export LD_LIBRARY_PATH=${CUDA_LIBRARY_PATH}:\${LD_LIBRARY_PATH:-} && . .venv-whisper/bin/activate && exec ${PYTHON_BIN} whisper-server/whisper_server.py > whisper-server/runtime.log 2>&1'"
ssh "${REMOTE_HOST}" "sleep 2 && curl -fsS http://127.0.0.1:8090/healthz >/dev/null"
