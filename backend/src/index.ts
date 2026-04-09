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
import { handleListOwners, handleInviteOwner, handleRemoveOwner } from "./routes/owners";

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
    "GET /",
    "GET /tos",
    "GET /privacy",
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

function html(body: string, status: number = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const landingPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hearthstone</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #faf9f6;
      color: #3d3529;
      padding: 2rem;
    }
    .logo { font-size: 4rem; margin-bottom: 0.5rem; }
    h1 { font-size: 2rem; font-weight: 600; margin-bottom: 0.75rem; }
    .tagline {
      font-size: 1.15rem;
      color: #6b6358;
      max-width: 420px;
      text-align: center;
      line-height: 1.5;
      margin-bottom: 2rem;
    }
    footer {
      margin-top: 3rem;
      font-size: 0.85rem;
      color: #9b9488;
    }
    footer a {
      color: #9b9488;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    footer a:hover { color: #6b6358; }
  </style>
</head>
<body>
  <div class="logo">🏠</div>
  <h1>Hearthstone</h1>
  <p class="tagline">
    Your household knowledge hub. Connect your docs, invite your
    people, and let anyone ask questions about how things work at home.
  </p>
  <footer>
    <a href="/tos">Terms of Service</a> · <a href="/privacy">Privacy Policy</a>
  </footer>
</body>
</html>`;

const legalPage = (title: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Hearthstone</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #faf9f6;
      color: #3d3529;
      padding: 2rem;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem; }
    p { color: #6b6358; line-height: 1.5; max-width: 420px; text-align: center; }
    a { color: #6b6358; text-underline-offset: 2px; }
    a:hover { color: #3d3529; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>None. This is a hobby/research project for friends and associates.</p>
  <p style="margin-top: 1.5rem;"><a href="/">← Back</a></p>
</body>
</html>`;

async function handleRequest(ctx: Context | undefined, req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    try {
      // --- Static pages ---
      if (method === "GET" && pathname === "/") return html(landingPage);
      if (method === "GET" && pathname === "/tos") return html(legalPage("Terms of Service"));
      if (method === "GET" && pathname === "/privacy") return html(legalPage("Privacy Policy"));

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
        const person = getDb().prepare("SELECT id, email, name FROM persons WHERE id = ?").get(owner.personId) as any;
        const household = getDb().prepare(
          "SELECT h.id, h.name, h.created_at FROM households h JOIN household_members hm ON hm.household_id = h.id WHERE hm.person_id = ? AND hm.role = 'owner' LIMIT 1"
        ).get(owner.personId) as any || null;
        return json({ person: { id: person.id, email: person.email, name: person.name || "" }, household });
      }

      if (method === "PATCH" && pathname === "/me") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json() as { name?: string };
        const name = body.name?.trim();
        if (!name) {
          return json({ message: "Name is required" }, 422);
        }
        getDb().prepare("UPDATE persons SET name = ? WHERE id = ?").run(name, owner.personId);
        const person = getDb().prepare("SELECT id, email, name FROM persons WHERE id = ?").get(owner.personId) as any;
        return json({ person: { id: person.id, email: person.email, name: person.name || "" } });
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

      // --- Owner management routes ---
      if (method === "GET" && pathname === "/household/owners") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleListOwners(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/household/owners") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = handleInviteOwner(getDb(), owner.householdId, owner.personId, body);
        return json(result.body, result.status);
      }

      const removeOwnerParams = parsePathParams("/household/owners/:id", pathname);
      if (method === "DELETE" && removeOwnerParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleRemoveOwner(getDb(), owner.householdId, removeOwnerParams.id);
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
        const result = await handleListDriveFiles(ctx, getDb(), owner.householdId, connFilesParams.id);
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

      // --- Guest document list ---
      if (method === "GET" && pathname === "/guest/documents") {
        const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
        const result = handleListDocuments(getDb(), guest.householdId);
        return json(result.body, result.status);
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
