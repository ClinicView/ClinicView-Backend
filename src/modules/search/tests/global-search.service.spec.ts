import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentStatus } from '@prisma/client';
import { GlobalSearchService } from '../global-search.service';
import { GlobalSearchRepository } from '../repositories/global-search.repository';

const repository = {
  searchPatients: jest.fn(),
  searchDocuments: jest.fn(),
};

describe('GlobalSearchService', () => {
  let service: GlobalSearchService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GlobalSearchService,
        { provide: GlobalSearchRepository, useValue: repository },
      ],
    }).compile();
    service = module.get(GlobalSearchService);
    jest.clearAllMocks();
  });

  it('falla cerrado si la sesion no puede leer ninguna categoria', async () => {
    await expect(service.search({ q: 'lopez', limit: 6 }, [])).rejects.toThrow(
      ForbiddenException,
    );
    expect(repository.searchPatients).not.toHaveBeenCalled();
    expect(repository.searchDocuments).not.toHaveBeenCalled();
  });

  it('consulta y devuelve unicamente categorias autorizadas', async () => {
    repository.searchPatients.mockResolvedValue([
      {
        id: 'patient-1',
        firstName: 'Maria',
        lastName: 'Lopez',
        documentType: 'DNI',
        documentNumber: '12345678',
      },
    ]);

    const result = await service.search(
      { q: 'lopez', limit: 6 },
      ['patients.read'],
    );

    expect(repository.searchPatients).toHaveBeenCalledWith('lopez', 7);
    expect(repository.searchDocuments).not.toHaveBeenCalled();
    expect(result.patients.data).toHaveLength(1);
    expect(result.documents.data).toEqual([]);
  });

  it('oculta la identidad del paciente si solo puede leer documentos', async () => {
    repository.searchDocuments.mockResolvedValue([
      {
        id: 'document-1',
        patientId: 'patient-1',
        originalName: 'consulta.pdf',
        status: DocumentStatus.PROCESSED,
        createdAt: new Date('2026-09-01T12:00:00Z'),
        correctedText: 'Control de hipertension arterial sin incidencias.',
        ocrText: null,
        patient: { id: 'patient-1', firstName: 'Maria', lastName: 'Lopez' },
      },
    ]);

    const result = await service.search(
      { q: 'hipertension', limit: 6 },
      ['documents.read'],
    );

    expect(result.documents.data[0].patient).toBeNull();
    expect(result.documents.data[0].snippet).toContain('hipertension');
  });

  it('limita cada categoria e informa si existen mas resultados', async () => {
    repository.searchPatients.mockResolvedValue(
      Array.from({ length: 3 }, (_, index) => ({
        id: `patient-${index}`,
        firstName: 'Maria',
        lastName: `Lopez ${index}`,
        documentType: 'DNI',
        documentNumber: `1234567${index}`,
      })),
    );
    repository.searchDocuments.mockResolvedValue([]);

    const result = await service.search(
      { q: 'lopez', limit: 2 },
      ['patients.read', 'documents.read'],
    );

    expect(result.patients.data).toHaveLength(2);
    expect(result.patients.hasMore).toBe(true);
  });
});
