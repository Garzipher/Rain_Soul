import type Database from 'better-sqlite3';
import type { AssetAction, AssetState } from '../../shared/assets';
import { assetActionSchema } from '../../shared/assets-schema';
import { applyPlotAsset } from './assets-plot';
import { applyKnowledgeAsset } from './assets-knowledge';
import { applyEvidenceAsset, readEvidence } from './assets-evidence';
import { applyStyleAsset } from './assets-style';
import { RepositoryError } from './errors';
import { recordAssetChanges } from './assets-history';

export function applyAsset(db: Database.Database, input: AssetAction, revision: number): void {
  const parsed = assetActionSchema.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(revision) || revision < 1) throw new RepositoryError('INVALID_INPUT', '作品资产操作参数无效。');
  const action = parsed.data;
  recordAssetChanges(db, action, revision, 'before');
  if (!applyPlotAsset(db, action) && !applyKnowledgeAsset(db, action, revision)
    && !applyEvidenceAsset(db, action, revision) && !applyStyleAsset(db, action)) throw new RepositoryError('INVALID_INPUT', '未知作品资产操作。');
  recordAssetChanges(db, action, revision, 'after');
}
export function readAssets(db: Database.Database): AssetState {
  const outlines = db.prepare('SELECT id,type,parent_id AS parentId,title,summary,chapter_id AS chapterId,sort_order AS sortOrder,deleted_at AS deletedAt FROM outline_node ORDER BY sort_order,rowid').all() as Omit<AssetState['outlines'][number], 'knowledgeIds'>[];
  const knowledge = db.prepare('SELECT id,body,source,category_id AS categoryId,origin_json AS origin,revision,deleted_at AS deletedAt FROM knowledge_entry ORDER BY rowid DESC').all() as (Omit<AssetState['knowledge'][number], 'tagIds' | 'origin'> & { origin: string | null })[];
  const profiles = db.prepare('SELECT id,version,payload_json AS payload,created_at AS createdAt FROM style_profile ORDER BY version').all() as (Omit<AssetState['styleProfiles'][number], 'payload'> & { payload: string })[];
  return {
    outlines: outlines.map(node => ({ ...node, knowledgeIds: (db.prepare('SELECT knowledge_id AS id FROM outline_knowledge WHERE node_id=? ORDER BY rowid').all(node.id) as { id: string }[]).map(row => row.id) })),
    foreshadows: db.prepare('SELECT id,name,status,description,outline_id AS outlineId,deleted_at AS deletedAt FROM foreshadow ORDER BY rowid').all() as AssetState['foreshadows'],
    evidence: readEvidence(db),
    categories: db.prepare('SELECT id,name,parent_id AS parentId,sort_order AS sortOrder,system_key AS systemKey,deleted_at AS deletedAt FROM category ORDER BY sort_order,rowid').all() as AssetState['categories'],
    tags: db.prepare('SELECT id,name,deleted_at AS deletedAt FROM tag ORDER BY rowid').all() as AssetState['tags'],
    knowledge: knowledge.map(entry => ({ ...entry, origin: entry.origin ? JSON.parse(entry.origin) as AssetState['knowledge'][number]['origin'] : null,
      tagIds: (db.prepare('SELECT tag_id AS id FROM knowledge_tag WHERE entry_id=? ORDER BY rowid').all(entry.id) as { id: string }[]).map(row => row.id) })),
    styleProfiles: profiles.map(profile => ({ ...profile, payload: JSON.parse(profile.payload) as AssetState['styleProfiles'][number]['payload'] })),
    chapterStyles: db.prepare('SELECT chapter_id AS chapterId,profile_id AS profileId FROM chapter_style').all() as AssetState['chapterStyles'],
    defaultStyleId: (db.prepare('SELECT profile_id AS id FROM style_default WHERE singleton=1').get() as { id: string | null }).id,
  };
}
