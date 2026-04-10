# Agentic Docs Handler

Local-first AI Contextboard for personal and professional document libraries.

## What The Product Is

Agentic Docs Handler helps users do two things at the same time:

- see what they have
- chat with what they have

The app combines a visible folder structure with an always-present AI chat. Users can browse material manually, but they do not have to hunt through files to answer simple questions. The active folder gives both the user and the AI a shared frame of reference.

This is not a generic file manager with an assistant bolted on. It is also not just a raw RAG chat over an undifferentiated library. The product identity is the combination of:

- a clear folder-first mental model
- a chat-first working surface
- lightweight AI context around the active folder

## Core Value Proposition

The goal is to make a document library feel usable instead of merely stored.

Users should be able to:

- understand roughly where things live
- open and inspect files directly
- ask questions about the active folder without manually searching through everything
- keep control over rename, move, delete, and read flows

The app is local-first on macOS. The product focus is responsiveness, privacy, and grounded answers over the material the user already has.

## Current Product Model

The current shell follows one simple layout:

- left: folders
- middle: files in the active folder
- right: AI chat and contextboard

The left side gives orientation. The middle shows the concrete material. The right side is the main interaction surface, where the user asks questions and sees AI-derived context for the active folder.

The contextboard layer is intentionally lightweight in V1. It centers on:

- folder-scoped chat
- related files
- timeline and context signals
- a visible distinction between user-managed structure and AI-derived understanding

## What Is In Focus Now

The active direction for the product is:

- folder-scoped retrieval and chat
- fast switching between folders and files
- related-file signals that help the user understand what belongs together
- timeline hints that help users ask “what happened” questions
- smooth file management alongside AI assistance

Inbox still exists, but as an ingest surface rather than the core identity of the app.

## What Is No Longer The Product Identity

The project should no longer be framed as:

- workspace-first document management
- per-file chat as the main concept
- inbox-first or legacy triage as the primary experience
- Claude-specific workflow guidance

Older design docs and dated plans may still describe those phases. They remain useful as history, but they are not the current product truth.

## Current Technical Direction

- Frontend shell: folder rail, active-folder file list, chat-first right pane
- Backend: local FastAPI service owned by this app
- Primary local model target: `qwen3.5:9b`
- Context target for V1: medium context within the active folder, not deep reasoning over the entire library

## Documentation Rules

The active documentation model is:

- `README.md` = product truth
- `ARCHITECTURE.md` = current technical and implementation truth
- `docs/` = historical planning and reference material

When old plans disagree with the current product direction, follow this README first.
