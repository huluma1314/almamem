#!/usr/bin/env node
import { Command } from 'commander';
import { openDatabase, closeDatabase } from './db/database';
import {
  insertMemory,
  insertMemoryWithId,
  getMemoriesBySession,
  searchMemories,
  getSessionIds,
  deleteMemory,
} from './memory/store';
import { buildDagForSession, getRootSummaries } from './dag/summarizer';
import { assembleContext } from './context/assembler';
import { loadConfig } from './config';
import type { AlmaConfig } from './config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runTelegramPoll } from './integrations/telegram-poll';
import { runAlmaTail } from './integrations/alma-tail';
import type { TgSessionMode } from './integrations/telegram-utils';
import type { AlmaSessionMode } from './integrations/alma-log';

const program = new Command();
program
  .name('alm')
  .description('Alma lossless memory CLI')
  .version('0.1.0')
  .option('--config <path>', 'Path to JSON config file');

// Helper: resolve config + db once per command
function resolveConfig(cmdOpts: { config?: string }): Required<AlmaConfig> {
  return loadConfig(cmdOpts.config);
}

function expandTilde(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

program
  .command('add <session> <role> <content>')
  .description('Add a memory entry')
  .option('-i, --importance <n>', 'Importance 0-1', '0.5')
  .action((session, role, content, opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    const mem = insertMemory(db, {
      session_id: session,
      role,
      content,
      importance: parseFloat(opts.importance),
    });
    console.log(JSON.stringify(mem, null, 2));
    closeDatabase(db);
  });

program
  .command('ingest <session>')
  .description('Bulk-ingest memories from stdin (JSON object or array)')
  .option('--json', 'Read JSON from stdin')
  .action((session, opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    if (opts.json) {
      const raw = fs.readFileSync('/dev/stdin', 'utf-8');
      let items: unknown[];
      try {
        const parsed = JSON.parse(raw);
        items = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        console.error('Invalid JSON:', (e as Error).message);
        process.exit(1);
      }
      const results = items.map((item) => {
        const i = item as { role: string; content: string; importance?: number; metadata?: Record<string, unknown> };
        return insertMemory(db, {
          session_id: session,
          role: i.role as 'user' | 'assistant' | 'system' | 'tool',
          content: i.content,
          importance: i.importance,
          metadata: i.metadata,
        });
      });
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.error('Use --json flag to read from stdin');
      process.exit(1);
    }
    closeDatabase(db);
  });

program
  .command('list <session>')
  .description('List memories for a session')
  .option('-n, --limit <n>', 'Max results', '50')
  .action((session, opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    const mems = getMemoriesBySession(db, session, parseInt(opts.limit));
    console.log(JSON.stringify(mems, null, 2));
    closeDatabase(db);
  });

program
  .command('search <query>')
  .description('Full-text search memories')
  .option('-s, --session <id>', 'Filter by session')
  .option('-n, --limit <n>', 'Max results', '10')
  .action((query, opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    const results = searchMemories(db, {
      query,
      session_id: opts.session,
      limit: parseInt(opts.limit),
    });
    console.log(JSON.stringify(results, null, 2));
    closeDatabase(db);
  });

program
  .command('sessions')
  .description('List all session IDs')
  .action((_opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    console.log(getSessionIds(db).join('\n'));
    closeDatabase(db);
  });

program
  .command('summarize <session>')
  .description('Build/update DAG summaries for a session (incremental)')
  .action((session, _opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    const roots = buildDagForSession(db, session);
    console.log(JSON.stringify(roots, null, 2));
    closeDatabase(db);
  });

program
  .command('roots <session>')
  .description('Show root summaries for a session')
  .action((session, _opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    console.log(JSON.stringify(getRootSummaries(db, session), null, 2));
    closeDatabase(db);
  });

program
  .command('context <session>')
  .description('Assemble context window for a session')
  .option('-q, --query <text>', 'Relevance query')
  .option('-t, --max-tokens <n>', 'Token budget')
  .option('--debug', 'Print token budget usage')
  .action((session, opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    const ctx = assembleContext(db, {
      session_id: session,
      query: opts.query,
      maxTokens: opts.maxTokens ? parseInt(opts.maxTokens) : cfg.tokenBudget,
      retrievalLimit: cfg.retrievalLimit,
      debug: opts.debug,
    });
    console.log(JSON.stringify(ctx, null, 2));
    closeDatabase(db);
  });

program
  .command('delete <id>')
  .description('Delete a memory by ID')
  .action((id, _opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);
    const ok = deleteMemory(db, id);
    console.log(ok ? 'deleted' : 'not found');
    closeDatabase(db);
  });

// --- Integrations ---
program
  .command('tg-poll')
  .description('Long-poll Telegram Bot API and ingest into SQLite')
  .option('--token <token>', 'Telegram bot token (or env TELEGRAM_BOT_TOKEN)')
  .option('--allowlist <ids>', 'Comma-separated chat_id allowlist')
  .option('--session-mode <mode>', 'chat | chat_topic', 'chat_topic')
  .option('--offset-file <path>', 'Offset state file', './tg.offset.json')
  .option('--timeout <sec>', 'Long poll timeout seconds', '50')
  .action(async (opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);

    const token = String(opts.token ?? process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
    if (!token) {
      console.error('Missing --token or TELEGRAM_BOT_TOKEN');
      process.exit(1);
    }

    const allowlist = opts.allowlist
      ? String(opts.allowlist).split(',').map((s: string) => s.trim()).filter(Boolean)
      : undefined;

    await runTelegramPoll({
      db,
      token,
      allowlist,
      sessionMode: String(opts.sessionMode) as TgSessionMode,
      offsetFile: expandTilde(String(opts.offsetFile)),
      timeoutSec: parseInt(String(opts.timeout), 10) || 50,
    });

    closeDatabase(db);
  });

program
  .command('alma-tail')
  .description('Tail Alma log files (~/.config/alma/chats and groups) and ingest into SQLite')
  .option('--dirs <paths>', 'Comma-separated directories to watch')
  .option('--state-file <path>', 'State file storing per-file offsets', './alma-tail.state.json')
  .option('--allowlist <chatIds>', 'Comma-separated chatId allowlist')
  .option('--session-mode <mode>', 'chat | chat_date | chat_msg', 'chat_date')
  .option('--interval <ms>', 'Polling interval ms', '1000')
  .action(async (opts, cmd) => {
    const cfg = resolveConfig(cmd.parent?.opts() ?? {});
    const db = openDatabase(cfg.dbPath);

    const dirs = opts.dirs
      ? String(opts.dirs).split(',').map((s: string) => expandTilde(s.trim())).filter(Boolean)
      : undefined;
    const allowlist = opts.allowlist
      ? String(opts.allowlist).split(',').map((s: string) => s.trim()).filter(Boolean)
      : undefined;

    await runAlmaTail({
      db,
      dirs,
      stateFile: expandTilde(String(opts.stateFile)),
      allowlist,
      sessionMode: String(opts.sessionMode) as AlmaSessionMode,
      intervalMs: parseInt(String(opts.interval), 10) || 1000,
    });

    closeDatabase(db);
  });

program.parse();
