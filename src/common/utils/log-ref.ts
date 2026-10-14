/**
 * The subset of a User row the audit logger needs to build a human-readable
 * reference. `employeeId` is an `EMP-###`-style code; it defaults to an empty
 * string on User, so an unset code falls through to the email.
 */
export interface UserRefLike {
  id: string;
  email?: string | null;
  employeeId?: string | null;
}

/**
 * Builds the audit-log reference for a user: the employee code (EMP-001) when
 * present, otherwise the email, otherwise the raw id as a last resort.
 *
 * `record()` folds this into `newDetail.target` (the referenceId COLUMN itself
 * holds the generated TCK-#### ticket code), so it is the human-facing pointer
 * to "which user this log is about".
 */
export function logRefOf(user: UserRefLike | null | undefined): string {
  if (!user) return 'unknown';
  return user.employeeId || user.email || user.id;
}
