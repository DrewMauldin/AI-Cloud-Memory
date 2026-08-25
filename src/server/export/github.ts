interface PushEncryptedExportInput {
  repository: string;
  path: string;
  encrypted: string;
  token: string;
  fetcher?: typeof fetch;
}

interface GitHubContentsResponse {
  content?: { sha?: string };
  commit?: { sha?: string };
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function pushEncryptedExport(
  input: PushEncryptedExportInput,
): Promise<{ commitSha: string }> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
    throw new Error("GitHub export repository is invalid");
  }
  if (!/^exports\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[A-Za-z0-9_.-]+\.enc\.json$/.test(input.path)) {
    throw new Error("GitHub export path is outside the encrypted export directory");
  }
  if (!input.token) throw new Error("GitHub export token is not configured");
  const [owner, repository] = input.repository.split("/");
  const path = input.path.split("/").map(encodeURIComponent).join("/");
  const response = await (input.fetcher ?? fetch)(
    `https://api.github.com/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(repository ?? "")}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "cloud-memory-exporter",
      },
      body: JSON.stringify({
        message: `backup: add encrypted Cloud Memory snapshot ${input.path.split("/").at(-1)}`,
        content: encodeBase64(input.encrypted),
      }),
    },
  );
  const body = (await response.json().catch(() => null)) as GitHubContentsResponse | null;
  if (!response.ok) throw new Error(`GitHub export failed (${response.status})`);
  const commitSha = body?.commit?.sha ?? body?.content?.sha;
  if (!commitSha) throw new Error("GitHub did not return an export commit SHA");
  return { commitSha };
}
