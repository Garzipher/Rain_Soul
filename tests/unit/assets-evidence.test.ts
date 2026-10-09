import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { emptyDocument } from '../../src/shared/document';

describe('伏笔证据与原始出处', () => {
  let fixture: ReturnType<typeof assetFixture>;
  beforeEach(() => { fixture = assetFixture(); }); afterEach(() => fixture.db.close());
  it('段落删除后证据失效；重联创建新记录且不重写原出处', () => {
    let state = fixture.change({ type: 'createForeshadow', name: '约定' }); const foreshadowId = state.foreshadows[0].id;
    state = fixture.change({ type: 'addEvidence', foreshadowId, kind: '埋设', chapterId: fixture.chapterId, paragraphId: fixture.paragraphId, excerpt: '雨落下来' });
    const old = state.evidence[0]; expect(old.valid).toBe(true);
    const next = emptyDocument(); next.content[0].content = [{ type: 'text', text: '新段落' }];
    fixture.db.prepare('UPDATE chapter SET document_json=? WHERE id=?').run(JSON.stringify(next), fixture.chapterId);
    expect(fixture.state().evidence[0]).toMatchObject({ valid: false, invalidReason: expect.any(String) });
    state = fixture.change({ type: 'relinkEvidence', id: old.id, chapterId: fixture.chapterId, paragraphId: next.content[0].attrs.id, excerpt: '新的位置' });
    const replacement = state.evidence.find(e => e.supersedesId === old.id)!;
    expect(replacement.originalSource).toEqual(old.originalSource); expect(replacement.valid).toBe(true);
    expect(replacement.excerpt).toBe('新的位置');
    expect(state.evidence.find(e => e.id === old.id)?.supersededBy).toBe(replacement.id);
    expect(() => fixture.change({ type: 'relinkEvidence', id: old.id, chapterId: fixture.chapterId, paragraphId: null, excerpt: '' })).toThrow();
  });
  it('章节级证据可不绑定段落，软删章节失效，不误跳同名对象', () => {
    let state = fixture.change({ type: 'createForeshadow', name: '约定' }); const id = state.foreshadows[0].id;
    state = fixture.change({ type: 'addEvidence', foreshadowId: id, kind: '触发', chapterId: fixture.chapterId, paragraphId: null, excerpt: '整章' });
    expect(state.evidence[0].valid).toBe(true);
    fixture.db.prepare('UPDATE chapter SET deleted_at=? WHERE id=?').run(new Date().toISOString(), fixture.chapterId);
    expect(fixture.state().evidence[0].valid).toBe(false);
    expect(fixture.state().evidence[0].originalSource.chapterTitle).toBe('同名章节');
    expect(() => fixture.change({ type: 'addEvidence', foreshadowId: id, kind: '回收', chapterId: fixture.chapterId, paragraphId: null, excerpt: '' })).toThrow();
  });
  it('段落不存在或跨作品ID不能添加证据，删除证据可追溯', () => {
    let state = fixture.change({ type: 'createForeshadow', name: '约定' }); const id = state.foreshadows[0].id;
    expect(() => fixture.change({ type: 'addEvidence', foreshadowId: id, kind: '回收', chapterId: fixture.chapterId, paragraphId: crypto.randomUUID(), excerpt: '' })).toThrow();
    expect(() => fixture.change({ type: 'addEvidence', foreshadowId: crypto.randomUUID(), kind: '埋设', chapterId: fixture.chapterId, paragraphId: null, excerpt: '' })).toThrow();
    state = fixture.change({ type: 'addEvidence', foreshadowId: id, kind: '回收', chapterId: fixture.chapterId, paragraphId: fixture.paragraphId, excerpt: '真实出处' });
    state = fixture.change({ type: 'deleteEvidence', id: state.evidence[0].id });
    expect(state.evidence[0]).toMatchObject({ deletedAt: expect.any(String), originalSource: { excerpt: '真实出处' } });
  });
});
