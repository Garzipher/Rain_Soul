/** builder可能在afterPack后追加资源，必须等全部构建结束再审计最终目录。 */
export async function auditedDesktopBuild(build, audit) {
  const artifacts = await build();
  await audit();
  return artifacts;
}
