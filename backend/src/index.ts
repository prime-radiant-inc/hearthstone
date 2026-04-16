import { tracer, SpanStatusCode, startSpan, spanContext, type Context } from "./tracing"; // must be first import
import { getDb } from "./db/connection";
import { config } from "./config";
import { authenticateOwner } from "./middleware/owner-auth";
import { authenticateGuest } from "./middleware/guest-auth";
import { handleUpdateHousehold, handleDeleteHousehold } from "./routes/household";
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
import { handleJoinPage } from "./routes/join";
import { mintAdminToken, getAdminToken } from "./services/admin-token";
import { handleAdminAuth, handleAdminPage, handleAdminHouses, handleAdminCreateHouse, handleAdminInviteOwner, handleAdminDeleteHouse, handleAdminInfo, handleAdminRateLimits, handleAdminClearRateLimit } from "./routes/admin";
import { createRateLimiter, resolveClientIp, rateLimited, type Tier } from "./middleware/rate-limit";
import { requireAdmin } from "./middleware/admin-auth";
import { assertHouseholdExists, HouseholdGoneError } from "./services/household-deletion";
import { publicEmail } from "./utils";
import pkg from "../package.json" with { type: "json" };

// Read version from package.json directly. Bun does not populate
// `process.env.npm_package_version` the way npm does, so the old
// `process.env.npm_package_version || "0.0.0"` always returned "0.0.0"
// regardless of the value in package.json.
const PACKAGE_VERSION: string = (pkg as { version?: string }).version ?? "0.0.0";

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
    "POST /auth/pin/redeem",
    "GET /me",
    "POST /household",
    "PATCH /household",
    "DELETE /household",
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
    "GET /admin/rate-limits",
    "POST /admin/rate-limits/clear",
  ];
  const key = `${method} ${pathname}`;
  if (staticRoutes.includes(key)) return pathname;

  // Parameterized routes
  const paramPatterns = [
    "/join/:pin",
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
    const clientIp = resolveClientIp(req);
    const guard = (tier: Tier, key: string, routeLabel: string): Response | null =>
      rateLimited(rateLimiter, req, tier, key, routeLabel, ctx);

    try {
      // --- Static pages ---
      if (method === "GET" && pathname === "/") return html(landingPage);
      if (method === "GET" && pathname === "/tos") return html(legalPage("Terms of Service"));
      if (method === "GET" && pathname === "/privacy") return html(legalPage("Privacy Policy"));

      // --- Join landing page ---
      const joinParams = parsePathParams("/join/:pin", pathname);
      if (method === "GET" && joinParams) {
        const limited = guard("3", clientIp, "GET /join/:pin");
        if (limited) return limited;
        const result = handleJoinPage(joinParams.pin, config.hearthstonePublicUrl);
        return new Response(result.body, {
          status: result.status,
          headers: { "Content-Type": result.contentType },
        });
      }

      // --- Admin routes ---
      if (method === "POST" && pathname === "/admin/auth") {
        const result = handleAdminAuth(url.searchParams.get("t"), getAdminToken());
        return new Response(null, { status: result.status, headers: result.headers });
      }
      // Allow GET on /admin/auth too — clicking a link from a terminal is a GET.
      if (method === "GET" && pathname === "/admin/auth") {
        const result = handleAdminAuth(url.searchParams.get("t"), getAdminToken());
        return new Response(null, { status: result.status, headers: result.headers });
      }

      if (method === "GET" && pathname === "/admin") {
        if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
        const result = handleAdminPage();
        return html(result.body, result.status);
      }

      if (method === "GET" && pathname === "/admin/houses") {
        if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
        const result = handleAdminHouses(getDb());
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/admin/houses") {
        if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
        const body = await req.json();
        const result = await handleAdminCreateHouse(getDb(), body, config.hearthstonePublicUrl);
        return json(result.body, result.status);
      }

      {
        const params = parsePathParams("/admin/houses/:id/owner-invite", pathname);
        if (method === "POST" && params) {
          if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
          const body = await req.json().catch(() => null);
          const result = await handleAdminInviteOwner(getDb(), params.id, body, config.hearthstonePublicUrl);
          return json(result.body, result.status);
        }
      }

      {
        const params = parsePathParams("/admin/houses/:id", pathname);
        if (method === "DELETE" && params) {
          if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
          const result = handleAdminDeleteHouse(getDb(), params.id);
          if (result.body === null) return new Response(null, { status: 204 });
          return json(result.body, result.status);
        }
      }

      if (method === "GET" && pathname === "/admin/info") {
        if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
        const result = handleAdminInfo(getDb(), config.hearthstonePublicUrl, config.databaseUrl, PACKAGE_VERSION);
        return json(result.body, result.status);
      }

      if (method === "GET" && pathname === "/admin/rate-limits") {
        if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
        const result = handleAdminRateLimits(rateLimiter);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/admin/rate-limits/clear") {
        if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
        const body = await req.json().catch(() => null);
        const result = handleAdminClearRateLimit(rateLimiter, body);
        if (result.body === null) return new Response(null, { status: 204 });
        return json(result.body, result.status);
      }

      // --- Auth routes (no auth required) ---
      if (method === "POST" && pathname === "/auth/pin/redeem") {
        const limited = guard("1", clientIp, "POST /auth/pin/redeem");
        if (limited) return limited;
        const body = await req.json();
        const result = await handlePinRedeem(getDb(), body, config.jwtSecret);
        return json(result.body, result.status);
      }

      // --- Me endpoint ---
      if (method === "GET" && pathname === "/me") {
        const limited = guard("3", clientIp, "GET /me");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const person = getDb().prepare("SELECT id, email, name FROM persons WHERE id = ?").get(owner.personId) as any;
        const household = getDb().prepare(
          "SELECT h.id, h.name, h.created_at FROM households h JOIN household_members hm ON hm.household_id = h.id WHERE hm.person_id = ? AND hm.role = 'owner' LIMIT 1"
        ).get(owner.personId) as any || null;
        return json({ person: { id: person.id, email: publicEmail(person.email), name: person.name || "" }, household });
      }

      if (method === "PATCH" && pathname === "/me") {
        const limited = guard("3", clientIp, "PATCH /me");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const body = await req.json() as { name?: string };
        const name = body.name?.trim();
        if (!name) {
          return json({ message: "Name is required" }, 422);
        }
        getDb().prepare("UPDATE persons SET name = ? WHERE id = ?").run(name, owner.personId);
        const person = getDb().prepare("SELECT id, email, name FROM persons WHERE id = ?").get(owner.personId) as any;
        return json({ person: { id: person.id, email: publicEmail(person.email), name: person.name || "" } });
      }

      // --- Owner routes ---
      if (method === "POST" && pathname === "/household") {
        const limited = guard("3", clientIp, "POST /household");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const body = await req.json();
        const result = handleCreateHousehold(getDb(), owner.personId, body);
        return json(result.body, result.status);
      }

      if (method === "PATCH" && pathname === "/household") {
        const limited = guard("3", clientIp, "PATCH /household");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const body = await req.json();
        const result = handleUpdateHousehold(getDb(), owner.householdId, body);
        return json(result.body, result.status);
      }

      if (method === "DELETE" && pathname === "/household") {
        const limited = guard("3", clientIp, "DELETE /household");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleDeleteHousehold(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "GET" && pathname === "/guests") {
        const limited = guard("3", clientIp, "GET /guests");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleListGuests(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/guests") {
        const limited = guard("3", clientIp, "POST /guests");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const body = await req.json();
        const result = await handleCreateGuest(getDb(), owner.householdId, owner.personId, body, config.hearthstonePublicUrl);
        return json(result.body, result.status);
      }

      const reinviteParams = parsePathParams("/guests/:id/reinvite", pathname);
      if (method === "POST" && reinviteParams) {
        const limited = guard("3", clientIp, "POST /guests/:id/reinvite");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleReinviteGuest(getDb(), owner.householdId, owner.personId, reinviteParams.id, config.hearthstonePublicUrl);
        return json(result.body, result.status);
      }

      const revokeParams = parsePathParams("/guests/:id/revoke", pathname);
      if (method === "POST" && revokeParams) {
        const limited = guard("3", clientIp, "POST /guests/:id/revoke");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleRevokeGuest(getDb(), owner.householdId, revokeParams.id);
        return json(result.body, result.status);
      }

      const deleteGuestParams = parsePathParams("/guests/:id", pathname);
      if (method === "DELETE" && deleteGuestParams) {
        const limited = guard("3", clientIp, "DELETE /guests/:id");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleDeleteGuest(getDb(), owner.householdId, deleteGuestParams.id);
        return json(result.body, result.status);
      }

      // --- Owner management routes ---
      if (method === "GET" && pathname === "/household/owners") {
        const limited = guard("3", clientIp, "GET /household/owners");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleListOwners(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/household/owners") {
        const limited = guard("3", clientIp, "POST /household/owners");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const body = await req.json();
        const result = handleInviteOwner(getDb(), owner.householdId, owner.personId, body, config.hearthstonePublicUrl);
        return json(result.body, result.status);
      }

      const removeOwnerParams = parsePathParams("/household/owners/:id", pathname);
      if (method === "DELETE" && removeOwnerParams) {
        const limited = guard("3", clientIp, "DELETE /household/owners/:id");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleRemoveOwner(getDb(), owner.householdId, removeOwnerParams.id);
        return json(result.body, result.status);
      }

      // --- Connection routes ---
      if (method === "GET" && pathname === "/connections") {
        const limited = guard("3", clientIp, "GET /connections");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleListConnections(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/connections/google-drive") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const limited = guard("2", owner.householdId, "POST /connections/google-drive");
        if (limited) return limited;
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
        const limited = guard("3", clientIp, "GET /connections/:id/files");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = await handleListDriveFiles(ctx, getDb(), owner.householdId, connFilesParams.id);
        return json(result.body, result.status);
      }

      const deleteConnParams = parsePathParams("/connections/:id", pathname);
      if (method === "DELETE" && deleteConnParams) {
        const limited = guard("3", clientIp, "DELETE /connections/:id");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleDeleteConnection(getDb(), owner.householdId, deleteConnParams.id);
        return json(result.body, result.status);
      }

      // --- Document routes ---
      if (method === "POST" && pathname === "/documents/upload") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const limited = guard("2", owner.householdId, "POST /documents/upload");
        if (limited) return limited;

        const contentType = req.headers.get("content-type") || "";
        const boundary = contentType.split("boundary=")[1];
        if (!boundary) return json({ message: "Expected multipart/form-data" }, 400);

        const body = Buffer.from(await req.arrayBuffer());
        const { title, file } = parseMultipart(body, boundary);

        const result = await handleUploadDocument(ctx, getDb(), owner.householdId, title, file);
        return json(result.body, result.status);
      }

      if (method === "GET" && pathname === "/documents") {
        const limited = guard("3", clientIp, "GET /documents");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleListDocuments(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/documents") {
        const limited = guard("3", clientIp, "POST /documents");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const body = await req.json();
        const result = await handleConnectDocument(ctx, getDb(), owner.householdId, body);
        return json(result.body, result.status);
      }

      const refreshDocParams = parsePathParams("/documents/:id/refresh", pathname);
      if (method === "POST" && refreshDocParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const limited = guard("2", owner.householdId, "POST /documents/:id/refresh");
        if (limited) return limited;
        const result = await handleRefreshDocument(ctx, getDb(), owner.householdId, refreshDocParams.id);
        return json(result.body, result.status);
      }

      const docContentParams = parsePathParams("/documents/:id/content", pathname);
      if (method === "GET" && docContentParams) {
        const limited = guard("3", clientIp, "GET /documents/:id/content");
        if (limited) return limited;
        // Accepts BOTH owner and guest auth
        let householdId: string;
        try {
          const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
          householdId = owner.householdId;
        } catch (authErr) {
          if (authErr instanceof HouseholdGoneError) throw authErr;
          try {
            const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
            householdId = guest.householdId;
          } catch {
            return json({ message: "Unauthorized" }, 401);
          }
        }
        assertHouseholdExists(getDb(), householdId);
        const result = handleGetContent(getDb(), householdId, docContentParams.id);
        return json(result.body, result.status);
      }

      const deleteDocParams = parsePathParams("/documents/:id", pathname);
      if (method === "DELETE" && deleteDocParams) {
        const limited = guard("3", clientIp, "DELETE /documents/:id");
        if (limited) return limited;
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const result = handleDeleteDocument(getDb(), owner.householdId, deleteDocParams.id);
        return json(result.body, result.status);
      }

      // --- Chat routes ---
      if (method === "POST" && pathname === "/chat") {
        const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
        assertHouseholdExists(getDb(), guest.householdId);
        const limited = guard("2", guest.householdId, "POST /chat");
        if (limited) return limited;
        const body = await req.json();
        return handleChat(ctx, getDb(), guest.householdId, body);
      }

      if (method === "GET" && pathname === "/chat/suggestions") {
        const limited = guard("3", clientIp, "GET /chat/suggestions");
        if (limited) return limited;
        let householdId: string;
        try {
          const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
          householdId = owner.householdId;
        } catch (authErr) {
          if (authErr instanceof HouseholdGoneError) throw authErr;
          try {
            const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
            householdId = guest.householdId;
          } catch {
            return json({ message: "Unauthorized" }, 401);
          }
        }
        assertHouseholdExists(getDb(), householdId);
        const result = handleGetSuggestions(getDb(), householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/chat/preview") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        assertHouseholdExists(getDb(), owner.householdId);
        const limited = guard("2", owner.householdId, "POST /chat/preview");
        if (limited) return limited;
        const body = await req.json();
        return handleChatPreview(ctx, getDb(), owner.householdId, body);
      }

      // --- Guest document list ---
      if (method === "GET" && pathname === "/guest/documents") {
        const limited = guard("3", clientIp, "GET /guest/documents");
        if (limited) return limited;
        const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
        assertHouseholdExists(getDb(), guest.householdId);
        const result = handleListDocuments(getDb(), guest.householdId);
        return json(result.body, result.status);
      }

      return json({ message: "Not found" }, 404);
    } catch (err: any) {
      if (err instanceof HouseholdGoneError) {
        return json({ message: "house_deleted" }, 410);
      }
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

// HEARTHSTONE_PUBLIC_URL is now enforced by config.ts's `required()` — it
// throws a clear error at import time if the var is missing, which is earlier
// and louder than a manual boot-time check here.

const _adminToken = mintAdminToken();
console.log("=== Hearthstone admin ===");
console.log(`URL: ${config.hearthstonePublicUrl}/admin/auth?t=${_adminToken}`);
console.log("Valid until process restart.");

const rateLimiter = createRateLimiter();

// Guard against hot-reload stacking intervals in dev.
if (!(globalThis as any).__rateLimitSweep && process.env.NODE_ENV !== "test") {
  (globalThis as any).__rateLimitSweep = setInterval(() => rateLimiter.sweep(), 5 * 60 * 1000);
}

Bun.serve({ port: config.port, fetch: tracedFetch });
console.log(`Hearthstone backend running on http://localhost:${config.port}`);
