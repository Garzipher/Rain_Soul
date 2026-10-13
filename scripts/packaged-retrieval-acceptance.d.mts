export interface FileIdentity { path?: string; bytes: number; sha256: string }
export interface PackagedModelManifest { revision: string; files: (FileIdentity & { path: string })[]; similarityThreshold: number | null }
export interface PackageIdentity { executable: FileIdentity & { path: string }; asar: FileIdentity & { path: string }; manifestSha256: string; modelDirectory: string; runtimePath: string; runtimeFiles: (FileIdentity & { path: string })[]; weights: (FileIdentity & { path: string })[] }
export interface QualityFixture { knowledge: { id: string; body: string }[]; acceptance: { id: string; text: string; group: string; relevantIds: string[] }[] }
export interface QualityResult { threshold: number; semanticParaphraseRecall: number; keywordParaphraseRecall: number; noRelevantFalsePositiveQueries: number; meetsNumericTargets: boolean; results: unknown[] }
export const qualificationFixtureHash: string;
export function assertQualificationFixture(fixture: unknown): void;
export function inspectPackagedRetrieval(executable: string, manifest: PackagedModelManifest): Promise<PackageIdentity>;
export function evaluateRetrievalQuality(fixture: QualityFixture, documents: number[][], queries: number[][], threshold: number | null): QualityResult;
export function assertPackagedAcceptance(identity: unknown, result: { identity: unknown; dimensions: number; networkAttempts: number; coldLoadMs: number; quality: { meetsNumericTargets: boolean } }): void;
