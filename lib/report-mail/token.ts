/** The mailer program's token and the one-time key of each job it takes. */

export const MIN_TOKEN_LENGTH = 32;

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares the hashes, every character, so the time taken says nothing about the token. */
export async function sameToken(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let difference = 0;
  for (let at = 0; at < a.length; at += 1) difference |= a.charCodeAt(at) ^ b.charCodeAt(at);
  return difference === 0;
}
