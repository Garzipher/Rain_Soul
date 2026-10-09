import { useState } from 'react';
import type { DesktopApi } from '../../shared/contracts';
import type { ConversationDetail } from '../../shared/conversations';
import type { PendingConversationReply } from '../../shared/conversation-ai';
import { ConversationDialog } from './conversation-dialog';
import { errorCode } from '../../shared/operation-errors';

type RecoveryApi = Pick<DesktopApi, 'retryConversationReply' | 'readPendingConversationReply' | 'discardConversationReply' | 'readConversation'>;
/** 保存恢复始终使用原请求回执；此组件没有重新请求模型的权限。 */
export function ConversationReplyRecovery({ requestHash, workId, conversationId, api, onResolved }: {
  requestHash: string; workId: string; conversationId: string; api: RecoveryApi; onResolved: (detail: ConversationDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<PendingConversationReply | null>(null);
  const [discarding, setDiscarding] = useState(false);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : '回答恢复失败，请保留并重试。'); }
    finally { setBusy(false); }
  }
  return <div className="conversation-recovery" role="region" aria-label="待保存回答恢复">
    <p>此次发送结果尚未确认。请先在本机核对、保存或明确放弃，再离开。待保存回答暂存在本次运行中。</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => void run(async () => onResolved(await api.retryConversationReply(requestHash)))}>重试保存回答</button>
    <button disabled={busy} onClick={() => void run(async () => setReply(await api.readPendingConversationReply(requestHash)))}>查看待保存回答</button>
    <button disabled={busy} onClick={() => void run(async () => {
      try { setReply(await api.readPendingConversationReply(requestHash)); }
      catch (reason) {
        if (errorCode(reason) !== 'NOT_FOUND') throw reason;
        onResolved(await api.readConversation(workId, conversationId));
      }
    })}>核对此次发送结果</button>
    <button disabled={busy} onClick={() => setDiscarding(true)}>放弃待保存回答</button>
    {reply && <ConversationDialog title="待保存回答对照" onCancel={() => setReply(null)}>
      <h3>待保存回答对照</h3><p>生成时版本 {reply.expectedRevision}；当前版本 {reply.currentRevision}。可选择文本复制保留。</p>
      <h4>发送时输入</h4><pre>{reply.userContent}</pre><h4>当前草稿</h4><pre>{reply.currentDraft}</pre><h4>完整回答</h4><pre>{reply.assistantContent}</pre>
      <button onClick={() => setReply(null)}>关闭回答对照</button>
    </ConversationDialog>}
    {discarding && <ConversationDialog title="放弃待保存回答" onCancel={() => { if (!busy) setDiscarding(false); }}>
      <h3>放弃待保存回答</h3><p>未保存的回答将被移除。已保存的消息不会删除；如需保留回答，请先查看并复制。</p>
      <button disabled={busy} onClick={() => setDiscarding(false)}>继续保留回答</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const detail = await api.readConversation(workId, conversationId);
        await api.discardConversationReply(requestHash);
        onResolved(detail);
      })}>确认放弃回答</button>
    </ConversationDialog>}
  </div>;
}
