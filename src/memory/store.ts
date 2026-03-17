import { randomUUID } from 'crypto';
import type { AlmaDB } from '../db/database';
import type {
  Memory, InsertMemoryInput, InsertMemoryWithIdInput, SearchOptions, SearchResult, Role,
} from './types';
import { estimateTokens } from './tokenizer';
import { sanitizeFts } from '../fts/sanitizer';

// ---------------------------------------------------------------------------
// Row → domain
// ---------------------------------------------------------------------------
function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    role: row.role as Role,
    content: row.content as string,
    tokens: row.tokens as number,
    importance: row.importance as number,
    metadata: JSON.parse((row.metadata as string) ?? '{}'),
    tags: JSON.parse((row.tags as string) ?? '[]'),
    created_at: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export function insertMemory(db: AlmaDB, input: InsertMemoryInput): Memory {
  const id = randomUUID();
  const tokens = estimateTokens(input.content);
  const importance = input.importance ?? 0.5;
  const metadata = JSON.stringify(input.metadata ?? {});

  db.prepare(`
    INSERT INTO memories (id, session_id, role, content, tokens, importance, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.session_id, input.role, input.content, tokens, importance, metadata);

  return getMemoryById(db, id)!;
}

export function insertMemoryWithId(db: AlmaDB, input: InsertMemoryWithIdInput): Memory {
  const tokens = estimateTokens(input.content);
  const importance = input.importance ?? 0.5;
  const metadata = JSON.stringify(input.metadata ?? {});
  const created_at = input.created_at; // optional ISO string

  if (created_at) {
    db.prepare(`
      INSERT INTO memories (id, session_id, role, content, tokens, importance, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(input.id, input.session_id, input.role, input.content, tokens, importance, metadata, created_at);
  } else {
    db.prepare(`
      INSERT INTO memories (id, session_id, role, content, tokens, importance, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(input.id, input.session_id, input.role, input.content, tokens, importance, metadata);
  }

  return getMemoryById(db, input.id)!;
}

export function getMemoryById(db: AlmaDB, id: string): Memory | null {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToMemory(row) : null;
}

export function getMemoriesBySession(
  db: AlmaDB,
  session_id: string,
  limit = 200,
): Memory[] {
  const rows = db
    .prepare(
      'SELECT * FROM memories WHERE session_id = ? ORDER BY created_at ASC LIMIT ?',
    )
    .all(session_id, limit) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}

export function deleteMemory(db: AlmaDB, id: string): boolean {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateImportance(db: AlmaDB, id: string, importance: number): void {
  db.prepare('UPDATE memories SET importance = ? WHERE id = ?').run(importance, id);
}

export function addTag(
  db: AlmaDB,
  entityId: string,
  _entityType: string,
  tag: string,
): void {
  // Store tags as JSON array on the memory row — idempotent via read-modify-write
  const row = db
    .prepare('SELECT tags FROM memories WHERE id = ?')
    .get(entityId) as { tags: string } | undefined;
  if (!row) return;
  const tags: string[] = JSON.parse(row.tags ?? '[]');
  if (!tags.includes(tag)) {
    tags.push(tag);
    db.prepare('UPDATE memories SET tags = ? WHERE id = ?').run(
      JSON.stringify(tags),
      entityId,
    );
  }
}

export function getSessionIds(db: AlmaDB): string[] {
  const rows = db
    .prepare('SELECT DISTINCT session_id FROM memories ORDER BY session_id ASC')
    .all() as { session_id: string }[];
  return rows.map((r) => r.session_id);
}

// ---------------------------------------------------------------------------
// FTS search
// ---------------------------------------------------------------------------
export function searchMemories(
  db: AlmaDB,
  opts: SearchOptions,
): SearchResult[] {
  const q = sanitizeFts(opts.query);
  if (!q) return [];
  const limit = opts.limit ?? 20;

  let sql = `
    SELECT m.*, fts.rank,
           snippet(memories_fts, 0, '<b>', '</b>', '...', 10) AS snippet
    FROM memories_fts fts
    JOIN memories m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
  `;
  const params: unknown[] = [q];

  if (opts.session_id) {
    sql += ' AND m.session_id = ?';
    params.push(opts.session_id);
  }
  sql += ' ORDER BY fts.rank LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    memory: rowToMemory(row),
    score: -(row.rank as number), // rank is negative in FTS5
    snippet: (row.snippet as string) ?? '',
  }));
}
