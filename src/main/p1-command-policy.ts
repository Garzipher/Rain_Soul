/** 私有命令只由主进程审核后构造；受信窗口同样不能绕过授权。 */
export function assertPublicP1Command(command: string, payload: unknown): void {
  if (command === 'appendConversationTurn' || command === 'importBookExtraction') throw new Error('此命令仅允许主进程审核后执行。');
  if (command !== 'manageConversation' || !payload || typeof payload !== 'object' || !('action' in payload)) return;
  const action = payload.action;
  if (!action || typeof action !== 'object' || !('type' in action) || action.type !== 'appendMessage') return;
  if (!('message' in action) || !action.message || typeof action.message !== 'object' || !('role' in action.message) || action.message.role !== 'user') throw new Error('AI 回答只能通过已授权的模型请求保存。');
  if ('requestHash' in action.message) throw new Error('模型请求回执只能由主进程生成。');
}
