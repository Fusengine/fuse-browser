/**
 * Types for reading a PDF response on the HTTP fast-path.
 * @module interfaces/pdf
 */

/** Every {@link PdfError} code — single source for the type and the tool output schema. */
export const PDF_ERRORS = ["too_large", "unreadable", "timeout", "memory"] as const;

/** Why a PDF could not be turned into text. */
export type PdfError = (typeof PDF_ERRORS)[number];

/** Result of reading a PDF body. */
export interface PdfText {
  /** Page-marked text; "" when `error` is set. */
  text: string;
  /** Page count of the whole document (absent on error). */
  pageCount?: number;
  error?: PdfError;
}
