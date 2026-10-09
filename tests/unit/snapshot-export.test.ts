import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { assetFixture } from './assets-helper';
import { createSnapshot, initializeSnapshots, listSnapshots, freezeSnapshotExport } from '../../src/workers/database/snapshots';
import { exportDocxManuscript, exportTxtManuscript } from '../../src/main/manuscript-export';
import { readDocxPackage } from '../../src/main/manuscript-docx';
import { emptyDocument } from '../../src/shared/document';

let fixture: ReturnType<typeof assetFixture>;
beforeEach(() => { fixture = assetFixture(); initializeSnapshots(fixture.db); });
afterEach(() => fixture.db.close());

it('历史快照导出使用当时正文、知识和伏笔证据；不修改当前稿、版本或快照', async () => {
  const entry = fixture.change({ type: 'createKnowledge', body: '历史描写', source: '历史出处', categoryId: fixture.state().categories[0].id, tagIds: [] }).knowledge[0];
  const hint = fixture.change({ type: 'createForeshadow', name: '旧信' }).foreshadows[0];
  fixture.change({ type: 'addEvidence', foreshadowId: hint.id, kind: '埋设', chapterId: fixture.chapterId, paragraphId: fixture.paragraphId, excerpt: '灯塔旁' });
  const oldDocument = structuredClone(fixture.document);
  oldDocument.content[0].content!.push({ type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'knowledge', targetId: entry.id } }, { type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'foreshadow', targetId: hint.id } });
  fixture.db.prepare('UPDATE chapter SET document_json=?').run(JSON.stringify(oldDocument));
  const snapshot = createSnapshot(fixture.db, '旧稿');
  fixture.change({ type: 'updateKnowledge', id: entry.id, body: '当前描写', source: '当前出处', categoryId: entry.categoryId, tagIds: [] });
  fixture.db.prepare('UPDATE chapter SET title=?,document_json=?').run('当前章节', JSON.stringify(fixture.document));
  const before = fixture.db.serialize(), histories = listSnapshots(fixture.db);
  const frozen = freezeSnapshotExport(fixture.db, snapshot.id), txt = exportTxtManuscript(frozen).toString('utf8');
  expect(frozen.revision).toBe(snapshot.sourceRevision);
  expect(txt).toContain('历史描写'); expect(txt).toContain('历史出处'); expect(txt).not.toContain('当前描写'); expect(txt).not.toContain('当前章节');
  expect(txt).toContain('[伏笔：旧信]'); expect(txt).toContain('埋设'); expect(frozen.evidence[0].valid).toBe(true);
  const docx = await readDocxPackage(await exportDocxManuscript(frozen), { title: '历史稿' });
  expect(docx.get('word/document.xml')!.toString()).toContain('历史描写');
  expect(docx.get('word/document.xml')!.toString()).not.toContain('当前描写');
  expect(fixture.db.serialize()).toEqual(before); expect(listSnapshots(fixture.db)).toEqual(histories);
  frozen.knowledge[0].body = '调用方修改不能回写快照';
  expect(freezeSnapshotExport(fixture.db, snapshot.id).knowledge[0].body).toBe('历史描写');
});

it('历史卷章按当时顺序输出，删除对象不混入正文，无卷章独立导出', () => {
  const volumeA = crypto.randomUUID(), volumeB = crypto.randomUUID(), chapter = crypto.randomUUID(), deleted = crypto.randomUUID();
  fixture.db.prepare('INSERT INTO volume(id,title,sort_order) VALUES(?,?,?)').run(volumeA, '后卷', 3);
  fixture.db.prepare('INSERT INTO volume(id,title,sort_order) VALUES(?,?,?)').run(volumeB, '前卷', 0);
  fixture.db.prepare('UPDATE chapter SET volume_id=?').run(volumeA);
  fixture.db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order,volume_id) VALUES(?,?,?,0,0,?)').run(chapter, '前卷章', JSON.stringify(emptyDocument()), volumeB);
  fixture.db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order,deleted_at) VALUES(?,?,?,0,0,?)').run(deleted, '已删章', JSON.stringify(emptyDocument()), '2026-10-09');
  const snapshot = createSnapshot(fixture.db, '卷顺序'), exportData = freezeSnapshotExport(fixture.db, snapshot.id);
  expect(exportData.volumes.map(volume => volume.title)).toEqual(['前卷', '后卷']);
  expect(exportData.volumes.map(volume => volume.chapters.map(item => item.title))).toEqual([['前卷章'], ['同名章节']]);
  expect(exportData.unvolumedChapters).toEqual([]);
  expect(exportTxtManuscript(exportData).toString()).not.toContain('已删章');
});

it('不存在、损坏、不支持版本和异作品快照均拒绝只读导出', () => {
  const snapshot = createSnapshot(fixture.db, '校验');
  expect(() => freezeSnapshotExport(fixture.db, crypto.randomUUID())).toThrow(/不存在/);
  fixture.db.prepare('UPDATE snapshot SET schema_version=99 WHERE id=?').run(snapshot.id);
  expect(() => freezeSnapshotExport(fixture.db, snapshot.id)).toThrow(/版本/);
  fixture.db.prepare('UPDATE snapshot SET schema_version=1,payload_hash=? WHERE id=?').run('bad', snapshot.id);
  expect(() => freezeSnapshotExport(fixture.db, snapshot.id)).toThrow(/校验/);
  const row = fixture.db.prepare('SELECT payload_json FROM snapshot WHERE id=?').get(snapshot.id) as { payload_json: string };
  const payload = JSON.parse(row.payload_json); payload.work_meta[0].id = crypto.randomUUID();
  const changed = JSON.stringify(payload);
  fixture.db.prepare('UPDATE snapshot SET payload_json=?,payload_hash=? WHERE id=?').run(changed, createHash('sha256').update(changed).digest('hex'), snapshot.id);
  expect(() => freezeSnapshotExport(fixture.db, snapshot.id)).toThrow(/身份/);
  expect(listSnapshots(fixture.db)).toHaveLength(1);
});
