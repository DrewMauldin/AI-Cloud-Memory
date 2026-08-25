export interface ExportConfiguration {
  EXPORT_ENCRYPTION_KEY?: string;
  GITHUB_EXPORT_TOKEN?: string;
}

export function exportCapabilities(env: ExportConfiguration) {
  const encryptedDownload = /^[0-9a-f]{64}$/i.test(env.EXPORT_ENCRYPTION_KEY ?? "");
  return {
    encryptedDownload,
    githubExport: encryptedDownload && Boolean(env.GITHUB_EXPORT_TOKEN),
  };
}
