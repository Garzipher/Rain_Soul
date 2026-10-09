import { z } from 'zod';

export const penNameInputSchema = z.string().trim().max(80, '名称最多 80 个字符');
export const authorProfileSchema = z.object({
  penName: z.string().max(80).refine(value => value === value.trim()),
  avatarDataUrl: z.string().max(1_398_126).regex(/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).nullable(),
}).strict();
export type AuthorProfile = z.infer<typeof authorProfileSchema>;
