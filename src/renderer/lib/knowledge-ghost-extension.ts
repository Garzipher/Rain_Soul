import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { KnowledgeEntry } from '../../shared/assets';
import { readableKnowledgeSource } from '../../shared/knowledge-source';
import { findKnowledgeCompletion, findScopedKnowledgeCompletion, type KnowledgeCompletion } from './knowledge-completion';
export interface KnowledgeGhostContext { entries: KnowledgeEntry[]; globalEntries?: KnowledgeEntry[]; paused: boolean; onAcceptGlobal?: (candidate: KnowledgeCompletion) => Promise<boolean>; onError?: (message: string) => void }
interface Ghost { position: number; paragraphStart: number; candidate: KnowledgeCompletion }
const ghostKey = new PluginKey<Ghost | null>('knowledgeGhost');
function baseline(state: EditorState) {
  const selection = state.selection, at = selection.$from;
  if (!selection.empty || at.parent.type.name !== 'paragraph' || at.parentOffset !== at.parent.content.size) return null;
  // 书签和换行不是待抄原句的一部分，只取其后当前连续文本。
  const prefix = at.parent.textBetween(0, at.parentOffset, '\n', '\n').split('\n').at(-1) ?? '';
  return { prefix, position: selection.from, paragraphStart: at.start() };
}
/** 灰字仅为DOM装饰；接受前不会进入JSON、字数、保存或撤销历史。 */
export function createKnowledgeGhost(context: () => KnowledgeGhostContext) {
  return Extension.create({ name: 'knowledgeGhost', addProseMirrorPlugins() {
    let timer: ReturnType<typeof setTimeout> | undefined, focused = false, composing = false, needsRefresh = false, accepting = false;
    let suppressed: { doc: EditorState['doc']; position: number } | null = null;
    function cancelTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
    function allowed(view: EditorView) { return focused && !composing && !view.composing && view.editable && !context().paused; }
    function match(prefix: string) {
      const scope = context();
      return scope.globalEntries ? findScopedKnowledgeCompletion(prefix, { workEntries: scope.entries, globalEntries: scope.globalEntries }) : findKnowledgeCompletion(prefix, scope.entries);
    }
    function clear(view: EditorView, suppress = false) {
      cancelTimer();
      if (suppress) suppressed = { doc: view.state.doc, position: view.state.selection.from };
      if (ghostKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(ghostKey, null).setMeta('addToHistory', false));
    }
    function schedule(view: EditorView) {
      cancelTimer();
      const current = baseline(view.state);
      if (accepting || !allowed(view) || !current || (suppressed?.doc === view.state.doc && suppressed.position === current.position)) { clear(view); return; }
      const doc = view.state.doc;
      timer = setTimeout(() => {
        timer = undefined;
        const live = baseline(view.state);
        if (view.isDestroyed || !allowed(view) || view.state.doc !== doc || !live || live.position !== current.position || live.prefix !== current.prefix) return;
        const candidate = match(live.prefix);
        view.dispatch(view.state.tr.setMeta(ghostKey, candidate ? { position: live.position, paragraphStart: live.paragraphStart, candidate } : null).setMeta('addToHistory', false));
      }, 400);
    }
    return [new Plugin<Ghost | null>({
      key: ghostKey,
      state: { init: () => null, apply(transaction, previous) {
        if (transaction.getMeta('knowledgeGhostRefresh')) needsRefresh = true;
        const meta = transaction.getMeta(ghostKey) as Ghost | null | undefined;
        if (meta !== undefined) return meta;
        return transaction.docChanged || transaction.selectionSet || transaction.getMeta('knowledgeGhostRefresh') ? null : previous;
      } },
      props: {
        decorations(state) {
          const ghost = ghostKey.getState(state); if (!ghost) return null;
          return DecorationSet.create(state.doc, [Decoration.widget(ghost.position, () => {
            const span = document.createElement('span'); span.className = 'knowledge-ghost'; span.dataset.knowledgeGhost = ghost.candidate.knowledgeId;
            const suffix = document.createElement('span'); suffix.textContent = ghost.candidate.suffix; span.append(suffix); span.contentEditable = 'false';
            const source = readableKnowledgeSource(ghost.candidate.source) || '未注明';
            const origin = document.createElement('small'); origin.className = 'knowledge-ghost-source'; origin.textContent = `〔${ghost.candidate.library === 'global' ? '全局 · ' : ''}${source.slice(0, 60)} · Tab接受〕`; origin.setAttribute('aria-hidden', 'true'); span.append(origin);
            span.setAttribute('role', 'note'); span.setAttribute('aria-label', `知识原句参考，出处：${source}；Tab接受，Esc取消`);
            span.title = `出处：${source} · Tab 接受 / Esc 取消`;
            // 装饰不可选中，不提供可聚焦控件，不移动作者光标。
            span.style.color = '#667085'; span.style.pointerEvents = 'none'; span.style.userSelect = 'none';
            return span;
          }, { side: 1, key: `${ghost.candidate.knowledgeId}:${ghost.candidate.revision}:${ghost.position}`, ignoreSelection: true })]);
        },
        handleKeyDown(view, event) {
          if (event.isComposing || composing || view.composing) return false;
          const ghost = ghostKey.getState(view.state); if (!ghost) return false;
          if (event.key === 'Escape') { clear(view, true); return true; }
          if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
          const current = baseline(view.state), live = current && match(current.prefix);
          if (!allowed(view) || !current || current.position !== ghost.position || current.paragraphStart !== ghost.paragraphStart || JSON.stringify(live) !== JSON.stringify(ghost.candidate)) { clear(view); return false; }
          cancelTimer();
          if (ghost.candidate.library === 'global') {
            const accept = context().onAcceptGlobal;
            clear(view, true);
            if (!accept || accepting) return true;
            const doc = view.state.doc, selection = view.state.selection;
            accepting = true;
            // 先冻结出处，等待期间作者仍可输入；正文或光标已变化就放弃过时候选。
            void accept(ghost.candidate).then(saved => {
              if (!saved || view.isDestroyed || !allowed(view) || view.state.doc !== doc || !view.state.selection.eq(selection)) return;
              view.dispatch(closeHistory(view.state.tr).insertText(ghost.candidate.suffix, ghost.position).setMeta(ghostKey, null));
              view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
            }).catch(() => context().onError?.('全局参考未保存，未插入原句，请重试。')).finally(() => { accepting = false; });
            return true;
          }
          view.dispatch(closeHistory(view.state.tr).insertText(ghost.candidate.suffix, ghost.position).setMeta(ghostKey, null));
          view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
          return true;
        },
        handleDOMEvents: {
          focus(view) { focused = true; schedule(view); return false; },
          blur(view) { focused = false; clear(view); return false; },
          contextmenu(view) { clear(view, true); return false; },
          compositionstart(view) { composing = true; clear(view); return false; },
          compositionend(view) { composing = false; setTimeout(() => { if (!view.isDestroyed) schedule(view); }, 0); return false; },
        },
      },
      view() {
        return { update(current, previous) {
          const changed = current.state.doc !== previous.doc || !current.state.selection.eq(previous.selection);
          if (changed) { suppressed = null; schedule(current); }
          else if (!allowed(current)) clear(current);
          else if (needsRefresh) { needsRefresh = false; schedule(current); }
        }, destroy() { cancelTimer(); } };
      },
    })];
  } });
}
/** 知识版本、AI工具、锁定等外部状态变化使候选立即失效。 */
export function refreshKnowledgeGhost(editor: Editor): void {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('knowledgeGhostRefresh', true).setMeta('addToHistory', false));
}
