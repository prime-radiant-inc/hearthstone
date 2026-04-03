import { getDb } from "./db/connection";
import { config } from "./config";
import { authenticateOwner } from "./middleware/owner-auth";
import { authenticateGuest } from "./middleware/guest-auth";
import { handleGoogleAuthStart, handleGoogleCallback, handleInviteRedeem } from "./routes/auth";
import { handleUpdateHousehold } from "./routes/household";
import { handleListGuests, handleCreateGuest, handleRevokeGuest, handleDeleteGuest } from "./routes/guests";
import {
  handleListDocuments,
  handleConnectDocument,
  handleRefreshDocument,
  handleDeleteDocument,
  handleGetContent,
} from "./routes/documents";
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

const server = Bun.serve({
  port: config.port,

  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    try {
      // --- Auth routes (no auth required) ---
      if (method === "POST" && pathname === "/auth/google") {
        return handleGoogleAuthStart();
      }

      if (method === "GET" && pathname === "/auth/google/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return json({ message: "Missing code or state" }, 400);
        const result = await handleGoogleCallback(getDb(), code, state);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/invite/redeem") {
        const body = await req.json();
        const result = await handleInviteRedeem(getDb(), body);
        return json(result.body, result.status);
      }

      // --- Owner routes ---
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

      // --- Document routes ---
      if (method === "GET" && pathname === "/documents") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleListDocuments(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/documents") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = await handleConnectDocument(getDb(), owner.householdId, owner.personId, body);
        return json(result.body, result.status);
      }

      const refreshDocParams = parsePathParams("/documents/:id/refresh", pathname);
      if (method === "POST" && refreshDocParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = await handleRefreshDocument(getDb(), owner.householdId, owner.personId, refreshDocParams.id);
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
  },
});

console.log(`Hearthstone backend running on http://localhost:${server.port}`);
