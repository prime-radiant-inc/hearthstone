// src/services/google-drive.ts
import { getAccessToken } from "./google-auth";
import { docxToMarkdown } from "./pandoc";
import { startSpan, SpanStatusCode, type Context } from "../tracing";

export async function fetchDocAsMarkdown(
  refreshToken: string,
  driveFileId: string,
  ctx?: Context
): Promise<{ title: string; markdown: string }> {
  const span = startSpan("google_drive.fetch_doc", ctx);
  span.setAttribute("app.drive_file_id", driveFileId);
  try {
    const accessToken = await getAccessToken(refreshToken);

    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) throw new Error(`Drive API error: ${metaRes.status}`);
    const meta = (await metaRes.json()) as { name: string };

    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!exportRes.ok) throw new Error(`Drive export error: ${exportRes.status}`);

    const docxBuffer = Buffer.from(await exportRes.arrayBuffer());
    const markdown = await docxToMarkdown(docxBuffer);

    return { title: meta.name, markdown };
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
}

export async function listDriveFiles(
  refreshToken: string,
  ctx?: Context
): Promise<DriveFileInfo[]> {
  const span = startSpan("google_drive.list_files", ctx);
  try {
    const accessToken = await getAccessToken(refreshToken);

    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.document'",
      fields: "files(id,name,modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: "100",
    });

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Drive API error: ${res.status}`);

    const data = (await res.json()) as { files: DriveFileInfo[] };
    return data.files || [];
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
