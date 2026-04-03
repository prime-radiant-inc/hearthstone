import { getDb } from "./db/connection";
import { config } from "./config";
import { authenticateOwner } from "./middleware/owner-auth";
import { authenticateGuest } from "./middleware/guest-auth";
import {
  handleRegister,
  handleRegisterVerify,
  handleRegisterPasskey,
  handleLoginPasskeyChallenge,
  handleLoginPasskeyVerify,
  handleLoginEmail,
  handleLoginEmailVerify,
  handleInviteRedeem,
} from "./routes/auth";
import { handleUpdateHousehold } from "./routes/household";
import { handleCreateHousehold } from "./routes/household-create";
import { handleListGuests, handleCreateGuest, handleRevokeGuest, handleDeleteGuest } from "./routes/guests";
import {
  handleListDocuments,
  handleConnectDocument,
  handleRefreshDocument,
  handleDeleteDocument,
  handleGetContent,
  handleUploadDocument,
} from "./routes/documents";
import {
  handleListConnections,
  handleConnectGoogleDrive,
  handleGoogleDriveCallback,
  handleDeleteConnection,
} from "./routes/connections";
import { handleChat, handleGetSuggestions, handleChatPreview } from "./routes/chat";

function json(body: any, status: number = 200): Response {
  if (status === 204) return new Response(null, { status: 204 });
  return Response.json(body, { status });
}

function parsePathParams(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function parseMultipart(body: Buffer, boundary: string): { title: string; file: Buffer } {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = 0;

  while (true) {
    const idx = body.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    if (start > 0) parts.push(body.subarray(start, idx));
    start = idx + boundaryBuf.length;
    // Skip \r\n after boundary
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
  }

  let title = "";
  let file = Buffer.alloc(0);

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString();
    const content = part.subarray(headerEnd + 4);
    // Trim trailing \r\n
    const trimmed = content.subarray(
      0,
      content.length >= 2 && content[content.length - 2] === 0x0d ? content.length - 2 : content.length
    );

    if (headers.includes('name="title"')) {
      title = trimmed.toString().trim();
    } else if (headers.includes('name="file"')) {
      file = Buffer.from(trimmed);
    }
  }

  return { title, file };
}

import { createServer } from "node:http";

