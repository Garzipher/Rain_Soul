import type { RetrievalModelManifest } from '../src/shared/retrieval-model';
export function readResearchModelState(path: string): Promise<{ manifest: RetrievalModelManifest; sha256: string }>;
export function assertResearchModelUnchanged(path: string, expectedSha256: string): Promise<string>;
