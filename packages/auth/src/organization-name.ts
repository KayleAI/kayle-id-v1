export const ORGANIZATION_NAME_MAX_LENGTH = 120;
export const ORGANIZATION_NAME_ERROR_MESSAGE =
  "Organization name must be between 1 and 120 characters and cannot contain control characters.";

export class OrganizationNameError extends Error {
  constructor(message = ORGANIZATION_NAME_ERROR_MESSAGE) {
    super(message);
    this.name = "OrganizationNameError";
  }
}

export function hasOrganizationNameControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }

  return false;
}

export function normalizeOrganizationName(value: unknown): string {
  if (typeof value !== "string") {
    throw new OrganizationNameError();
  }

  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > ORGANIZATION_NAME_MAX_LENGTH ||
    hasOrganizationNameControlCharacter(name)
  ) {
    throw new OrganizationNameError();
  }

  return name;
}
