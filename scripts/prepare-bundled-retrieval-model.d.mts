import type { RetrievalModelManifest } from '../src/shared/retrieval-model';
export interface ModelFile { path: string; bytes: number; sha256: string }
export interface ModelProvenance {
  schemaVersion: 1; repository: string; revision: string; upstreamRepository: string; upstreamRevision: string; manifestSha256: string;
  artifacts: (ModelFile & { kind: 'upstream-card' | 'candidate-card' | 'license' | 'conversion'; url: string })[];
}
export const bundledManifest: RetrievalModelManifest;
export function assertSafeLocalPath(path: string): void;
export function validateModelProvenance(evidence: unknown, manifest?: RetrievalModelManifest, trustedAnchor?: ModelProvenance | null): ModelProvenance;
export function validateExactDirectory(directory: string, files: ModelFile[]): Promise<void>;
export function validateModelWeightsDirectory(directory: string, manifest?: RetrievalModelManifest): Promise<void>;
export function validateProvenanceDirectory(directory: string, manifest?: RetrievalModelManifest, trustedAnchor?: ModelProvenance | null): Promise<ModelProvenance>;
export function prepareBundledRetrievalModel(options: { inputDirectory: string; evidenceDirectory: string; outputDirectory: string; manifest?: RetrievalModelManifest; trustedAnchor?: ModelProvenance | null }): Promise<void>;
