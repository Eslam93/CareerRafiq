declare module 'pdf-parse' {
  export interface PdfParseResult {
    text: string;
  }

  export interface PdfParse {
    (buffer: Buffer): Promise<PdfParseResult>;
  }

  const pdfParse: PdfParse;
  export default pdfParse;
}
