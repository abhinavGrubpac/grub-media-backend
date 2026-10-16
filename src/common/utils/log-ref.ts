/**
 * The subset of a User row the audit logger needs to build a human-readable
 * reference. `employeeId` is an `EMP-###`-style code; it defaults to an empty
 * string on User, so an unset code falls through to the email.
 */
import type { PrismaService } from '../../database/prisma.service';

export interface UserRefLike {
  id: string;
  email?: string | null;
  employeeId?: string | null;
}

/**
 * Builds the audit-log reference for a user: the employee code (EMP-001) when
 * present, otherwise the email, otherwise the raw id as a last resort.
 *
 * `record()` folds this into `newDetail.target`, so it is the human-facing
 * pointer to "which user this log is about" living on the row itself.
 */
export function logRefOf(user: UserRefLike | null | undefined): string {
  if (!user) return 'unknown';
  return user.employeeId || user.email || user.id;
}

/**
 * Resolves a raw user id to the same human-readable reference (EMP-001 or
 * email) for use inside `actionText` prose — audit sentences should read like
 * English ("created by EMP-001"), never "created by clx1q2w3e4r5t".
 *
 * Best-effort by design: an unknown id falls back to the raw id, no id reads
 * as 'the system', and a lookup failure never blocks the audit write.
 */
export async function describeActor(prisma: PrismaService, id?: string | null): Promise<string> {
  if (!id) return 'the system';
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, employeeId: true },
    });
    return user ? logRefOf(user) : id;
  } catch {
    return id;
  }
}
