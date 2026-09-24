import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * Argon2id. The library exports `Algorithm` as an ambient const enum, which
 * cannot be read under `verbatimModuleSyntax`, so the member's numeric value is
 * named here instead of imported. Asserting the enum type keeps it checked
 * rather than passing a bare number.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * Parameters follow the OWASP Password Storage Cheat Sheet: 19 MiB of memory,
 * 2 iterations, 1 degree of parallelism. They happen to match the library's own
 * defaults, and are stated explicitly anyway — a security parameter that is
 * correct only because of someone else's default is one dependency bump away
 * from being wrong.
 *
 * argon2id rather than bcrypt because it is memory-hard as well as CPU-hard, so
 * a GPU or ASIC attacker gains far less. The parameters are embedded in the
 * resulting hash string, which is why the column is VARCHAR(255): raising the
 * cost later needs no migration, and existing hashes stay verifiable.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed or unparseable hash, so a
 * corrupted row reads as "wrong password" instead of producing a 500 that tells
 * an attacker the account exists.
 */
export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    return false;
  }
}
