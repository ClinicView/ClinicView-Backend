import type { RequestContextState } from './request-context.service';
import { RequestContextService } from './request-context.service';

function state(requestId: string): RequestContextState {
  return {
    requestId,
    startedAt: Date.now(),
    ipHash: null,
    userAgentHash: null,
    method: 'GET',
    route: 'UNRESOLVED',
    auditPolicy: null,
    actorId: null,
    actorUsernameAtEvent: null,
    skipAudit: false,
  };
}

describe('RequestContextService', () => {
  it('mantiene aislado el contexto entre solicitudes concurrentes', async () => {
    const service = new RequestContextService();
    const firstId = '4b98f7dd-8cd8-4f51-876d-a972d98ec678';
    const secondId = '1b8f3540-1af3-42f9-90be-f13485e66bbd';

    const first = new Promise<string>((resolve) => {
      service.run(state(firstId), () => {
        setImmediate(() => resolve(service.get()?.requestId ?? 'missing'));
      });
    });
    const second = new Promise<string>((resolve) => {
      service.run(state(secondId), () => {
        setImmediate(() => resolve(service.get()?.requestId ?? 'missing'));
      });
    });

    await expect(Promise.all([first, second])).resolves.toEqual([firstId, secondId]);
    expect(service.get()).toBeUndefined();
  });

  it('actualiza actor y política solo dentro del contexto activo', () => {
    const service = new RequestContextService();
    const initial = state('4b98f7dd-8cd8-4f51-876d-a972d98ec678');

    service.setActor('ignored-outside-context');
    service.setAuditPolicy({ action: 'HTTP_GET' }, '/ignored', true);

    service.run(initial, () => {
      service.setActor('bf76ac74-5c2a-4dc7-a82e-e67c18b7f964', 'mlopez');
      service.setAuditPolicy(
        { action: 'PATIENT_VIEWED', resourceType: 'PATIENT' },
        '/patients/:id',
        true,
      );

      expect(service.get()).toEqual(
        expect.objectContaining({
          actorId: 'bf76ac74-5c2a-4dc7-a82e-e67c18b7f964',
          actorUsernameAtEvent: 'mlopez',
          auditPolicy: { action: 'PATIENT_VIEWED', resourceType: 'PATIENT' },
          route: '/patients/:id',
          skipAudit: true,
        }),
      );
    });

    expect(service.get()).toBeUndefined();
  });

  it('elimina el snapshot de username cuando el actor queda sin identificar', () => {
    const service = new RequestContextService();
    const initial = state('4b98f7dd-8cd8-4f51-876d-a972d98ec678');

    service.run(initial, () => {
      service.setActor('bf76ac74-5c2a-4dc7-a82e-e67c18b7f964', 'mlopez');
      service.setActor(null, 'username-que-no-debe-conservarse');
      expect(service.get()).toEqual(
        expect.objectContaining({ actorId: null, actorUsernameAtEvent: null }),
      );
    });
  });
});
