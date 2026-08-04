import jwt from "jsonwebtoken";
import crypto from "crypto";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type AccessTokenPayload = { sub: string };

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

export function signRefreshToken(userId: string): string {
  // Including a random `jti` (JWT ID) guarantees this token's content is
  // never identical to another one for the same user — without it, two
  // tokens issued within the same second (same iat) would be byte-for-byte
  // identical, which broke the RefreshToken table's unique constraint on
  // tokenHash the moment login and refresh happened close together.
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, REFRESH_SECRET, {
    expiresIn: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  });
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as AccessTokenPayload;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}