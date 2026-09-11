import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { AUDIT_POLICY_KEY } from '../audit/audit.decorator';
import { OcrLayoutController } from './ocr-layout.controller';

describe('OcrLayoutController authorization', () => {
  it('protects every route with JWT and permissions', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OcrLayoutController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });
  it.each(['getLayout', 'getPageImage', 'getRevision'] as const)(
    'requires read permission and audit on %s',
    (method) => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, OcrLayoutController.prototype[method])).toEqual([
        'documents.read',
      ]);
      expect(
        Reflect.getMetadata(AUDIT_POLICY_KEY, OcrLayoutController.prototype[method]),
      ).toMatchObject({ patientParam: 'patientId', resourceParam: 'id' });
    },
  );
  it('requires clinical review permission for a spatial save', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, OcrLayoutController.prototype.saveReview)).toEqual([
      'documents.validate',
    ]);
  });
});
