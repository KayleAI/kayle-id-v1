export const DEFAULT_RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const BYTE_VALUES = 256;

export function generateRandomString(
  length: number,
  alphabet = DEFAULT_RANDOM_ALPHABET
): string {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error("random_length_invalid");
  }

  if (alphabet.length < 2 || alphabet.length > BYTE_VALUES) {
    throw new Error("random_alphabet_invalid");
  }

  const alphabetLength = alphabet.length;
  const maxUnbiasedByte =
    Math.floor(BYTE_VALUES / alphabetLength) * alphabetLength;
  const bytes = new Uint8Array(Math.max(length, 1));
  let result = "";

  while (result.length < length) {
    crypto.getRandomValues(bytes);

    for (const value of bytes) {
      if (value >= maxUnbiasedByte) {
        continue;
      }

      result += alphabet[value % alphabetLength];

      if (result.length === length) {
        break;
      }
    }
  }

  return result;
}