async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    try {
      // --- Auth routes (no auth required) ---
      if (method === "POST" && pathname === "/auth/register") {
        const body = await req.json();
        const result = await handleRegister(getDb(), body);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/register/verify") {
        const body = await req.json();
        const result = await handleRegisterVerify(getDb(), body);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/register/passkey") {
        const body = await req.json();
        const result = await handleRegisterPasskey(getDb(), body);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/login/passkey/challenge") {
        const body = await req.json();
        const result = await handleLoginPasskeyChallenge(getDb(), body);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/login/passkey/verify") {
        const body = await req.json();
        const result = await handleLoginPasskeyVerify(getDb(), body);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/login/email") {
        const body = await req.json();
        const result = await handleLoginEmail(getDb(), body);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/login/email/verify") {
        const body = await req.json();
        const result = await handleLoginEmailVerify(getDb(), body);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/invite/redeem") {
        const body = await req.json();
        const result = await handleInviteRedeem(getDb(), body);
        return json(result.body, result.status);
      }

      // --- Me endpoint ---
      if (method === "GET" && pathname === "/me") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const person = getDb().prepare("SELECT id, email FROM persons WHERE id = ?").get(owner.personId) as any;
        // Look up household by owner_id, not JWT's householdId — covers the case
        // where household was created after the JWT was issued
        const household = getDb().prepare("SELECT id, name, created_at FROM households WHERE owner_id = ?").get(owner.personId) as any || null;
        return json({ person: { id: person.id, email: person.email }, household });
      }

      // --- Owner routes ---
      if (method === "POST" && pathname === "/household") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = handleCreateHousehold(getDb(), owner.personId, body);
        return json(result.body, result.status);
      }

      if (method === "PATCH" && pathname === "/household") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = handleUpdateHousehold(getDb(), owner.householdId, body);
        return json(result.body, result.status);
      }

      if (method === "GET" && pathname === "/guests") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleListGuests(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/guests") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = await handleCreateGuest(getDb(), owner.householdId, body);
        return json(result.body, result.status);
      }

      const revokeParams = parsePathParams("/guests/:id/revoke", pathname);
      if (method === "POST" && revokeParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleRevokeGuest(getDb(), owner.householdId, revokeParams.id);
        return json(result.body, result.status);
      }

      const deleteGuestParams = parsePathParams("/guests/:id", pathname);
      if (method === "DELETE" && deleteGuestParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleDeleteGuest(getDb(), owner.householdId, deleteGuestParams.id);
        return json(result.body, result.status);
      }

      // --- Connection routes ---
      if (method === "GET" && pathname === "/connections") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleListConnections(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/connections/google-drive") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleConnectGoogleDrive(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "GET" && pathname === "/connections/google-drive/callback") {
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const result = await handleGoogleDriveCallback(getDb(), code, state);
        return json(result.body, result.status);
      }

      const deleteConnParams = parsePathParams("/connections/:id", pathname);
      if (method === "DELETE" && deleteConnParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleDeleteConnection(getDb(), owner.householdId, deleteConnParams.id);
        return json(result.body, result.status);
      }

      // --- Document routes ---
      if (method === "POST" && pathname === "/documents/upload") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);

        const contentType = req.headers.get("content-type") || "";
        const boundary = contentType.split("boundary=")[1];
        if (!boundary) return json({ message: "Expected multipart/form-data" }, 400);

        const body = Buffer.from(await req.arrayBuffer());
        const { title, file } = parseMultipart(body, boundary);

        const result = await handleUploadDocument(getDb(), owner.householdId, title, file);
        return json(result.body, result.status);
      }

      if (method === "GET" && pathname === "/documents") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleListDocuments(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/documents") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = await handleConnectDocument(getDb(), owner.householdId, body);
        return json(result.body, result.status);
      }

      const refreshDocParams = parsePathParams("/documents/:id/refresh", pathname);
      if (method === "POST" && refreshDocParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = await handleRefreshDocument(getDb(), owner.householdId, refreshDocParams.id);
        return json(result.body, result.status);
      }

      const docContentParams = parsePathParams("/documents/:id/content", pathname);
      if (method === "GET" && docContentParams) {
        // Accepts BOTH owner and guest auth
        let householdId: string;
        try {
          const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
          householdId = owner.householdId;
        } catch {
          try {
            const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
            householdId = guest.householdId;
          } catch {
            return json({ message: "Unauthorized" }, 401);
          }
        }
        const result = handleGetContent(getDb(), householdId, docContentParams.id);
        return json(result.body, result.status);
      }

      const deleteDocParams = parsePathParams("/documents/:id", pathname);
      if (method === "DELETE" && deleteDocParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleDeleteDocument(getDb(), owner.householdId, deleteDocParams.id);
        return json(result.body, result.status);
      }

      // --- Chat routes ---
      if (method === "POST" && pathname === "/chat") {
        const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
        const body = await req.json();
        return handleChat(getDb(), guest.householdId, body);
      }

      if (method === "GET" && pathname === "/chat/suggestions") {
        const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
        const result = handleGetSuggestions(getDb(), guest.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/chat/preview") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        return handleChatPreview(getDb(), owner.householdId, body);
      }

      return json({ message: "Not found" }, 404);
    } catch (err: any) {
      if (err.message === "unauthorized") {
        return json({ message: "Unauthorized" }, 401);
      }
      if (err.message === "session_expired") {
        return json({ message: "Your session has expired. Please use your invite link again." }, 401);
      }
      console.error("Unhandled error:", err);
      return json({ message: "Something went wrong. Please try again." }, 500);
    }
}

// Node HTTP server adapter — converts between Node streams and Web API Request/Response
const server = createServer(async (nodeReq, nodeRes) => {
  const url = `http://localhost:${config.port}${nodeReq.url}`;
  const body = await new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    nodeReq.on("data", (chunk: Buffer) => chunks.push(chunk));
    nodeReq.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const webReq = new Request(url, {
    method: nodeReq.method,
    headers: nodeReq.headers as Record<string, string>,
    body: ["GET", "HEAD"].includes(nodeReq.method!) ? undefined : body.length > 0 ? body : undefined,
  });

  const webRes = await handleRequest(webReq);

  nodeRes.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));

  if (webRes.body) {
    const reader = webRes.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { nodeRes.end(); return; }
        nodeRes.write(value);
      }
    };
    pump();
  } else {
    nodeRes.end();
  }
});

server.listen(config.port, () => {
  console.log(`Hearthstone backend running on http://localhost:${config.port}`);
});
