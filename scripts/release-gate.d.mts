export const windowsCases: readonly string[];
export const cloudOperations: readonly string[];
export interface ReleaseEvidenceReport {
  status: 'blocked' | 'evidence-complete'; schemaOnly: true;
  issues: { path: string; message: string }[]; warning: string;
}
export function validateReleaseEvidence(input: unknown): ReleaseEvidenceReport;
