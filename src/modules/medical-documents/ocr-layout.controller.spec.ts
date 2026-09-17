import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { AUDIT_POLICY_KEY } from '../audit/audit.decorator';
import { OcrLayoutController } from './ocr-layout.controller';
import { OcrLayoutService } from './ocr-layout.service';
import type { Response } from 'express';

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
  it('requires both read and clinical review permissions for evaluation exports', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, OcrLayoutController.prototype.getEvaluationSnapshot),
    ).toEqual(['documents.read', 'documents.validate']);
    expect(
      Reflect.getMetadata(AUDIT_POLICY_KEY, OcrLayoutController.prototype.getEvaluationSnapshot),
    ).toMatchObject({
      action: 'DOCUMENT_OCR_EVALUATION_EXPORTED',
      patientParam: 'patientId',
      resourceParam: 'id',
    });
  });
  it('exports JSON with private download headers and the exact run/revision', async () => {
    const snapshot = { kind: 'clinicview-ocr-evaluation-snapshot' };
    const service = { getEvaluationSnapshot: jest.fn().mockResolvedValue(snapshot) };
    const controller = new OcrLayoutController(service as unknown as OcrLayoutService);
    const response = { set: jest.fn() };
    const runId = '11111111-1111-4111-8111-111111111111';
    await expect(
      controller.getEvaluationSnapshot(
        'patient',
        'document',
        2,
        runId,
        response as unknown as Response,
      ),
    ).resolves.toBe(snapshot);
    expect(service.getEvaluationSnapshot).toHaveBeenCalledWith('patient', 'document', runId, 2);
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      }),
    );
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="ocr-evaluation-${runId}-r2.json"`,
      }),
    );
  });
  it('sets no-store even when an evaluation export is rejected', async () => {
    const service = {
      getEvaluationSnapshot: jest.fn().mockRejectedValue(new Error('Unavailable')),
    };
    const controller = new OcrLayoutController(service as unknown as OcrLayoutService);
    const response = { set: jest.fn() };
    await expect(
      controller.getEvaluationSnapshot(
        'patient',
        'document',
        1,
        'run',
        response as unknown as Response,
      ),
    ).rejects.toThrow('Unavailable');
    expect(response.set).toHaveBeenCalledTimes(1);
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Cache-Control': 'private, no-store, max-age=0',
      }),
    );
  });
});
