export interface RestrictedRenderReport {
  diagnostics: string;
  temporaryDirectory: string;
  qualification: Record<string, string>;
  results: { name: string; status: string; error?: string }[];
}
export function qualifyRestrictedRender(reportPath: string): Promise<RestrictedRenderReport>;
