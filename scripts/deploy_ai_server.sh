#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-ai-server}"
REMOTE_ROOT="${REMOTE_ROOT:-/home/ai-server/01_PROJECTS/agentic-docs-handler}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
TORCH_INDEX_URL="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}"
TORCH_VERSION="${TORCH_VERSION:-2.10.0}"

ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_ROOT}"

rsync -az --delete \
  --exclude node_modules \
  --exclude .pytest_cache \
  --exclude __pycache__ \
  --exclude .venv \
  --exclude .git \
  --exclude server/logs/llm \
  --exclude server/logs/validation \
  --exclude dist \
  ./ "${REMOTE_HOST}:${REMOTE_ROOT}/"

ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_ROOT}/server/logs/llm ${REMOTE_ROOT}/server/logs/validation ${REMOTE_ROOT}/docs/validation"
ssh "${REMOTE_HOST}" "cd ${REMOTE_ROOT} && ${PYTHON_BIN} -m venv .venv && . .venv/bin/activate && pip install --upgrade pip && pip install --index-url ${TORCH_INDEX_URL} torch==${TORCH_VERSION} && pip install -r server/requirements.txt"
ssh "${REMOTE_HOST}" "cd ${REMOTE_ROOT} && test -f .env || cp .env.example .env"
ssh "${REMOTE_HOST}" "cd ${REMOTE_ROOT} && MODEL_LINE=\$(grep '^ADH_OLLAMA_MODEL=' .env.example) && if grep -q '^ADH_OLLAMA_MODEL=' .env; then sed -i \"s|^ADH_OLLAMA_MODEL=.*|\$MODEL_LINE|\" .env; else printf '%s\n' \"\$MODEL_LINE\" >> .env; fi"
ssh "${REMOTE_HOST}" "tmux kill-session -t adh-phase1 2>/dev/null || true"
ssh "${REMOTE_HOST}" "tmux kill-session -t adh-phase2 2>/dev/null || true"
ssh "${REMOTE_HOST}" "tmux kill-session -t adh-phase3 2>/dev/null || true"
ssh "${REMOTE_HOST}" "fuser -k 9000/tcp 2>/dev/null || true"
ssh "${REMOTE_HOST}" "cd ${REMOTE_ROOT} && tmux new-session -d -s adh-phase3 'cd ${REMOTE_ROOT} && . .venv/bin/activate && exec .venv/bin/uvicorn server.main:app --host 0.0.0.0 --port 9000 > server/logs/runtime.log 2>&1'"
ssh "${REMOTE_HOST}" "sleep 2 && curl -fsS http://127.0.0.1:9000/healthz >/dev/null"
ssh "${REMOTE_HOST}" "curl -fsS --max-time 180 'http://127.0.0.1:9000/search?query=warmup' >/dev/null"
