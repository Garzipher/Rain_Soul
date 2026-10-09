import { z } from 'zod';

const id = z.uuid();
const title = z.string().refine(value => value.trim().length > 0, '名称不能为空');
const direction = z.enum(['up', 'down']);
export const structureActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createVolume'), title }).strict(),
  z.object({ type: z.literal('renameWork'), title }).strict(),
  z.object({ type: z.literal('renameVolume'), volumeId: id, title }).strict(),
  z.object({ type: z.literal('moveVolume'), volumeId: id, direction }).strict(),
  z.object({ type: z.literal('moveChapter'), chapterId: id, direction }).strict(),
  z.object({ type: z.literal('setChapterVolume'), chapterId: id, volumeId: id.nullable() }).strict(),
  z.object({ type: z.literal('deleteVolume'), volumeId: id }).strict(),
  z.object({ type: z.literal('restoreVolume'), volumeId: id }).strict(),
  z.object({ type: z.literal('deleteChapter'), chapterId: id }).strict(),
  z.object({ type: z.literal('restoreChapter'), chapterId: id }).strict(),
  z.object({ type: z.literal('deleteWork') }).strict(),
  z.object({ type: z.literal('restoreWork') }).strict(),
]);
export const structureRequestSchema = z.object({
  workId: id, expectedRevision: z.number().int().positive(), operationId: id, action: structureActionSchema,
}).strict();
