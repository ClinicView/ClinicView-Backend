import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { AuditPolicy } from '../../modules/audit/audit.decorator';

export interface RequestContextState {
  requestId: string;
  startedAt: number;
  ipHash: string | null;
  userAgentHash: string | null;
  method: string;
  route: string;
  auditPolicy: AuditPolicy | null;
  actorId: string | null;
  actorUsernameAtEvent: string | null;
  skipAudit: boolean;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextState>();

  run(state: RequestContextState, callback: () => void): void {
    this.storage.run(state, callback);
  }

  get(): RequestContextState | undefined {
    return this.storage.getStore();
  }

  setAuditPolicy(policy: AuditPolicy | null, route: string, skipAudit: boolean): void {
    const state = this.storage.getStore();
    if (!state) return;
    state.auditPolicy = policy;
    state.route = route;
    state.skipAudit = skipAudit;
  }

  setActor(actorId: string | null, actorUsernameAtEvent: string | null = null): void {
    const state = this.storage.getStore();
    if (!state) return;
    state.actorId = actorId;
    state.actorUsernameAtEvent = actorId ? actorUsernameAtEvent : null;
  }
}
