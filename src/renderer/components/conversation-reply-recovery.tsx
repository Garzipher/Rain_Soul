import { useEffect, useRef, useState } from 'react';
import type { DesktopApi } from '../../shared/contracts';
import type { ConversationDetail } from '../../shared/conversations';
import type { PendingConversationReply } from '../../shared/conversation-ai';
import { ConversationDialog } from './conversation-dialog';
import { errorCode } from '../../shared/operation-errors';

type RecoveryApi = Pick<DesktopApi, 'retryConversationReply' | 'readPendingConversationReply' | 'discardConversationReply' | 'readConversation'>;
/** 保存恢复始终使用原请求回执；此组件没有重新请求模型的权限。 */
export function ConversationReplyRecovery({ requestHash, workId, conversationId, api, onResolved, onProtectionChange }: {
  requestHash: string; workId: string; conversationId: string; api: RecoveryApi; onResolved: (detail: ConversationDetail) => void; onProtectionChange?: (dirty: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<PendingConversationReply | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [checking, setChecking] = useState(true);
  const [available, setAvailable] = useState(false);
  const [durable, setDurable] = useState(false);
  const resolved = useRef(onResolved); resolved.current = onResolved;
  const protection = useRef(onProtectionChange); protection.current = onProtectionChange;
  useEffect(() => {
    let active = true;
    // 只读取本机记录，不发送云请求；没有待存回答时自动解除未知状态。
    void (async () => {
      try {
        let pending: PendingConversationReply | null = null;
        for (let attempt = 0; active; attempt += 1) {
          try { pending = await api.readPendingConversationReply(requestHash); break; }
          catch (reason) {
            if (errorCode(reason) !== 'CONVERSATION_IN_PROGRESS' || attempt >= 14) throw reason;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        if (!pending) return;
        if (active) { setAvailable(true); setDurable(pending.durable === true); protection.current?.(pending.durable !== true); }
      }
      catch (reason) {
        if (errorCode(reason) !== 'NOT_FOUND') throw reason;
        const detail = await api.readConversation(workId, conversationId);
        if (active) resolved.current(detail);
      }
    })().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '本机核对未完成，请重试。'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; protection.current?.(false); };
  }, [requestHash, workId, conversationId, api]);
  async function run(action: () => Promise<void>) {
    if (busy || checking) return;
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : '回答恢复失败，请保留并重试。'); }
    finally { setBusy(false); }
  }
  async function check() {
    try {
      const pending = await api.readPendingConversationReply(requestHash);
      setAvailable(true); setDurable(pending.durable === true); protection.current?.(pending.durable !== true);
    } catch (reason) {
      if (errorCode(reason) !== 'NOT_FOUND') throw reason;
      onResolved(await api.readConversation(workId, conversationId));
    }
  }
  return <div className="conversation-recovery" role="region" aria-label="待保存回答恢复">
    <strong>{checking ? '正在读取本机发送记录' : available ? '回答已收到' : '发送已结束，正在保留草稿'}</strong>
    <p>{durable ? '回答已保存在本机恢复文件中，可随时切换页面，稍后继续保存到会话。' : available ? '回答尚未保存到磁盘，请先保存或复制后放弃。' : '原始草稿仍在本机。仅核对本机记录，不会重新发送。'}</p>
    {error && <p role="alert">{error}</p>}
    <div className="conversation-recovery-actions"><button className="primary" disabled={busy || checking || !available} onClick={() => void run(async () => onResolved(await api.retryConversationReply(requestHash)))}>保存回答</button>
    <button className="secondary" disabled={busy || checking || !available} onClick={() => void run(async () => setReply(await api.readPendingConversationReply(requestHash)))}>查看回答</button>
    <button className="secondary" disabled={busy || checking} onClick={() => void run(check)}>重新核对</button>
    <button className="secondary" disabled={busy || checking} onClick={() => {
      if (available) setDiscarding(true);
      else void run(check);
    }}>{available ? '放弃回答' : '保留草稿并返回'}</button></div>
    {reply && <ConversationDialog title="待保存回答对照" onCancel={() => setReply(null)}>
      <h3>待保存回答对照</h3><p>生成时版本 {reply.expectedRevision}；当前版本 {reply.currentRevision}。可选择文本复制保留。</p>
      <h4>发送时输入</h4><pre>{reply.userContent}</pre><h4>当前草稿</h4><pre>{reply.currentDraft}</pre><h4>完整回答</h4><pre>{reply.assistantContent}</pre>
      <button className="secondary" onClick={() => setReply(null)}>关闭回答对照</button>
    </ConversationDialog>}
    {discarding && <ConversationDialog title="放弃待保存回答" onCancel={() => { if (!busy) setDiscarding(false); }}>
      <h3>放弃待保存回答</h3><p>未保存的回答将被移除。已保存的消息不会删除；如需保留回答，请先查看并复制。</p>
      <button className="secondary" disabled={busy} onClick={() => setDiscarding(false)}>继续保留回答</button>
      <button className="danger" disabled={busy} onClick={() => void run(async () => {
        const detail = await api.readConversation(workId, conversationId);
        try { await api.discardConversationReply(requestHash); }
        catch (reason) { if (errorCode(reason) !== 'NOT_FOUND') throw reason; }
        onResolved(detail);
      })}>确认放弃回答</button>
    </ConversationDialog>}
  </div>;
}
