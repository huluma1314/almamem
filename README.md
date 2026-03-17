# alma-lossless-memory

A lossless long-term memory store for AI agents, built on SQLite with FTS5 full-text search and a DAG-based summarization layer.

[![CI](https://github.com/huluma1314/almamem/actions/workflows/ci.yml/badge.svg)](https://github.com/huluma1314/almamem/actions/workflows/ci.yml)

## Features

- **Lossless storage** — every message is stored verbatim, nothing is discarded
- **FTS5 full-text search** — fast relevance-ranked retrieval across all memories
- **DAG summaries** — hierarchical summarization tree compresses history without data loss
- **Incremental summarization** — per-session checkpoint so repeated `summarize` is fast and idempotent
- **Context assembler** — smart token-budget-aware context window builder with de-duplication
- **Config file** — JSON config via `--config` for all default settings
- **Bulk ingest** — `ingest --json` accepts a JSON object or array from stdin
- **CLI** — `alm` command for all operations
- **TypeScript** — fully typed, CommonJS, Node 18+

## Quick Start

```bash
npm ci
npm run build

# Add memories
node dist/cli.js add my-session user "Hello, I am working on a TypeScript project"
node dist/cli.js add my-session assistant "Great! What kind of project?"

# Bulk ingest from JSON
echo '[{"role":"user","content":"msg1"},{"role":"assistant","content":"reply1"}]' \
  | node dist/cli.js ingest my-session --json

# Search
node dist/cli.js search "TypeScript" --session my-session

# Build DAG summaries (incremental — safe to re-run)
node dist/cli.js summarize my-session

# Assemble a context window
node dist/cli.js context my-session --query "TypeScript" --max-tokens 2000

# Assemble with debug token budget info
node dist/cli.js context my-session --debug
```

## Config File

Create a JSON file (e.g. `alma.config.json`) and pass it via `--config`:

```json
{
  "dbPath": "./my-project.db",
  "keepRecentRaw": 30,
  "leafChunkSize": 600,
  "fanIn": 4,
  "tokenBudget": 8000,
  "retrievalLimit": 50
}
```

```bash
node dist/cli.js --config alma.config.json context my-session
```

Config fields (all optional, fall back to defaults):

| Field | Default | Description |
|---|---|---|
| `dbPath` | `./alma.db` | Path to SQLite database (overridden by `ALMA_DB` env var) |
| `keepRecentRaw` | `20` | Recent raw messages kept outside summaries |
| `leafChunkSize` | `800` | Max tokens per leaf summary chunk |
| `fanIn` | `4` | Summary nodes merged per parent node |
| `tokenBudget` | `4000` | Default token budget for context assembly |
| `retrievalLimit` | `30` | Default FTS retrieval limit |

## CLI Reference

| Command | Description |
|---|---|
| `alm add <session> <role> <content>` | Insert a memory |
| `alm ingest <session> --json` | Bulk-ingest JSON from stdin (object or array) |
| `alm list <session>` | List memories for a session |
| `alm search <query>` | Full-text search |
| `alm sessions` | List all session IDs |
| `alm summarize <session>` | Build/update DAG summaries (incremental) |
| `alm roots <session>` | Show root summaries |
| `alm context <session>` | Assemble context window |
| `alm delete <id>` | Delete a memory by ID |
| `alm tg-poll` | Long-poll Telegram and ingest into SQLite |
| `alm alma-tail` | Tail Alma logs and ingest into SQLite |

Global options:
- `--config <path>` — path to JSON config file

Command options:
- `add -i, --importance <n>` — importance score 0-1 (default: 0.5)
- `list -n, --limit <n>` — max results (default: 50)
- `search -s, --session <id>` — filter by session
- `search -n, --limit <n>` — max results (default: 10)
- `context -q, --query <text>` — relevance query for FTS boost
- `context -t, --max-tokens <n>` — token budget (default: config `tokenBudget`)
- `context --debug` — print token budget usage breakdown

Environment variables:
- `ALMA_DB` — path to SQLite database file (default: `./alma.db`)

## Integrations

### Telegram (Bot API long-poll)

This ingests **all incoming updates** into the same SQLite database, storing the raw update JSON in `metadata` and using deterministic IDs to avoid duplicates.

```bash
# env var
export TELEGRAM_BOT_TOKEN="..."

# allowlist recommended
node dist/cli.js tg-poll \
  --allowlist 123456789,987654321 \
  --session-mode chat_topic \
  --offset-file ./tg.offset.json
```

Session mapping:
- `chat` → `tg:<chat_id>`
- `chat_topic` → `tg:<chat_id>:<message_thread_id>` (when thread id exists)

Deterministic IDs:
- normal: `tg:<chat_id>:<message_id>`
- edited: `tg:<chat_id>:<message_id>:edit:<edit_date>`

### Alma native logs (tail)

This tails Alma log files under `~/.config/alma/chats` and `~/.config/alma/groups` and ingests new lines incrementally.

```bash
node dist/cli.js alma-tail \
  --allowlist 123456789,987654321 \
  --session-mode chat_date \
  --state-file ./alma-tail.state.json
```

Session mapping:
- `chat` → `alma:<chatId>`
- `chat_date` → `alma:<chatId>:<YYYY-MM-DD>`
- `chat_msg` → `alma:<chatId>:<YYYY-MM-DD>:<msgId>`

Deterministic IDs:
- `alma:<chatId>:<YYYY-MM-DD>:<msgId>:<who>` (who = alma|user)

```
alma-lossless-memory/
├── src/
│   ├── db/
│   │   ├── database.ts        # SQLite connection + migrations
│   │   ├── migrations.ts      # Migration runner
│   │   └── schema.ts          # Schema SQL (v1-v4)
│   ├── memory/
│   │   ├── types.ts            # TypeScript interfaces
│   │   ├── tokenizer.ts        # Token estimation
│   │   └── store.ts            # CRUD + FTS5 search
│   ├── dag/
│   │   └── summarizer.ts      # Incremental DAG summary builder
│   ├── context/
│   │   └── assembler.ts       # Context window assembler (de-dup + debug)
│   ├── fts/
│   │   └── sanitizer.ts       # FTS5 query sanitizer
│   ├── config.ts              # JSON config loader
│   ├── cli.ts                 # Commander CLI
│   └── index.ts               # Public API exports
├── tests/
│   ├── memory.test.ts
│   ├── dag.test.ts
│   ├── context.test.ts
│   └── tokenizer.test.ts
└── .github/
    └── workflows/
        └── ci.yml             # GitHub Actions CI (Node 20 & 22)
```

## Development

```bash
npm ci          # install dependencies
npm run build   # compile TypeScript
npm test        # run Jest suite
npm run lint    # type-check only
```

## License

MIT
