import path from 'path';
import fs from 'fs/promises';
import type { Role } from '../memory/types';

export type AlmaSessionMode = 'chat' | 'chat_date' | 'chat_msg';

export type ParsedAlmaLog = {
  chatId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  msgId: string;
  sender: string;
  senderId?: string;
  content: string;
  role: Role;
  session_id: string;
  id: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

export function deriveChatIdDate(filePath: string): { chatId: string; date: string } | null {
  const base = path.basename(filePath);
  const m = base.match(/^(-?\d+)_([0-9]{4}-[0-9]{2}-[0-9]{2})\.log$/);
  if (!m) return null;
  return { chatId: m[1]!, date: m[2]! };
}

export function mapAlmaSessionId(
  chatId: string,
  date: string,
  msgId: string,
  mode: AlmaSessionMode,
): string {
  if (mode === 'chat') return `alma:${chatId}`;
  if (mode === 'chat_date') return `alma:${chatId}:${date}`;
  return `alma:${chatId}:${date}:${msgId}`;
}

export function roleFromSender(sender: string): Role {
  return sender.trim() === 'Alma' ? 'assistant' : 'user';
}

export function makeAlmaDeterministicId(params: {
  chatId: string;
  date: string;
  msgId: string;
  sender: string;
}): string {
  const who = params.sender.trim() === 'Alma' ? 'alma' : 'user';
  return `alma:${params.chatId}:${params.date}:${params.msgId}:${who}`;
}

export function shouldIgnoreContent(content: string): boolean {
  const t = content.trim();
  return /^\[[^\]]+\]$/.test(t); // e.g. [sent text]
}

export function parseAlmaLogLine(line: string, filePath: string, mode: AlmaSessionMode): ParsedAlmaLog | null {
  // Example:
  // [00:32:36] [msg:68] [Someone (@user) [id:123456789]]: 持续优化
  const header = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+\[msg:(\d+)\]\s+\[(.+?)\]:\s*(.*)$/);
  if (!header) return null;

  const fileInfo = deriveChatIdDate(filePath);
  if (!fileInfo) return null;

  const time = header[1]!;
  const msgId = header[2]!;
  const senderRaw = header[3]!;
  const content = header[4] ?? '';
  if (shouldIgnoreContent(content)) return null;

  // try extract sender id
  const idMatch = senderRaw.match(/\[id:(-?\d+)\]/);
  const senderId = idMatch?.[1];

  // sender display: strip trailing " [id:...]"
  const sender = senderRaw.replace(/\s*\[id:[^\]]+\]\s*$/, '').trim();

  const role = roleFromSender(sender);
  const session_id = mapAlmaSessionId(fileInfo.chatId, fileInfo.date, msgId, mode);
  const id = makeAlmaDeterministicId({ chatId: fileInfo.chatId, date: fileInfo.date, msgId, sender });
  const created_at = new Date(`${fileInfo.date}T${time}+08:00`).toISOString();

  return {
    chatId: fileInfo.chatId,
    date: fileInfo.date,
    time,
    msgId,
    sender,
    senderId,
    content,
    role,
    session_id,
    id,
    created_at,
    metadata: {
      source: 'alma-log',
      filePath,
      time,
      msgId,
      sender,
      senderId,
      chatId: fileInfo.chatId,
      date: fileInfo.date,
      raw: line,
    },
  };
}

export type TailState = {
  files: Record<string, { pos: number; carry?: string }>;
};

export async function loadTailState(stateFile: string): Promise<TailState> {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.files) return parsed;
  } catch {
    // ignore
  }
  return { files: {} };
}

export async function saveTailState(stateFile: string, state: TailState): Promise<void> {
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
}
