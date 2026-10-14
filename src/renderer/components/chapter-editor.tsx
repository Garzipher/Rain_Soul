import { SelectField } from './select-field';
import { useEffect, useRef, useState } from 'react';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { BookmarkNode, WritingDocument } from '../../shared/contracts';
import type { AssetState } from '../../shared/assets';
import { validateDocument } from '../../shared/document';
import { stableParagraphIds } from '../lib/paragraph-ids';
import { BookmarkDetails, bookmarkInfo, inlineBookmark, insertBookmarkAtSelection } from './inline-bookmark';
import { ContextMenu, type MenuState } from './context-menu';
import { captureWritingSelection, type WritingAiRequest } from '../lib/writing-ai-selection';
import { createKnowledgeGhost, refreshKnowledgeGhost } from '../lib/knowledge-ghost-extension';

export interface ChapterEditorProps { document: WritingDocument; assets?: AssetState; locked: boolean; ghostPaused?: boolean; onChange: (document: WritingDocument) => void; onError: (error: string) => void; onCompositionChange: (value: boolean) => void; location?: { paragraphId: string; token: number } | null; onLocateAsset?: (kind: BookmarkNode['attrs']['kind'], id: string) => void; onAiRequest?: (request: WritingAiRequest) => void }

/** 固定样式正文保存段落、文本、换行与书签关联；不导入外部 HTML 样式。 */
export function ChapterEditor({ document, assets, locked, ghostPaused = false, onChange, onError, onCompositionChange, location, onLocateAsset, onAiRequest }: ChapterEditorProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const aiEntry = useRef({ locked, onAiRequest });
  useEffect(() => { aiEntry.current = { locked, onAiRequest }; }, [locked, onAiRequest]);
  const knowledgeEntries = useRef(assets?.knowledge ?? []);
  const ghostState = useRef({ locked, paused: ghostPaused });
  useEffect(() => { knowledgeEntries.current = assets?.knowledge ?? []; ghostState.current = { locked, paused: ghostPaused }; if (editorRef.current) refreshKnowledgeGhost(editorRef.current); }, [assets, locked, ghostPaused]);
  const editorRef = useRef<Editor | null>(null);
  const [kind, setKind] = useState<BookmarkNode['attrs']['kind']>('knowledge');
  const [target, setTarget] = useState('');
  const [detail, setDetail] = useState<BookmarkNode['attrs'] | null>(null);
  const options = kind === 'knowledge' ? assets?.knowledge.filter(item => !item.deletedAt).map(item => ({ id: item.id, label: item.body.slice(0, 30) })) : assets?.foreshadows.filter(item => !item.deletedAt).map(item => ({ id: item.id, label: item.name }));
  const targetId = options?.some(item => item.id === target) ? target : options?.[0]?.id ?? '';
  const editor = useEditor({
    extensions: [Document, Paragraph, Text, HardBreak, inlineBookmark, stableParagraphIds, UndoRedo, createKnowledgeGhost(() => ({ entries: knowledgeEntries.current, paused: ghostState.current.locked || ghostState.current.paused }))],
    content: document,
    editable: !locked,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': '章节正文', 'aria-multiline': 'true', class: 'writing-body', spellcheck: 'false' },
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const current = aiEntry.current;
          if (current.locked || !current.onAiRequest) return false;
          // 自定义右键先于文档观察器，读取当前DOM选区以免冻结上一次光标位置。
          const domSelection = view.dom.ownerDocument.getSelection();
          if (!domSelection?.anchorNode || !domSelection.focusNode || !view.dom.contains(domSelection.anchorNode) || !view.dom.contains(domSelection.focusNode)) return false;
          let anchor: number, head: number;
          try {
            anchor = view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset);
            head = view.posAtDOM(domSelection.focusNode, domSelection.focusOffset);
          } catch { return false; }
          const selected = captureWritingSelection(view.state.doc, Math.min(anchor, head), Math.max(anchor, head));
          if (!selected) return false;
          event.preventDefault();
          const choices = [['sentencePolish', 'AI 单句润色'], ['paragraphPolish', 'AI 段落润色'], ['continue', 'AI 续写'], ['correct', 'AI 纠错']] as const;
          setMenu({ x: event.clientX, y: event.clientY, trigger: view.dom, items: choices.map(([operation, label]) => ({ label,
            disabled: operation === 'sentencePolish' && selected.sentenceFrom === undefined,
            action: () => { if (!aiEntry.current.locked) aiEntry.current.onAiRequest?.({ ...selected, operation, token: Date.now() }); } })) });
          return true;
        },
        keydown: (_view, event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return false;
          const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-bookmark-id]') : null;
          if (!element) return false;
          event.preventDefault();
          setDetail({ id: element.dataset.bookmarkId!, kind: element.dataset.bookmarkKind as BookmarkNode['attrs']['kind'], targetId: element.dataset.bookmarkTarget! });
          return true;
        },
        click: (_view, event) => {
          const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-bookmark-id]') : null;
          if (!element) return false;
          event.preventDefault();
          setDetail({ id: element.dataset.bookmarkId!, kind: element.dataset.bookmarkKind as BookmarkNode['attrs']['kind'], targetId: element.dataset.bookmarkTarget! });
          return true;
        },
        compositionstart: () => { onCompositionChange(true); return false; },
        compositionend: () => { onCompositionChange(false); return false; },
      },
      handlePaste: (view, event) => {
        const plain = event.clipboardData?.getData('text/plain');
        if (plain === undefined) return false;
        event.preventDefault();
        const text = plain.replace(/\r\n?/g, '\n');
        const parsed = text.split('\n').map((line) => view.state.schema.nodes.paragraph.create(null, line ? view.state.schema.text(line) : undefined));
        const slice = view.state.schema.nodes.doc.create(null, parsed).slice(0);
        view.dispatch(view.state.tr.replaceSelection(slice));
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      try { onChange(validateDocument(current.getJSON())); }
      catch (error) { onError(error instanceof Error ? error.message : '正文结构无法保存，请保留内容并联系开发者'); }
    },
  });
  useEffect(() => { editorRef.current = editor; return () => { if (editorRef.current === editor) editorRef.current = null; }; }, [editor]);
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      editor.view.dom.querySelectorAll<HTMLElement>('[data-bookmark-id]').forEach(element => {
        const bookmark = { id: element.dataset.bookmarkId!, kind: element.dataset.bookmarkKind as BookmarkNode['attrs']['kind'], targetId: element.dataset.bookmarkTarget! };
        const info = bookmarkInfo(bookmark, assets);
        element.setAttribute('aria-label', info.label); element.textContent = bookmark.kind === 'knowledge' ? '〔知识〕' : `〔伏笔：${info.title}〕`;
      });
    };
    refresh(); editor.on('update', refresh);
    return () => { editor.off('update', refresh); };
  }, [editor, assets]);
  useEffect(() => { editor?.setEditable(!locked, false); }, [editor, locked]);
  useEffect(() => {
    if (!editor || !location || locked) return;
    let found = false;
    editor.state.doc.descendants((node, position) => {
      if (found || node.type.name !== 'paragraph' || node.attrs.id !== location.paragraphId) return;
      found = true;
      editor.commands.setTextSelection(position + 1);
      const target = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('[data-paragraph-id]')).find(element => element.dataset.paragraphId === location.paragraphId);
      target?.scrollIntoView?.({ block: 'center' });
      editor.commands.focus();
    });
    if (!found) onError('该段落已变更或删除，请重新搜索正文。');
  }, [editor, location, locked, onError]);
  function insertBookmark() {
    if (!editor || locked || !targetId) return;
    insertBookmarkAtSelection(editor, kind, targetId);
  }
  return <>
    {assets && <div className="bookmark-toolbar"><SelectField aria-label="书签类型" value={kind} disabled={locked} onChange={event => { setKind(event.target.value as BookmarkNode['attrs']['kind']); setTarget(''); }}><option value="knowledge">知识引用</option><option value="foreshadow">伏笔标记</option></SelectField>
      <SelectField aria-label="书签目标" value={targetId} disabled={locked || !options?.length} onChange={event => setTarget(event.target.value)}>{!options?.length && <option value="">暂无可关联条目</option>}{options?.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</SelectField>
      <button className="secondary" disabled={locked || !targetId} onMouseDown={event => event.preventDefault()} onClick={insertBookmark}>插入书签</button></div>}
    <EditorContent editor={editor} />
    {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    {detail && <BookmarkDetails bookmark={detail} assets={assets} onClose={() => setDetail(null)} onLocateAsset={onLocateAsset} locked={locked} />}
  </>;
}
