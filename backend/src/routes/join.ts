import { renderJoinPage } from "../html/join-page";
import { normalizePin, PIN_REGEX } from "../services/pins";

export function handleJoinPage(
  rawPin: string,
  publicUrl: string
): { status: number; body: string; contentType: string } {
  const pin = normalizePin(rawPin);
  if (!PIN_REGEX.test(pin)) {
    return { status: 404, body: "Not found", contentType: "text/plain" };
  }
  return { status: 200, body: renderJoinPage(pin, publicUrl), contentType: "text/html; charset=utf-8" };
}
