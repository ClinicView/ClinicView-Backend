import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from './audit-action';

export const AUDIT_POLICY_KEY = 'clinicview.audit.policy';
export const SKIP_AUDIT_KEY = 'clinicview.audit.skip';

export interface AuditPolicyOptions {
  resourceType?: string;
  patientParam?: string;
  resourceParam?: string;
  resourceFromResponseId?: boolean;
}

export interface AuditPolicy extends AuditPolicyOptions {
  action: AuditAction | `HTTP_${string}`;
}

export const Audited = (action: AuditAction, options: AuditPolicyOptions = {}) =>
  SetMetadata(AUDIT_POLICY_KEY, { action, ...options } satisfies AuditPolicy);

export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
