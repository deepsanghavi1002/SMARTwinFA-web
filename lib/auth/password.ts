/**
 * Password hashing for web sign-in, on Web Crypto so it runs the same in the worker, in Node
 * (the invite command and the tests) and in the browser-free build.
 *
 * PBKDF2-SHA256 at 100 000 iterations: the Workers runtime refuses more, and the format carries
 * the algorithm and count so a stronger setting can be introduced later and old hashes upgraded
 * at the next sign-in. The legacy desktop's user_pw is never read or written here.
 */

const ALGORITHM = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

/** Compares without stopping at the first difference, so the time taken does not tell how much matched. */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** Returns "pbkdf2-sha256$<iterations>$<salt>$<hash>", base64 parts. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${ALGORITHM}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** False for a wrong password and for a stored value it cannot read; it never throws on bad input. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  try {
    const expected = fromBase64(parts[3]);
    return constantTimeEqual(await derive(password, fromBase64(parts[2]), iterations), expected);
  } catch {
    return false;
  }
}

/** Why a new password is refused, or null when it is acceptable. */
export function passwordProblem(password: string, login: string): string | null {
  if (password.length < PASSWORD_MIN) return `The password must have at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `The password must have at most ${PASSWORD_MAX} characters`;
  if (new Set(password).size < 4) return "The password repeats too few different characters";
  if (login && password.trim().toLowerCase() === login.trim().toLowerCase()) return "The password must not be the user name";
  return null;
}
