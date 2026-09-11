import { BadRequestException } from '@nestjs/common';
import { MachineOcrLayout, OCR_IDENTIFIER, validBox } from '../../core/ia/ocr-layout';
import { OcrReviewLineDto } from './dto/ocr-layout-review.dto';

/** Complete replacement, never an implicit deletion of an unreviewed source line. */
export function validateOcrReviewLines(layout: MachineOcrLayout, input: OcrReviewLineDto[]) {
  if (!Array.isArray(input) || input.length > 20000) {
    throw new BadRequestException('La revisión excede el límite de líneas.');
  }
  const pages = new Map(layout.pages.map((page) => [page.page, page]));
  const sources = new Map(
    layout.pages.flatMap((page) => page.lines.map((line) => [line.lineId, page.page] as const)),
  );
  const retained = new Set<string>();
  const ids = new Set<string>();
  const orders = new Set<string>();
  const lines = input
    .map((line) => {
      const page = pages.get(line.page);
      if (!page || !validBox(line.bbox, page.width, page.height)) {
        throw new BadRequestException(
          'El recorte debe estar dentro de su página y tener área positiva.',
        );
      }
      if (
        typeof line.lineId !== 'string' ||
        !OCR_IDENTIFIER.test(line.lineId) ||
        ids.has(line.lineId)
      ) {
        throw new BadRequestException('Cada línea revisada debe tener un identificador único.');
      }
      const orderKey = `${line.page}:${line.order}`;
      if (!Number.isInteger(line.order) || line.order < 1 || orders.has(orderKey)) {
        throw new BadRequestException('El orden debe ser único y positivo dentro de cada página.');
      }
      if (
        typeof line.text !== 'string' ||
        line.text.length > 4000 ||
        typeof line.reviewed !== 'boolean' ||
        !Array.isArray(line.sourceLineIds) ||
        line.sourceLineIds.length > 500 ||
        new Set(line.sourceLineIds).size !== line.sourceLineIds.length
      ) {
        throw new BadRequestException('La línea revisada no es válida.');
      }
      const reason = line.reason?.trim() || undefined;
      if (reason && reason.length > 500)
        throw new BadRequestException('El motivo es demasiado largo.');
      if (!line.sourceLineIds.length && (!reason || reason.length < 10)) {
        throw new BadRequestException(
          'Una región manual necesita un motivo de al menos 10 caracteres.',
        );
      }
      for (const sourceId of line.sourceLineIds) {
        if (sources.get(sourceId) !== line.page) {
          throw new BadRequestException(
            'La procedencia debe referenciar líneas originales de la misma página.',
          );
        }
        retained.add(sourceId);
      }
      // An original ID always retains its own origin, preventing misleading ID reuse.
      if (sources.has(line.lineId) && !line.sourceLineIds.includes(line.lineId)) {
        throw new BadRequestException(
          'No se puede reutilizar un identificador original para otra procedencia.',
        );
      }
      ids.add(line.lineId);
      orders.add(orderKey);
      return {
        lineId: line.lineId,
        page: line.page,
        bbox: [...line.bbox],
        order: line.order,
        text: line.text,
        reviewed: line.reviewed,
        sourceLineIds: [...line.sourceLineIds],
        ...(reason ? { reason } : {}),
      };
    })
    .sort((a, b) => a.page - b.page || a.order - b.order);
  if (retained.size !== sources.size) {
    throw new BadRequestException(
      'Faltan líneas originales. Consérvalas o inclúyelas explícitamente en una unión/división.',
    );
  }
  const correctedText = lines
    .map((line) => line.text)
    .join('\n')
    .trim();
  if (correctedText.length > 50000) {
    throw new BadRequestException('El texto revisado completo supera los 50000 caracteres.');
  }
  return { lines, correctedText };
}
