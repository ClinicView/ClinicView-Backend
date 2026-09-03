import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { PermissionsGuard } from '../../../core/rbac/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ClinicalRecordMediaController } from '../clinical-record-media.controller';
import { ClinicalRecordMediaService } from '../clinical-record-media.service';

const mockService = {
  upload: jest.fn(),
  getMetadata: jest.fn(),
  getContent: jest.fn(),
  deleteTemporary: jest.fn(),
};

describe('ClinicalRecordMediaController', () => {
  let controller: ClinicalRecordMediaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClinicalRecordMediaController],
      providers: [{ provide: ClinicalRecordMediaService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ClinicalRecordMediaController);
    jest.clearAllMocks();
  });

  it('resuelve metadata segura para restaurar referencias del borrador', async () => {
    const asset = {
      id: 'asset-uuid',
      contentUrl: '/patients/patient-uuid/record-media/asset-uuid/content',
    };
    mockService.getMetadata.mockResolvedValue(asset);

    await expect(controller.getMetadata('patient-uuid', 'asset-uuid', request)).resolves.toBe(
      asset,
    );
    expect(mockService.getMetadata).toHaveBeenCalledWith(
      'patient-uuid',
      'asset-uuid',
      'actor-uuid',
    );
  });

  const request = { user: { sub: 'actor-uuid' } };

  it('delega la carga con paciente, archivo y actor autenticado', async () => {
    const file = { buffer: Buffer.from('image') } as Express.Multer.File;
    const asset = { id: 'asset-uuid', patientId: 'patient-uuid' };
    mockService.upload.mockResolvedValue(asset);

    await expect(controller.upload('patient-uuid', file, request)).resolves.toBe(asset);
    expect(mockService.upload).toHaveBeenCalledWith('patient-uuid', file, 'actor-uuid');
  });

  it('entrega contenido privado con cabeceras antialmacenamiento y nombre seguro', async () => {
    const content = Buffer.from('safe');
    const filename = 'foto"\r\nSet-Cookie: bad\\ñ.png';
    mockService.getContent.mockResolvedValue({
      asset: { mimeType: 'image/png' },
      content,
      filename,
    });
    const set = jest.fn();
    const response = { set } as unknown as Response;

    const result = await controller.getContent('patient-uuid', 'asset-uuid', request, response);

    expect(mockService.getContent).toHaveBeenCalledWith('patient-uuid', 'asset-uuid', 'actor-uuid');
    expect(result).toBeInstanceOf(StreamableFile);

    const headers = set.mock.calls[0]?.[0] as Record<string, string>;
    expect(headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'image/png',
        'Content-Length': String(content.length),
        'Cache-Control': 'private, no-store',
        Pragma: 'no-cache',
        Expires: '0',
        'X-Content-Type-Options': 'nosniff',
      }),
    );
    expect(headers['Content-Disposition']).toContain(
      'inline; filename="foto_Set-Cookie: bad_n.png"',
    );
    expect(headers['Content-Disposition']).toContain("filename*=UTF-8''");
    expect(headers['Content-Disposition']).not.toMatch(/[\r\n]/);
  });

  it('delega el borrado CAS con expectedVersion y actor autenticado', async () => {
    mockService.deleteTemporary.mockResolvedValue(undefined);

    await controller.deleteTemporary('patient-uuid', 'asset-uuid', { expectedVersion: 7 }, request);

    expect(mockService.deleteTemporary).toHaveBeenCalledWith(
      'patient-uuid',
      'asset-uuid',
      7,
      'actor-uuid',
    );
  });
});
