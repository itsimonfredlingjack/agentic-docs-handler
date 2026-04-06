# Workspace Chat Memory — Design Spec

## Context

Brainfileing's workspace chat answers questions about documents but has no memory between sessions. A user who asked "how much did I spend with Acme?" three months ago and asks again today gets a fresh answer with no awareness that this was asked before, no mention of what changed. This makes the AI feel stateless — a chatbot, not an intelligent workspace.

This feature gives the workspace chat persistent memory by including condensed past conversation summaries in the LLM context. The system already stores all conversation history via `ConversationRegistry`. It just doesn't use it.

## Design

### How it works

1. **Load history**: Fetch the last 20 conversation entries for the workspace from `ConversationRegistry`
2. **Condense**: Each entry compressed to ~60 tokens: `"{date}: Q: {query} A: {first 200 chars of response}"`
3. **Budget**: Allocate ~10% of the 16K context window (~1600 tokens) to workspace memory. Fill with most recent entries that fit.
4. **Inject**: Add a `WORKSPACE-HISTORIK` / `WORKSPACE HISTORY` section to the system prompt, before RAG results. Instruct the LLM to reference past conversations when relevant.
5. **Timestamp-awareness**: Include ISO timestamps on each entry so the LLM can say "since you asked on March 15..."

### What changes

**`server/pipelines/workspace_chat.py`**:
- New method `_prepare_memory_block(conversation_key, token_budget)` that:
  - Fetches past entries from `ConversationRegistry`
  - Skips the current session's entries (already in history)
  - Condenses each to a summary line
  - Returns a formatted text block that fits within token_budget
- In `_prepare_workspace_context()`: call `_prepare_memory_block()` and insert its output into the system message between the workspace stats and the RAG snippets
- In `_prepare_focused_workspace_context()`: same insertion point
- Adjust token budget allocation: reduce RAG from 20% to 15%, add memory at 10%

**`server/conversation_registry.py`**:
- Add method `list_recent_entries(conversation_key, limit=20, exclude_ids=None)` if not already available. Returns entries ordered by timestamp DESC.

**`server/prompts/sv/workspace_system.txt`** (and `en/` equivalent):
- Add instruction block: "Du har tillgång till användarens tidigare konversationer om denna workspace. Om relevant, referera till vad användaren frågat förut och vad som förändrats sedan dess."

### What does NOT change

- Frontend: zero changes. The AI naturally references memory in its responses.
- ConversationRegistry storage: already stores everything needed.
- Chat API contract: no new parameters.
- Token budget total: stays at 16K. Memory comes from reallocating within existing budget.

### Token budget (revised)

| Section | Before | After |
|---------|--------|-------|
| System prompt | 10% | 10% |
| Extracted fields table | 40% | 40% |
| Workspace memory | 0% | 10% |
| RAG snippets | 20% | 15% |
| History (current session) | 20% | 15% |
| Safety margin | 10% | 10% |

### Example output

**User asks**: "Hur mycket har jag spenderat med Acme?"

**System prompt includes**:
```
WORKSPACE-HISTORIK (tidigare samtal):
- 2026-03-15: F: "Vad är totala utgifterna med Acme?" S: "Baserat på 3 fakturor: 135 000 kr totalt. Senaste fakturan var från januari 2026 på 45 000 kr."
- 2026-02-20: F: "Har vi ett avtal med Acme?" S: "Ja, ett kommersiellt hyresavtal signerat 2025-12-01, giltigt till 2027-11-30."
```

**AI responds**: "Baserat på 5 fakturor i denna workspace har du spenderat totalt **215 000 kr** med Acme AB. Sedan du senast frågade (15 mars) har 2 nya fakturor tillkommit på sammanlagt 80 000 kr. Ni har även ett aktivt hyresavtal som löper till november 2027."

### Verification

1. Start backend with test workspace containing 10+ documents
2. Have a conversation asking about totals/entities
3. Close the app, restart
4. Ask a related question — AI should reference the previous conversation
5. Add new documents, ask again — AI should note what changed
6. Verify token budget doesn't overflow (check backend logs)
