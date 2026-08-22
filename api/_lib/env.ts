/** Fails loudly at the first request rather than silently returning empty data. */
export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(`${name} is not set on this deployment.`);
  return v;
}

export const optional = (name: string, fallback = ''): string => process.env[name] ?? fallback;

export const list = (name: string): string[] =>
  optional(name).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export class ConfigError extends Error {
  readonly status = 500;
  constructor(message: string) { super(message); this.name = 'ConfigError'; }
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'HttpError'; }
}
