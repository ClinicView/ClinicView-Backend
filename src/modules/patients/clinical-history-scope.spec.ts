import { applyClinicalHistoryScope } from './clinical-history-scope';
import { ClinicalHistoryExportResponseDto } from './dto/clinical-history-export-response.dto';

const fixture = () =>
  ({
    records: [
      {
        id: 'active',
        status: 'ACTIVE',
        attendedAt: new Date('2023-01-02T04:59:00Z'),
        episode: { id: 'episode' },
        source: { documentId: 'original' },
      },
      {
        id: 'old',
        status: 'CORRECTED',
        attendedAt: new Date('2023-01-01T05:00:00Z'),
        episode: { id: 'episode' },
      },
      { id: 'next', status: 'ACTIVE', attendedAt: new Date('2023-01-02T05:00:00Z') },
    ],
    documents: [
      { id: 'original', status: 'PENDING', clinicalMetadata: {}, clinicalText: null },
      {
        id: 'range',
        status: 'VALIDATED',
        clinicalMetadata: { clinicalDate: '2022-01-01', clinicalEndDate: '2023-01-01' },
      },
      { id: 'unknown', status: 'VALIDATED', clinicalMetadata: {} },
    ],
    episodes: [{ id: 'episode', title: 'Seguimiento', events: [{ action: 'CREATE' }] }],
    clinicalSummaryRevisions: [{ version: 1 }],
  }) as unknown as ClinicalHistoryExportResponseDto;

describe('Alcance íntegro de la exportación clínica', () => {
  it('sin filtros incluye todos los estados, fechas desconocidas y trazabilidad', () => {
    const original = fixture();
    const result = applyClinicalHistoryScope(original, {});
    expect(result.records).toEqual(original.records);
    expect(result.documents).toEqual(original.documents);
    expect(result.episodes).toEqual(original.episodes);
    expect(result.scope.kind).toBe('COMPLETE');
  });
  it('usa el día en Lima y conserva la fuente sin fecha sin incluir otros archivos indeterminados', () => {
    const original = fixture();
    const result = applyClinicalHistoryScope(original, {
      from: '2023-01-01',
      to: '2023-01-01',
      versions: 'CURRENT',
    });
    expect(result.records.map((row) => row.id)).toEqual(['active']);
    expect(result.documents.map((row) => row.id)).toEqual(['original', 'range']);
    expect(result.scope).toMatchObject({
      kind: 'FILTERED',
      includesSourceDocumentsOutsidePeriod: true,
    });
    expect(result.clinicalSummaryRevisions).toEqual(original.clinicalSummaryRevisions);
    expect(original.records).toHaveLength(3);
  });
  it('un episodio solo incorpora sus atenciones y originales citados, sin duplicar documentos', () => {
    const result = applyClinicalHistoryScope(fixture(), { episodeId: 'episode' });
    expect(result.records.map((row) => row.id)).toEqual(['active', 'old']);
    expect(result.documents.map((row) => row.id)).toEqual(['original']);
    expect(result.episodes[0].events).toHaveLength(1);
  });
  it('no reemplaza una selección vacía por toda la historia', () => {
    const result = applyClinicalHistoryScope(fixture(), { from: '2025-01-01' });
    expect(result.records).toHaveLength(0);
    expect(result.documents).toHaveLength(0);
    expect(result.scope.kind).toBe('FILTERED');
  });
  it('rechaza períodos invertidos y episodios ajenos o inexistentes', () => {
    expect(() =>
      applyClinicalHistoryScope(fixture(), { from: '2024-01-01', to: '2023-01-01' }),
    ).toThrow('invertido');
    expect(() => applyClinicalHistoryScope(fixture(), { episodeId: 'another' })).toThrow(
      'Episodio no encontrado',
    );
  });
});
