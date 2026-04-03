// src/services/google-drive.ts
import { getAccessToken } from "./google-auth";

export async function fetchDocAsMarkdown(
  refreshToken: string,
  driveFileId: string
): Promise<{ title: string; markdown: string }> {
  const accessToken = await getAccessToken(refreshToken);

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) throw new Error(`Drive API error: ${metaRes.status}`);
  const meta = (await metaRes.json()) as { name: string };

  const exportRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!exportRes.ok) throw new Error(`Drive export error: ${exportRes.status}`);
  const markdown = await exportRes.text();

  return { title: meta.name, markdown };
}
