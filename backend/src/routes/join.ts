import { renderJoinPage } from "../html/join-page";

export function handleJoinPage(pin: string, publicUrl: string): { status: number; body: string; contentType: string } {
  if (!/^\d{6}$/.test(pin)) {
    return { status: 404, body: "Not found", contentType: "text/plain" };
  }
  return { status: 200, body: renderJoinPage(pin, publicUrl), contentType: "text/html; charset=utf-8" };
}
