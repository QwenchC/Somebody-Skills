declare module 'pdf-parse' {
  interface PdfData {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function pdfParse(buf: Buffer): Promise<PdfData>;
  export default pdfParse;
}
