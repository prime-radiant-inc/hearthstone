import { tracer, SpanStatusCode, startSpan, spanContext, type Context } from "./tracing"; // must be first import
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
import { handleListGuests, handleCreateGuest, handleRevokeGuest, handleReinviteGuest, handleDeleteGuest } from "./routes/guests";
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
  handleListDriveFiles,
} from "./routes/connections";
import { handleChat, handleGetSuggestions, handleChatPreview } from "./routes/chat";
import { handlePinRedeem } from "./routes/pin-auth";

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

/** Match a logical route pattern for the given pathname (used for span attributes). */
function matchRoute(method: string, pathname: string): string {
  const staticRoutes = [
    "POST /auth/register",
    "POST /auth/register/verify",
    "POST /auth/register/passkey",
    "POST /auth/login/passkey/challenge",
    "POST /auth/login/passkey/verify",
    "POST /auth/login/email",
    "POST /auth/login/email/verify",
    "POST /auth/invite/redeem",
    "POST /auth/pin/redeem",
    "GET /me",
    "POST /household",
    "PATCH /household",
    "GET /guests",
    "POST /guests",
    "GET /connections",
    "POST /connections/google-drive",
    "GET /connections/google-drive/callback",
    "GET /documents",
    "POST /documents",
    "POST /documents/upload",
    "POST /chat",
    "GET /chat/suggestions",
    "POST /chat/preview",
  ];
  const key = `${method} ${pathname}`;
  if (staticRoutes.includes(key)) return pathname;

  // Parameterized routes
  const paramPatterns = [
    "/guests/:id/reinvite",
    "/guests/:id/revoke",
    "/guests/:id",
    "/connections/:id/files",
    "/connections/:id",
    "/documents/:id/refresh",
    "/documents/:id/content",
    "/documents/:id",
  ];
  for (const p of paramPatterns) {
    if (parsePathParams(p, pathname)) return p;
  }
  return pathname;
}

async function handleRequest(ctx: Context | undefined, req: Request): Promise<Response> {
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

      if (method === "POST" && pathname === "/auth/pin/redeem") {
        const body = await req.json();
        const result = await handlePinRedeem(getDb(), body, config.jwtSecret);
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
        const result = await handleCreateGuest(getDb(), owner.householdId, owner.personId, body);
        return json(result.body, result.status);
      }

      const reinviteParams = parsePathParams("/guests/:id/reinvite", pathname);
      if (method === "POST" && reinviteParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleReinviteGuest(getDb(), owner.householdId, owner.personId, reinviteParams.id);
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
        if (result.redirect) {
          return new Response(null, {
            status: 302,
            headers: { Location: result.redirect },
          });
        }
        return json(result.body, result.status);
      }

      const connFilesParams = parsePathParams("/connections/:id/files", pathname);
      if (method === "GET" && connFilesParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = await handleListDriveFiles(getDb(), owner.householdId, connFilesParams.id);
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

        const result = await handleUploadDocument(ctx, getDb(), owner.householdId, title, file);
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
        const result = await handleConnectDocument(ctx, getDb(), owner.householdId, body);
        return json(result.body, result.status);
      }

      const refreshDocParams = parsePathParams("/documents/:id/refresh", pathname);
      if (method === "POST" && refreshDocParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = await handleRefreshDocument(ctx, getDb(), owner.householdId, refreshDocParams.id);
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
        return handleChat(ctx, getDb(), guest.householdId, body);
      }

      if (method === "GET" && pathname === "/chat/suggestions") {
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
        const result = handleGetSuggestions(getDb(), householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/chat/preview") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        return handleChatPreview(ctx, getDb(), owner.householdId, body);
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

async function tracedFetch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const route = matchRoute(req.method, url.pathname);

  const span = tracer.startSpan(`${req.method} ${route}`);
  span.setAttribute("http.method", req.method);
  span.setAttribute("http.url", url.pathname);
  span.setAttribute("http.route", route);

  // Pass the span's context explicitly to handleRequest and all downstream
  // services. Bun's AsyncLocalStorage loses context across await boundaries,
  // so we thread it manually instead of relying on startActiveSpan.
  const ctx = spanContext(span);

  try {
    const response = await handleRequest(ctx, req);
    span.setAttribute("http.status_code", response.status);
    if (response.status >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
    }
    return response;
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message || "unknown" });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

Bun.serve({ port: config.port, fetch: tracedFetch });
console.log(`Hearthstone backend running on http://localhost:${config.port}`);
