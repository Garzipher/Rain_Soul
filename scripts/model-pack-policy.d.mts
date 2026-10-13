export interface ModelPackConfiguration {
  mode: 'formal-bundled' | 'research-without-model'; message: string;
  config: { directories: { output: string }; files: string[]; extraResources: { from: string; to: string }[]; afterPack(context: { appOutDir: string }): Promise<void> };
}
export function createModelPackConfiguration(options: { projectDirectory: string; args?: string[]; outputDirectory?: string }): Promise<ModelPackConfiguration>;
