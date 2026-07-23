import type { Employee } from '@/types/api';

export function dicebearUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

export function randomSeed(): string {
  return crypto.randomUUID();
}

/**
 * The backend has no PUT to persist an edited avatar (see useAvatarOverrideStore),
 * so a client-side seed override takes priority over the stored pictureUrl.
 */
export function avatarSrc(employee: Pick<Employee, 'name' | 'pictureUrl'>, overrideSeed?: string): string {
  if (overrideSeed) return dicebearUrl(overrideSeed);
  if (employee.pictureUrl) return employee.pictureUrl;
  return dicebearUrl(employee.name);
}
