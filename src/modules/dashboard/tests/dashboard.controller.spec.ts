import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../../core/rbac/permissions.guard';
import { PERMISSIONS_KEY } from '../../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DashboardController } from '../dashboard.controller';
import { DashboardService, DashboardStats } from '../dashboard.service';

const mockStats: DashboardStats = {
  patientsToday: 1,
  patientsTodayDeltaPct: 100,
  documentsInQueue: 2,
  readyToValidate: 3,
  readyToValidateDeltaPct: 50,
  ocrErrors: 0,
  ocrErrorsDeltaPct: null,
  recentActivity: [],
};

const mockDashboardService = {
  getStats: jest.fn<Promise<DashboardStats>, []>(),
};

function createContext(permissions?: string[]): ExecutionContext {
  return {
    getClass: () => DashboardController,
    getHandler: () => DashboardController.prototype.getStats,
    switchToHttp: () => ({
      getRequest: () => ({
        user:
          permissions === undefined
            ? undefined
            : { sub: 'user-uuid-001', email: 'user@example.invalid', permissions },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('DashboardController', () => {
  let controller: DashboardController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDashboardService.getStats.mockResolvedValue(mockStats);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: mockDashboardService }],
    }).compile();

    controller = module.get(DashboardController);
  });

  it('delega la obtención de indicadores en DashboardService', async () => {
    await expect(controller.getStats()).resolves.toEqual(mockStats);
    expect(mockDashboardService.getStats).toHaveBeenCalledTimes(1);
  });

  it('exige permisos de pacientes y documentos para evitar una respuesta parcial con PHI', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      DashboardController.prototype.getStats,
    );

    expect(permissions).toEqual(['patients.read', 'documents.read']);
  });

  it('aplica autenticación y autorización al controlador', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DashboardController) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
  });
});

describe('Dashboard permissions policy', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('permite el acceso únicamente cuando están presentes ambos permisos', () => {
    expect(guard.canActivate(createContext(['patients.read', 'documents.read']))).toBe(true);
  });

  it.each([[['patients.read']], [['documents.read']], [[]]])(
    'rechaza de forma fail-closed un conjunto incompleto: %j',
    (permissions) => {
      expect(() => guard.canActivate(createContext(permissions))).toThrow(ForbiddenException);
    },
  );

  it('rechaza de forma fail-closed una solicitud sin identidad autorizada', () => {
    expect(() => guard.canActivate(createContext())).toThrow(ForbiddenException);
  });
});
