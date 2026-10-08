export interface WindowsFileRetryOptions { platform?: string; delay?: (milliseconds: number) => Promise<unknown> }
export function retryWindowsFileOperation<T>(operation: () => Promise<T>, options?: WindowsFileRetryOptions): Promise<T>;
