import { Role } from '@prisma/client';

/** Shape attached to request.user after JWT validation — not the full DB row. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}
