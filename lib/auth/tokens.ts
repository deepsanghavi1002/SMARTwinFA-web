/**
 * Random tokens for sessions and set-password links. Only a token's SHA-256 is stored, so a copy
 * of the database cannot be used to sign in or to open a link.
 */

export function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let text = "";
  for (const byte of raw) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function tokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A token as randomToken makes it: base64url, 20 to 100 characters. Anything else is refused before a lookup. */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(value);
}
