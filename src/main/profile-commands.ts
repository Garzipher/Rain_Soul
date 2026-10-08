import { z } from 'zod';
import type { AuthorProfile } from '../shared/profile';
import { penNameInputSchema } from '../shared/profile';
import type { ProfileService } from './profile-service';

const schemas = { getAuthorProfile: z.object({}).strict(), setPenName: z.object({ penName: penNameInputSchema }).strict(),
  chooseAvatar: z.object({}).strict(), clearAvatar: z.object({}).strict() };
export class ProfileCommands {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly service: ProfileService, private readonly choose: () => Promise<AuthorProfile>) {}
  accepts(command: string): boolean { return Object.hasOwn(schemas, command); }
  execute(command: string, payload: unknown): Promise<AuthorProfile> {
    const operation = this.queue.then(async () => {
      if (!this.accepts(command)) throw new Error('未知个人资料命令');
      const parsed = schemas[command as keyof typeof schemas].parse(payload);
      switch (command) {
        case 'getAuthorProfile': return this.service.get();
        case 'setPenName': return this.service.setPenName('penName' in parsed ? parsed.penName : undefined);
        case 'chooseAvatar': return this.choose();
        case 'clearAvatar': return this.service.clearAvatar();
        default: throw new Error('未知个人资料命令');
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async drain() { await this.queue; }
}
