import { describe, expect, it } from 'vitest';
import { assertPublicP1Command } from '../../src/main/p1-command-policy';

describe('P1 渲染层命令边界', () => {
  it('不能绕过授权伪造AI回答或文件出处', () => {
    expect(() => assertPublicP1Command('appendConversationTurn', {})).toThrow();
    expect(() => assertPublicP1Command('importBookExtraction', {})).toThrow();
    expect(() => assertPublicP1Command('manageConversation', { action: { type: 'appendMessage', message: { role: 'assistant' } } })).toThrow();
    expect(() => assertPublicP1Command('manageConversation', { action: { type: 'appendMessage', message: { role: 'user', requestHash: '伪造授权回执' } } })).toThrow();
  });
  it('本地用户消息和受控云/文件确认保持可用', () => {
    for (const command of ['prepareConversationAi', 'executeConversationAi', 'confirmBookExtraction', 'listConversations']) expect(() => assertPublicP1Command(command, {})).not.toThrow();
    expect(() => assertPublicP1Command('manageConversation', { action: { type: 'appendMessage', message: { role: 'user' } } })).not.toThrow();
  });
});
