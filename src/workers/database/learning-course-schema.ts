import { z } from 'zod';
import { writingDocumentSchema } from '../../shared/document';
import { RepositoryError } from './errors';

const title = z.string().trim().min(1);
const key = z.string().trim().min(1);
const chapter = z.object({ key, id: z.uuid(), title, document: writingDocumentSchema }).strict();
const courseSchema = z.object({
  id: z.literal('80d0c996-574e-5b8b-91d6-93fe72517231'),
  title: z.literal('项目全流程开发学习'),
  volumes: z.array(z.object({ key, id: z.uuid(), title, chapters: z.array(chapter).min(1) }).strict()).min(1),
}).strict().superRefine((course, context) => {
  const ids = new Set<string>([course.id]);
  const keys = new Set<string>();
  for (const volume of course.volumes) {
    for (const item of [volume, ...volume.chapters]) {
      if (ids.has(item.id.toLowerCase()) || keys.has(item.key)) {
        context.addIssue({ code: 'custom', message: '学习卷章的标识和源 key 必须全局唯一。' });
      }
      ids.add(item.id.toLowerCase());
      keys.add(item.key);
    }
  }
});

export function validateLearningCourse(value: unknown) {
  const result = courseSchema.safeParse(value);
  if (!result.success) throw new RepositoryError('INVALID_INPUT', '项目学习课程格式无效，未改动本机作品。');
  return result.data;
}
