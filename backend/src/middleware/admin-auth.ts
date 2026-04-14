import { verifyAdminToken } from "../services/admin-token";

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function requireAdmin(req: Request): boolean {
  const cookieTok = parseCookie(req.headers.get("cookie"), "hadm");
  if (cookieTok && verifyAdminToken(cookieTok)) return true;

  const authz = req.headers.get("authorization");
  if (authz?.startsWith("Bearer ")) {
    const bearer = authz.slice(7);
    if (verifyAdminToken(bearer)) return true;
  }
  return false;
}
