# Whisper Server

Separat FastAPI-runtime för blueprintens Fas 3 på `ai-server2` / RTX 2060.

Nuvarande runtime:

- `whisper_server.py` startar FastAPI på port `8090`
- `faster-whisper` kör `large-v3-turbo` via modellidentifieraren `turbo`
- svenska och engelska stöds via auto-detektion eller explicit `language`
- orchestratorn på `server/main.py` proxar all access via `/transcribe`
