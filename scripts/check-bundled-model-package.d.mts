import type { RetrievalModelManifest } from '../src/shared/retrieval-model';
import type { ModelProvenance } from './prepare-bundled-retrieval-model.mjs';
export function checkBundledModelPackage(resourcesDirectory: string, manifest?: RetrievalModelManifest, trustedAnchor?: ModelProvenance | null): Promise<void>;
