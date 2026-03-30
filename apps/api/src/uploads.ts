import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { extname, join } from 'node:path';
import Busboy from 'busboy';
import { getMaxCvUploadBytes } from './config.js';

export interface ParsedMultipartUpload {
  fieldName: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface ParsedMultipartForm {
  uploads: ParsedMultipartUpload[];
  fields: Record<string, string[]>;
}

export interface ExtractedUploadText {
  rawText: string;
  warning: string | null;
}

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.docx', '.txt']);

function inferExtension(fileName: string): string {
  return extname(fileName).toLowerCase();
}

function looksLikePdf(fileName: string, mimeType: string): boolean {
  return mimeType === 'application/pdf' || inferExtension(fileName) === '.pdf';
}

function looksLikeDocx(fileName: string, mimeType: string): boolean {
  return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || inferExtension(fileName) === '.docx';
}

export async function readMultipartForm(request: IncomingMessage): Promise<ParsedMultipartForm> {
  return new Promise((resolve, reject) => {
    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Expected multipart/form-data request.'));
      return;
    }

    const uploads: ParsedMultipartUpload[] = [];
    const fields: Record<string, string[]> = {};
    const parser = Busboy({
      headers: request.headers as Record<string, string>,
      limits: {
        fileSize: getMaxCvUploadBytes(),
      },
    });

    parser.on('file', (fieldName, stream, info) => {
      const chunks: Buffer[] = [];
      let fileTooLarge = false;
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      stream.on('limit', () => {
        fileTooLarge = true;
      });
      stream.on('end', () => {
        if (fileTooLarge) {
          reject(new Error(`Upload ${info.filename || 'file'} exceeded the maximum allowed size.`));
          return;
        }
        uploads.push({
          fieldName,
          fileName: info.filename || 'upload',
          mimeType: info.mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
        });
      });
    });

    parser.on('field', (fieldName, value) => {
      fields[fieldName] = [...(fields[fieldName] ?? []), value];
    });

    parser.on('error', reject);
    parser.on('finish', () => resolve({ uploads, fields }));
    request.pipe(parser);
  });
}

export async function readMultipartUploads(request: IncomingMessage): Promise<ParsedMultipartUpload[]> {
  const parsed = await readMultipartForm(request);
  return parsed.uploads;
}

export async function extractTextFromUpload(upload: ParsedMultipartUpload): Promise<ExtractedUploadText> {
  try {
    if (looksLikePdf(upload.fileName, upload.mimeType)) {
      const pdfParse = (await import('pdf-parse')).default;
      const parsed = await pdfParse(upload.buffer);
      return {
        rawText: parsed.text?.trim() ?? '',
        warning: null,
      };
    }

    if (looksLikeDocx(upload.fileName, upload.mimeType)) {
      const mammoth = await import('mammoth');
      const parsed = await mammoth.extractRawText({ buffer: upload.buffer });
      return {
        rawText: parsed.value.trim(),
        warning: parsed.messages.length > 0 ? parsed.messages.map((message) => message.message).join(' ') : null,
      };
    }

    return {
      rawText: upload.buffer.toString('utf8').trim(),
      warning: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown extraction error.';
    return {
      rawText: '',
      warning: `Failed to extract text from ${upload.fileName}: ${message}`,
    };
  }
}

export function validateCvUploads(uploads: ParsedMultipartUpload[], maxUploadCount: number, maxUploadBytes: number): void {
  if (uploads.length === 0) {
    throw new Error('At least one CV upload is required.');
  }
  if (uploads.length > maxUploadCount) {
    throw new Error(`You can upload at most ${maxUploadCount} CV files at a time.`);
  }

  for (const upload of uploads) {
    const extension = inferExtension(upload.fileName);
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported CV file type for ${upload.fileName}. Supported formats are PDF, DOCX, and TXT.`);
    }
    if (upload.buffer.length === 0) {
      throw new Error(`Upload ${upload.fileName} was empty.`);
    }
    if (upload.buffer.length > maxUploadBytes) {
      throw new Error(`Upload ${upload.fileName} exceeded the maximum allowed size.`);
    }
  }
}

export async function persistUploadBinary(
  uploadsDirectory: string,
  userId: string,
  cvId: string,
  upload: ParsedMultipartUpload,
): Promise<string> {
  const extension = inferExtension(upload.fileName) || '.bin';
  const directory = join(uploadsDirectory, userId);
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, `${cvId}${extension}`);
  await writeFile(filePath, upload.buffer);
  return filePath;
}
