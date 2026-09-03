import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../../core/rbac/permissions.guard';
import { PERMISSIONS_KEY } from '../../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AUDIT_ACTIONS } from '../audit-action';
import { AuditController } from '../audit.controller';
import { AUDIT_POLICY_KEY } from '../audit.decorator';
import { AuditService } from '../audit.service';

describe('AuditController', () => {
  let controller: AuditController;
  let auditService: { findMany: jest.Mock };

  beforeEach(async () => {
    auditService = {
      findMany: jest.fn().mockResolvedValue({ data: [], nextCursor: null }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: auditService }],
    }).compile();

    controller = module.get(AuditController);
  });

  it('delega filtros y paginación en AuditService', async () => {
    const query = { action: 'PATIENT_VIEWED', limit: 25 };

    await expect(controller.findMany(query)).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    expect(auditService.findMany).toHaveBeenCalledWith(query);
  });

  it('exige autenticación, PermissionsGuard y admin.audit.read', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AuditController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AuditController.prototype.findMany)).toEqual([
      'admin.audit.read',
    ]);
  });

  it('declara la lectura de auditoría con metadatos de recurso explícitos', () => {
    expect(Reflect.getMetadata(AUDIT_POLICY_KEY, AuditController.prototype.findMany)).toEqual({
      action: AUDIT_ACTIONS.AUDIT_EVENTS_VIEWED,
      resourceType: 'AUDIT_EVENT',
    });
  });

  it('expone exclusivamente GET /audit/events y ninguna mutación', () => {
    const handlers = Object.getOwnPropertyNames(AuditController.prototype).filter(
      (property) =>
        property !== 'constructor' &&
        typeof AuditController.prototype[property as keyof AuditController] === 'function',
    );

    expect(Reflect.getMetadata(PATH_METADATA, AuditController)).toBe('audit');
    expect(handlers).toEqual(['findMany']);
    expect(Reflect.getMetadata(METHOD_METADATA, AuditController.prototype.findMany)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, AuditController.prototype.findMany)).toBe('events');
  });
});
