// GUS keys are alphanumeric, 12–40 chars. Reject prose / error messages.
const GUS_KEY_FORMAT = /^[A-Za-z0-9]{12,40}$/;

export function isValidGUSKeyFormat(value: string): boolean {
  return GUS_KEY_FORMAT.test(value);
}
