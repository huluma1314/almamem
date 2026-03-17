import type { AlmaDB } from '../db/database';
import { insertMemoryWithId } from '../memory/store';
import {
  tgContentFromMessage,
  tgDeterministicId,
  tgSessionId,
  type TgSessionMode,
  type TgUpdate,
  type TgMessageLike,
} from './telegram-utils';
import fs from 'fs/promises';

export type TgPollOptions = {
  db: AlmaDB;
  token: string;
  allowlist?: string[]; // chat_id strings
  sessionMode: TgSessionMode;
  offsetFile: string;
  timeoutSec: number;
};

async function readOffset(offsetFile: string): Promise<number> {
  try {
    const raw = await fs.readFile(offsetFile, 'utf8');
    const n = Number(JSON.parse(raw).offset);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function writeOffset(offsetFile: string, offset: number): Promise<void> {
  await fs.writeFile(offsetFile, JSON.stringify({ offset }, null, 2), 'utf8');
}

async function apiGetUpdates(token: string, offset: number, timeoutSec: number): Promise<TgUpdate[]> {
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set('timeout', String(timeoutSec));
  url.searchParams.set('offset', String(offset));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`telegram getUpdates failed: ${res.status}`);
  const data = (await res.json()) as any;
  if (!data.ok) throw new Error(`telegram getUpdates not ok: ${JSON.stringify(data)}`);
  return data.result as TgUpdate[];
}

function pickMessage(u: TgUpdate): { msg: TgMessageLike; edited: boolean; kind: string } | null {
  if (u.message) return { msg: u.message, edited: false, kind: 'message' };
  if (u.edited_message) return { msg: u.edited_message, edited: true, kind: 'edited_message' };
  if (u.channel_post) return { msg: u.channel_post, edited: false, kind: 'channel_post' };
  if (u.edited_channel_post) return { msg: u.edited_channel_post, edited: true, kind: 'edited_channel_post' };
  return null;
}

export async function runTelegramPoll(opts: TgPollOptions): Promise<void> {
  let offset = await readOffset(opts.offsetFile);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const updates = await apiGetUpdates(opts.token, offset, opts.timeoutSec);
      for (const u of updates) {
        offset = Math.max(offset, u.update_id + 1);
        const picked = pickMessage(u);
        if (!picked) continue;

        const chatId = picked.msg.chat.id;
        const chatIdStr = String(chatId);
        if (opts.allowlist?.length && !opts.allowlist.includes(chatIdStr)) continue;

        const session_id = tgSessionId(chatId, picked.msg.message_thread_id, opts.sessionMode);
        const detId = tgDeterministicId(chatId, picked.msg.message_id, picked.edited, picked.msg.edit_date);
        const { role, content } = tgContentFromMessage(picked.msg);

        insertMemoryWithId(opts.db, {
          id: detId,
          session_id,
          role,
          content,
          created_at: new Date(((picked.msg.edit_date ?? picked.msg.date) ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
          metadata: {
            source: 'telegram',
            kind: picked.kind,
            update_id: u.update_id,
            chatId,
            message_id: picked.msg.message_id,
            thread_id: picked.msg.message_thread_id,
            raw: u,
          },
        });
      }

      await writeOffset(opts.offsetFile, offset);
    } catch (e) {
      // Backoff a bit on errors.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
