import type { Role } from '../memory/types';

export type TgSessionMode = 'chat' | 'chat_topic';

export type TgMessageLike = {
  message_id: number;
  date?: number;
  edit_date?: number;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  from?: { is_bot?: boolean; username?: string; id?: number; first_name?: string; last_name?: string };
  chat: { id: number; type: string; title?: string; username?: string };
  new_chat_members?: unknown;
  left_chat_member?: unknown;
  pinned_message?: unknown;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessageLike;
  edited_message?: TgMessageLike;
  channel_post?: TgMessageLike;
  edited_channel_post?: TgMessageLike;
};

export function tgSessionId(chatId: number, threadId: number | undefined, mode: TgSessionMode): string {
  if (mode === 'chat_topic' && threadId) return `tg:${chatId}:${threadId}`;
  return `tg:${chatId}`;
}

export function tgDeterministicId(chatId: number, messageId: number, edited?: boolean, editDate?: number): string {
  if (edited && editDate) return `tg:${chatId}:${messageId}:edit:${editDate}`;
  if (edited) return `tg:${chatId}:${messageId}:edit`;
  return `tg:${chatId}:${messageId}`;
}

export function tgRoleFromMessage(msg: TgMessageLike): Role {
  // Most incoming updates are users. Keep it simple.
  if (msg.from?.is_bot) return 'assistant';
  return 'user';
}

export function tgContentFromMessage(msg: TgMessageLike): { role: Role; content: string } {
  // service-ish
  if (msg.new_chat_members || msg.left_chat_member) {
    return { role: 'system', content: '[service] member change' };
  }
  if (msg.pinned_message) {
    return { role: 'system', content: '[service] pinned a message' };
  }

  const text = msg.text ?? msg.caption;
  if (text && text.trim()) return { role: tgRoleFromMessage(msg), content: text };
  return { role: tgRoleFromMessage(msg), content: '[non-text message]' };
}
