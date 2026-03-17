import type { AlmaDB } from '../db/database';
import { insertMemoryWithId } from '../memory/store';
import { listLogFiles } from './fs-utils';
import { readNewText } from './tail';
import {
  loadTailState,
  saveTailState,
  parseAlmaLogLine,
  type AlmaSessionMode,
} from './alma-log';
import os from 'os';
import path from 'path';

export type AlmaTailOptions = {
  db: AlmaDB;
  dirs?: string[];
  stateFile: string;
  allowlist?: string[];
  sessionMode: AlmaSessionMode;
  intervalMs: number;
};

function expandTilde(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export async function runAlmaTail(opts: AlmaTailOptions): Promise<void> {
  const dirs = (opts.dirs?.length
    ? opts.dirs
    : ['~/.config/alma/chats', '~/.config/alma/groups']
  ).map(expandTilde);

  const stateFile = expandTilde(opts.stateFile);
  const state = await loadTailState(stateFile);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const files = await listLogFiles(dirs);

    for (const filePath of files) {
      const fileInfo = state.files[filePath] ?? { pos: 0, carry: '' };
      const { text, newPos } = await readNewText(filePath, fileInfo.pos);
      if (!text) {
        state.files[filePath] = { ...fileInfo, pos: newPos };
        continue;
      }

      const combined = (fileInfo.carry ?? '') + text;
      const lines = combined.split(/\r?\n/);
      const last = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseAlmaLogLine(line, filePath, opts.sessionMode);
        if (!parsed) continue;
        if (opts.allowlist?.length && !opts.allowlist.includes(parsed.chatId)) continue;

        insertMemoryWithId(opts.db, {
          id: parsed.id,
          session_id: parsed.session_id,
          role: parsed.role,
          content: parsed.content,
          metadata: parsed.metadata,
          created_at: parsed.created_at,
        });
      }

      state.files[filePath] = { pos: newPos, carry: last };
    }

    await saveTailState(stateFile, state);
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}
