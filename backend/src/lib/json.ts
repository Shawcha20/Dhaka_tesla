/**
 * Every id and every money column in this schema is BIGINT, which Prisma returns
 * as a JavaScript `bigint`. `JSON.stringify` throws on bigint rather than
 * guessing, so without a replacer every response containing a fare would 500.
 *
 * Converting to a JSON number is safe *here* because of what these values are:
 * ids are row counts and money is paisa, both many orders of magnitude below
 * 2^53. The guard makes that assumption explicit rather than implicit — if a
 * value ever did exceed the safe range, silently rounding it would be a
 * catastrophic way to find out.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value > MAX_SAFE || value < MIN_SAFE) {
      throw new Error(
        `Cannot serialise BigInt ${value} without losing precision — it exceeds Number.MAX_SAFE_INTEGER`,
      );
    }
    return Number(value);
  }
  return value;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
