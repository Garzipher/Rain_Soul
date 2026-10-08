export interface TextbookChapter {
  id: string;
  key: string;
  title: string;
  markdown: string;
  images: Record<string, string>;
}
export interface Textbook { workId: string; chapters: TextbookChapter[] }
