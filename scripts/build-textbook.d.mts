import type { Textbook } from '../src/shared/textbook';
export function compileTextbook(directory: string): { book: Textbook; assets: { name: string; bytes: Buffer }[] };
