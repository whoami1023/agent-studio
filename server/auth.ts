import crypto from "node:crypto";
import type { PublicUser, UserRole } from "../shared/types.js";

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  passwordSalt: string;
  passwordHash: string;
  disabled: boolean;
  createdAt: string;
}

export interface StoredSession {
  token: string;
  userId: string;
  createdAt: string;
}

export const DEFAULT_ADMIN_USERNAME = "admin";
export const DEFAULT_ADMIN_PASSWORD = "admin123";
export const ADMIN_USER_ID = "user_admin";

const SCRYPT_KEYLEN = 64;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_LIMIT = 200;

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedHash, "hex");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function pruneSessions(sessions: StoredSession[]): StoredSession[] {
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;
  return sessions
    .filter((session) => Date.parse(session.createdAt) > cutoff)
    .slice(-(SESSION_LIMIT - 1));
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}
