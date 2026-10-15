import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { GlobalExtractionCommit } from '../../shared/global-knowledge';
import { readCategories, readTags, verifySource, fail, digest, putEntry } from './records';

/** 原文只接受主进程可信预览的精确段落；正式库仅保留本次审核通过的部分。 */
export function ingestGlobalExtraction(db: Database.Database, request: GlobalExtractionCommit): void {
  const document = verifySource(request.sourceDocument), categories = readCategories(db), tags = readTags(db);
  if (request.items.some(item => !categories.some(category => category.id === item.categoryId && !category.deletedAt)
    || item.tagIds.some(id => !tags.some(tag => tag.id === id && !tag.deletedAt)))) fail('审核分类或标签不存在。');
  const selected = request.items.map(item => {
    const segment = document.segments.find(segment => segment.id === item.segmentId);
    if (!segment || segment.text !== item.body) return fail('摘录与可信来源段落不一致。');
    return segment;
  });
  if (request.metadata.rightsBasis === 'public-excerpt') {
    if (document.kind !== 'web') fail('公开短摘录必须携带已核实的网页出处。');
    const previous = db.prepare('SELECT payload,metadata FROM global_source_document').all() as { payload: string; metadata: string }[];
    const earlier = previous.filter(row => { const metadata = JSON.parse(row.metadata) as GlobalExtractionCommit['metadata']; return metadata.rightsBasis === 'public-excerpt' && metadata.author === request.metadata.author && metadata.workTitle === request.metadata.workTitle; })
      .flatMap(row => verifySource(JSON.parse(row.payload)).segments);
    if (earlier.length + selected.length > 3 || [...earlier, ...selected].reduce((sum, segment) => sum + [...segment.text].length, 0) > 300) fail('本批公开作品只保存最多三条、累计三百字的审核短摘录。');
  }
  const sourceId = randomUUID(), segments = selected.map((segment, index) => ({ ...segment, id: randomUUID(), ordinal: index + 1 }));
  const source = verifySource({ ...document, id: sourceId, segments, bodyHash: digest(JSON.stringify(segments.map(segment => segment.text))),
    ...(document.capture ? { capture: { ...document.capture, sourceId } } : {}),
  });
  db.prepare('INSERT INTO global_source_document VALUES(?,?,?)').run(sourceId, JSON.stringify(source), JSON.stringify(request.metadata));
  const insertSegment = db.prepare('INSERT INTO global_source_segment VALUES(?,?,?)');
  for (const segment of segments) insertSegment.run(segment.id, sourceId, JSON.stringify(segment));
  request.items.forEach((item, index) => {
    const id = randomUUID();
    putEntry(db, { id, body: item.body, source: item.source, categoryId: item.categoryId, tagIds: item.tagIds, origin: null, revision: 1, reviewed: true, deletedAt: null, sourceDocumentId: sourceId, segmentId: segments[index].id });
    if (item.annotation) { const annotation = { ...item.annotation, id: randomUUID(), entryId: id }; db.prepare('INSERT INTO global_learning_annotation VALUES(?,?,?)').run(annotation.id, id, JSON.stringify(annotation)); }
  });
}
