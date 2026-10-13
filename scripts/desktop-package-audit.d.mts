export interface BuildFile { path: string; bytes: number; sha256: string }
export interface BuildMembers { files: BuildFile[]; membersSha256: string }
export interface PackageAudit { schemaVersion: 1; asarSha256: string; membersSha256: string; memberCount: number; buildMembersSha256: string; unpackedFiles: number; files: (BuildFile & { unpacked: boolean })[]; resourceFiles: { path: string; sha256: string }[] }
export function checkDesktopBuild(directory: string): Promise<BuildMembers>;
export function auditDesktopPackage(resources: string, expected: BuildMembers, options?: { vendorDefaultAsar?: string; allowModel?: boolean }): Promise<PackageAudit>;
