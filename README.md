# ∿ AI-Docs: The Cognitive Mailroom

> This is not a boring SaaS document manager. This is a "Cognitive Mailroom". It is a premium, localized, privacy-first (local LLMs via Ollama) AI document processing engine.

## 👁️ The Vision & UI Philosophy

AI-Docs is built on a **Tactical Canvas** design language. We believe that interacting with your most sensitive data should feel commanding, fluid, and secure.

*   **Dark Mode Native:** Designed entirely in deep, low-emittance dark tones to reduce fatigue during high-volume document triage.
*   **Heavy Glassmorphism:** Z-index HUDs and floating panels utilize backdrop-blur layers, creating spatial depth and focus without losing context of the underlying workspace.
*   **Typography Dichotomy:** A strict, purposeful separation of fonts.
    *   **Inter** drives the UI—smooth, legible, and un-opinionated.
    *   **JetBrains Mono** surfaces all AI-extracted data, rendering JSON, amounts, and programmatic context with surgical monospace precision.

## ⚡ Core Features

| Feature | Description |
| :--- | :--- |
| **The Activity Feed** | Triage your daily inbound documents in a fast, floating glass grid. Instantly see classifications and extracted metadata as items hit the mailroom. |
| **X-Ray Search** | **<200ms** hybrid search that reveals the exact context snippet directly in the list, with keywords highlighted instantly. |
| **Smart Workspaces (Scoped RAG)** | Chat with specific document folders using an Analyst Notebook interface (no ugly iMessage chat bubbles, just pure data streaming with a GhostTyping effect). |
| **Total Privacy** | 100% Air-gapped and zero-trust by default. Everything runs locally using Ollama for LLMs and LanceDB for vector storage. Your data never leaves your machine. |

## 🧠 How It Works (The Pipeline)

Our architecture strictly separates Heavy-LLM tasks, Fast-ML tasks, and Lightning-Search tasks to optimize for both latency and accuracy.

> **1. Ingestion**
> User drops a file (PDF, image, text) → Pipeline starts.

> **2. Classification (LLM Step 1)**
> Text is sent to a local LLM (e.g., Qwen 3.5).
> * **Prompt:** `"What is this document?"`
> * **Output:** JSON (Type: receipt/invoice/contract, title, summary, tags).

> **3. Extraction (LLM Step 2)**
> Text is processed again through the LLM for deep contextual harvesting.
> * **Prompt:** `"Extract key fields."`
> * **Output:** Contextual JSON (amounts, dates, vendors).

> **4. Indexing (ML, No LLM)**
> Text runs through a local Sentence Transformer model to create embeddings (vectors) and is stored in LanceDB.

> **5. Lightning Search (No LLM)**
> Hybrid search (Vector similarity + Keyword match). Because no LLM is involved here, search returns contextual snippets with highlighted keywords in <200ms.

> **6. Workspace Chat (LLM Step 3 - RAG)**
> Users can enter a "Workspace" (e.g., the Receipts folder) and ask questions. The system performs a scoped vector search strictly within that folder, builds a prompt, and streams the synthesized answer back using Server-Sent Events (SSE) into a clean "Analyst Notebook" UI.

## 🏗️ Tech Stack

| Domain | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Core** | React + Vite | Lightning-fast HMR and optimized production builds. |
| **Styling & UI** | Tailwind CSS | Utility-first styling powering the glassmorphism and layout grids. |
| **Backend API** | Python + FastAPI | High-concurrency async endpoints and SSE streaming. |
| **AI Inference** | Ollama | Local LLM runner (Qwen 3.5) for 100% private processing. |
| **Vector Engine** | LanceDB | Serverless, edge-native vector database for sub-200ms similarity search. |

## 🚀 Getting Started / Installation

*(Ensure Docker and Ollama are installed on your host machine before proceeding).*

```bash
# 1. Clone the repository
git clone https://github.com/your-org/ai-docs.git
cd ai-docs

# 2. Start the local AI Engine (Ollama)
ollama run qwen:3.5

# 3. Spin up the environment
docker-compose up -d --build
```

---
*Built for those who demand total control over their data.*