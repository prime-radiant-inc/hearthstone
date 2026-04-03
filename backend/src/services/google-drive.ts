// src/services/google-drive.ts
import { getAccessToken } from "./google-auth";
import { docxToMarkdown } from "./pandoc";

export async function fetchDocAsMarkdown(
  refreshToken: string,
  driveFileId: string
): Promise<{ title: string; markdown: string }> {
  const accessToken = await getAccessToken(refreshToken);

  // Get file metadata
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) throw new Error(`Drive API error: ${metaRes.status}`);
  const meta = (await metaRes.json()) as { name: string };

  // Export as docx
  const exportRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!exportRes.ok) throw new Error(`Drive export error: ${exportRes.status}`);

  const docxBuffer = Buffer.from(await exportRes.arrayBuffer());
  const markdown = await docxToMarkdown(docxBuffer);

  return { title: meta.name, markdown };
}
