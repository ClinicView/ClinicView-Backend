import { BadRequestException, NotFoundException } from '@nestjs/common';
import { currentDateOnlyInClinicalTimeZone } from '../../common/validation/clinical-date';
import { ClinicalHistoryExportResponseDto } from './dto/clinical-history-export-response.dto';
import { HistoryExportQueryDto } from './dto/history-query.dto';

export function applyClinicalHistoryScope(
  history: ClinicalHistoryExportResponseDto,
  query: HistoryExportQueryDto,
): ClinicalHistoryExportResponseDto {
  if (query.from && query.to && query.from > query.to)
    throw new BadRequestException('El período está invertido.');
  const episode = query.episodeId
    ? history.episodes.find((item) => item.id === query.episodeId)
    : null;
  if (query.episodeId && !episode)
    throw new NotFoundException('Episodio no encontrado para este paciente.');
  const filtered = Boolean(
    query.from || query.to || query.episodeId || query.versions === 'CURRENT',
  );
  const inPeriod = (from?: string | null, to?: string | null) =>
    (!query.from && !query.to) ||
    Boolean(
      from &&
      (query.from ? (to || from) >= query.from : true) &&
      (query.to ? from <= query.to : true),
    );
  const records = history.records.filter(
    (record) =>
      (!query.episodeId || record.episode?.id === query.episodeId) &&
      (query.versions !== 'CURRENT' || record.status === 'ACTIVE') &&
      inPeriod(currentDateOnlyInClinicalTimeZone(record.attendedAt)),
  );
  const sourceIds = new Set(
    records.flatMap((record) => (record.source ? [record.source.documentId] : [])),
  );
  const documents = history.documents.filter(
    (document) =>
      sourceIds.has(document.id) ||
      (!query.episodeId &&
        (query.versions !== 'CURRENT' || document.status === 'VALIDATED') &&
        inPeriod(
          document.clinicalMetadata.clinicalDate,
          document.clinicalMetadata.clinicalEndDate,
        )),
  );
  const outside = documents.some(
    (document) =>
      sourceIds.has(document.id) &&
      !inPeriod(document.clinicalMetadata.clinicalDate, document.clinicalMetadata.clinicalEndDate),
  );
  const selectedEpisodeIds = new Set(
    records.flatMap((record) => (record.episode ? [record.episode.id] : [])),
  );
  return {
    ...history,
    records,
    documents,
    episodes: history.episodes.filter(
      (item) =>
        !filtered ||
        (query.episodeId ? item.id === query.episodeId : selectedEpisodeIds.has(item.id)),
    ),
    scope: {
      kind: filtered ? 'FILTERED' : 'COMPLETE',
      includesSourceDocumentsOutsidePeriod: outside,
      description: [
        filtered
          ? 'Exportación seleccionada; no representa toda la historia.'
          : 'Historia completa, independiente de las páginas cargadas.',
        query.from || query.to
          ? `Período clínico: ${query.from || 'sin inicio'} a ${query.to || 'sin fin'}.`
          : 'Sin restricción de fechas.',
        episode ? `Episodio: ${episode.title} (${episode.id}).` : 'Sin restricción de episodio.',
        query.versions === 'CURRENT'
          ? 'Solo atenciones vigentes y documentos validados, más originales citados.'
          : 'Incluye versiones corregidas/anuladas y estados documentales explícitos.',
        'Incluye contexto longitudinal y trazabilidad de los episodios seleccionados; esos antecedentes no se recortan por fecha.',
        outside
          ? 'Se incluyen originales citados fuera del período o sin fecha clínica para conservar la procedencia.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
  };
}
