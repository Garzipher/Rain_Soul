// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { ConversationWorkspace, type ConversationApi } from '../../src/renderer/components/conversation-workspace';


export const work = { id: '作品甲', title: '雨城', revision: 1, chapters: [], volumes: [], deletedItems: [] };
export const stamp = '2026-10-09T00:00:00Z';

export function setup() {
  let conversation = { id: '会话甲', title: '开篇讨论', revision: 1, draft: '', createdAt: stamp, updatedAt: stamp, messageCount: 0, hasMore: false, messages: [] as { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }[] };
  const api: ConversationApi = {
    listConversations: vi.fn(async () => [conversation]),
    readConversation: vi.fn(async () => structuredClone(conversation)),
    manageConversation: vi.fn(async request => {
      if (request.action.type === 'delete') return null;
      if (request.action.type === 'saveDraft') conversation = { ...conversation, draft: request.action.draft, revision: conversation.revision + 1 };
      if (request.action.type === 'rename') conversation = { ...conversation, title: request.action.title, revision: conversation.revision + 1 };
      if (request.action.type === 'appendMessage') conversation = { ...conversation, draft: '', revision: conversation.revision + 1, messageCount: conversation.messageCount + 1, messages: [...conversation.messages, { ...request.action.message, createdAt: stamp }] };
      return structuredClone(conversation);
    }),
    prepareConversationAi: vi.fn(async () => ({ confirmationToken: 'token', requestHash: 'hash', expiresAt: Date.now() + 60000,
      service: '免费测试服务', model: '模型', scopeLabel: '仅当前会话', previewText: '合成授权材料', paragraphIds: [], billingHint: '额度以服务为准', estimatedInputTokens: 10, maxOutputTokens: 512 })),
    executeConversationAi: vi.fn(async () => ({ ...conversation, draft: '', revision: 3, messages: [{ id: '回复', role: 'assistant' as const, content: '建议调整节奏', createdAt: stamp }], messageCount: 1 })),
    cancelConversationAi: vi.fn(async () => {}),
    retryConversationReply: vi.fn(async () => ({ ...conversation, draft: '', revision: 4, messages: [{ id: '回复', role: 'assistant' as const, content: '完整待保存回答', createdAt: stamp }], messageCount: 1 })),
    readPendingConversationReply: vi.fn(async () => ({ workId: work.id, conversationId: conversation.id, requestHash: 'hash', userContent: '不要丢失', assistantContent: '<script>完整待保存回答</script>', currentDraft: '不要丢失', currentRevision: 3, expectedRevision: 2 })),
    discardConversationReply: vi.fn(async () => {}),
  };
  const dirty = vi.fn();
  const view = render(<ConversationWorkspace work={work} works={[]} api={api} onSelectWork={vi.fn()} onDirtyChange={dirty} />);
  return { api, dirty, unmount: view.unmount };
}
