import { parseAlmaLogLine, deriveChatIdDate, makeAlmaDeterministicId, mapAlmaSessionId } from '../src/integrations/alma-log';
import { tgDeterministicId, tgSessionId } from '../src/integrations/telegram-utils';

describe('alma log parsing', () => {
  it('derives chatId and date from filename', () => {
    expect(deriveChatIdDate('/x/123456789_2026-03-17.log')).toEqual({ chatId: '123456789', date: '2026-03-17' });
    expect(deriveChatIdDate('/x/-1003721267266_2026-03-15.log')!.chatId).toBe('-1003721267266');
  });

  it('parses a normal line and generates deterministic id', () => {
    const fp = '/tmp/123456789_2026-03-17.log';
    const line = '[00:32:36] [msg:68] [Someone (@user) [id:123456789]]: 持续优化';
    const parsed = parseAlmaLogLine(line, fp, 'chat_date');
    expect(parsed).not.toBeNull();
    expect(parsed!.chatId).toBe('123456789');
    expect(parsed!.msgId).toBe('68');
    expect(parsed!.role).toBe('user');
    expect(parsed!.session_id).toBe('alma:123456789:2026-03-17');
    expect(parsed!.id).toBe(makeAlmaDeterministicId({ chatId: '123456789', date: '2026-03-17', msgId: '68', sender: 'Someone (@user)' }));
  });

  it('maps session ids by mode', () => {
    expect(mapAlmaSessionId('1', '2026-03-17', '2', 'chat')).toBe('alma:1');
    expect(mapAlmaSessionId('1', '2026-03-17', '2', 'chat_date')).toBe('alma:1:2026-03-17');
    expect(mapAlmaSessionId('1', '2026-03-17', '2', 'chat_msg')).toBe('alma:1:2026-03-17:2');
  });
});

describe('telegram helpers', () => {
  it('builds deterministic ids and session ids', () => {
    expect(tgSessionId(123, undefined, 'chat')).toBe('tg:123');
    expect(tgSessionId(123, 99, 'chat_topic')).toBe('tg:123:99');
    expect(tgDeterministicId(123, 5)).toBe('tg:123:5');
    expect(tgDeterministicId(123, 5, true, 111)).toBe('tg:123:5:edit:111');
  });
});
