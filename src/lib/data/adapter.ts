import type { Row } from '@/config/types';

/** ---------------------------------------------------------------------------
 * The seam.
 *
 * Everything above this interface (pages, charts, tables, metrics) knows only
 * `DataAdapter`. Swapping Google Sheets for a Postgres-backed API later means
 * writing one new class here — no page, hook or component changes.
 * ------------------------------------------------------------------------- */

export interface FetchResult {
  rows: Row[];
  /** When the underlying source was last read, epoch ms. */
  fetchedAt: number;
  /** Column keys present in the source but absent from our config — surfaced in
   *  Settings so a new sheet column doesn't silently go unnoticed. */
  unmappedSourceColumns?: string[];
}

export interface DataAdapter {
  readonly kind: 'sheets' | 'demo';
  list(datasetId: string, signal?: AbortSignal): Promise<FetchResult>;
  create(datasetId: string, values: Row): Promise<Row>;
  update(datasetId: string, id: string, values: Row): Promise<Row>;
  remove(datasetId: string, id: string): Promise<void>;
}

export class DataError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'DataError';
  }
}
