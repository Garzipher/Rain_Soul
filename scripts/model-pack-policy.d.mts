export interface ModelPackConfiguration {
  mode: 'formal-bundled' | 'research-without-model'; message: string;
  config: { publish: null; nsis: { perMachine: false; packElevateHelper: false; allowElevation: false }; directories: { output: string }; beforePack(): Promise<void>; files: string[]; extraResources: { from: string; to: string }[]; afterPack(context: { appOutDir: string }): Promise<void> };
}
export function createModelPackConfiguration(options: { projectDirectory: string; args?: string[]; outputDirectory?: string }): Promise<ModelPackConfiguration>;
