import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const stableParagraphIds = Extension.create({
  name: 'stableParagraphIds',
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: { id: {
      default: null, parseHTML: () => null, renderHTML: attributes => typeof attributes.id === 'string' ? { 'data-paragraph-id': attributes.id } : {},
    } } }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('stableParagraphIds'),
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(transaction => transaction.docChanged)) return null;
        const seen = new Set<string>();
        const bookmarks = new Set<string>();
        const transaction = state.tr;
        state.doc.descendants((node, position) => {
          if (node.type.name !== 'paragraph' && node.type.name !== 'bookmark') return;
          const nodeIds = node.type.name === 'bookmark' ? bookmarks : seen;
          const id = typeof node.attrs.id === 'string' ? node.attrs.id : null;
          if (!id || nodeIds.has(id)) {
            const nextId = globalThis.crypto.randomUUID();
            transaction.setNodeMarkup(position, undefined, { ...node.attrs, id: nextId });
            nodeIds.add(nextId);
          } else nodeIds.add(id);
        });
        return transaction.docChanged ? transaction : null;
      },
    })];
  },
});
