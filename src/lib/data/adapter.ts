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
  /** Destination tab the rows came from (monthly datasets). */
  tab?: string;
  /** Months this dataset may be read from or written to. */
  tabs?: string[];
  /** When the underlying source was last read, epoch ms. */
  fetchedAt: number;
  /** Column keys present in the source but absent from our config — surfaced in
   *  Settings so a new sheet column doesn't silently go unnoticed. */
  unmappedSourceColumns?: string[];
}

/** Monthly datasets carry a destination tab; static ones ignore it. */
export interface DataOpts { tab?: string; signal?: AbortSignal }

export interface DataAdapter {
  readonly kind: 'sheets';
  list(datasetId: string, opts?: DataOpts): Promise<FetchResult>;
  create(datasetId: string, values: Row, opts?: DataOpts): Promise<Row>;
  update(datasetId: string, id: string, values: Row, opts?: DataOpts): Promise<Row>;
  remove(datasetId: string, id: string, opts?: DataOpts): Promise<void>;
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
