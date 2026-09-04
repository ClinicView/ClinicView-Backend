import { ForbiddenException, Injectable } from '@nestjs/common';
import { GlobalSearchQueryDto } from './dto/global-search-query.dto';
import { GlobalSearchResponseDto } from './dto/global-search-response.dto';
import {
  GlobalDocumentSearchRow,
  GlobalSearchRepository,
} from './repositories/global-search.repository';

const PATIENTS_READ = 'patients.read';
const DOCUMENTS_READ = 'documents.read';
const SNIPPET_RADIUS = 70;

@Injectable()
export class GlobalSearchService {
  constructor(private readonly repository: GlobalSearchRepository) {}

  async search(query: GlobalSearchQueryDto, permissions: readonly string[]): Promise<GlobalSearchResponseDto> {
    const canReadPatients = permissions.includes(PATIENTS_READ);
    const canReadDocuments = permissions.includes(DOCUMENTS_READ);

    if (!canReadPatients && !canReadDocuments) {
      throw new ForbiddenException('Sin permisos para buscar pacientes o documentos.');
    }

    const limit = query.limit ?? 6;
    const fetchLimit = limit + 1;
    const [patientRows, documentRows] = await Promise.all([
      canReadPatients ? this.repository.searchPatients(query.q, fetchLimit) : Promise.resolve([]),
      canReadDocuments ? this.repository.searchDocuments(query.q, fetchLimit) : Promise.resolve([]),
    ]);

    return {
      query: query.q,
      patients: {
        data: patientRows.slice(0, limit),
        hasMore: patientRows.length > limit,
      },
      documents: {
        data: documentRows.slice(0, limit).map((document) => ({
          id: document.id,
          patientId: document.patientId,
          originalName: document.originalName,
          status: document.status,
          createdAt: document.createdAt,
          snippet: this.buildSnippet(document, query.q),
          patient: canReadPatients ? document.patient : null,
        })),
        hasMore: documentRows.length > limit,
      },
    };
  }

  private buildSnippet(document: GlobalDocumentSearchRow, query: string): string | null {
    const source = document.correctedText ?? document.ocrText;
    if (!source) return null;
    const normalizedSource = source.toLocaleLowerCase('es-PE');
    const matchIndex = normalizedSource.indexOf(query.toLocaleLowerCase('es-PE'));
    if (matchIndex < 0) return null;

    const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
    const end = Math.min(source.length, matchIndex + query.length + SNIPPET_RADIUS);
    const snippet = source.slice(start, end).replace(/\s+/g, ' ').trim();
    return `${start > 0 ? '…' : ''}${snippet}${end < source.length ? '…' : ''}`;
  }
}
