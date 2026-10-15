export type IconName = 'books' | 'knowledge' | 'chat' | 'settings' | 'plus' | 'back' | 'chapter' | 'panel' | 'chevron' | 'folder';

const paths: Record<IconName, string> = {
  books: 'M4 3h5v18H4z M9 3h5v18H9z M16 3l4 1-3 17-4-1z',
  knowledge: 'M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 7v15',
  chat: 'M4 4h16v12H9l-5 4z M8 8h8 M8 12h5',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6 7 7 M17 17l1.4 1.4 M5.6 18.4 7 17 M17 7l1.4-1.4',
  plus: 'M12 5v14 M5 12h14',
  back: 'M14 5l-7 7 7 7 M7 12h13',
  chapter: 'M5 3h10l4 4v14H5z M15 3v5h4 M8 12h8 M8 16h6',
  panel: 'M4 4h16v16H4z M10 4v16 M6.5 8h1 M6.5 12h1 M6.5 16h1',
  chevron: 'm9 5 7 7-7 7',
  folder: 'M3 6h7l2 3h9v11H3z M3 6V4h7l2 2',
};

export function Icon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
