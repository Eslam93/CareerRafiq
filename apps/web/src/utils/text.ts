import { WebApiError } from '../api-client.js';

export function csvToList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function listToCsv(values: readonly string[]): string {
  return values.join(', ');
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof WebApiError) {
    return error.requestId ? `${error.message} Request ID: ${error.requestId}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected error';
}
