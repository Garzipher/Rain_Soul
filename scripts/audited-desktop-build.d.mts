export function auditedDesktopBuild<T>(build: () => Promise<T>, audit: () => Promise<unknown>): Promise<T>;
