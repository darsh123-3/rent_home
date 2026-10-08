import { ApiError, authedFetch } from '@/api/client';

export interface BillPdf {
  url: string;
  blob: Blob;
  fileName: string;
}
/** The same bill as a JPEG picture (WhatsApp shows it inline in the chat). */
export type BillImage = BillPdf;

/** Downloads the invoice from the API (authenticated, with silent token refresh). */
export async function fetchBillPdf(billId: string, billNumber: string): Promise<BillPdf> {
  const res = await authedFetch(`/bills/${billId}/pdf`);
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'Bill not found' : 'The PDF could not be generated. Please check your internet connection and try again.');
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), blob, fileName: `Invoice-${billNumber}.pdf` };
}

/** Downloads the bill as a JPEG picture, rendered by the API from the same PDF. */
export async function fetchBillImage(billId: string, billNumber: string): Promise<BillImage> {
  const res = await authedFetch(`/bills/${billId}/image`);
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'Bill not found' : 'The bill image could not be generated. Please check your internet connection and try again.');
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), blob, fileName: `Bill-${billNumber}.jpg` };
}

/** Must be called directly from a tap: browsers (Safari especially) block new tabs opened after waiting on the network. */
export const viewPdf = (pdf: BillPdf) => void window.open(pdf.url, '_blank', 'noopener');

export function downloadPdf(pdf: BillPdf | BillImage) {
  const a = document.createElement('a');
  a.href = pdf.url;
  a.download = pdf.fileName;
  a.click();
}

/**
 * Native share sheet (WhatsApp, Gmail, Nearby Share...) where the browser supports sharing files: iPhone Safari, Android
 * Chrome, Windows Chrome/Edge. `text` goes along as the message. Otherwise the file is downloaded.
 */
export async function shareFile(file: BillPdf | BillImage, text?: string) {
  const type = file.fileName.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf';
  const shared = new File([file.blob], file.fileName, { type });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [shared] })) {
    await nav.share({ files: [shared], title: file.fileName, ...(text ? { text } : {}) });
    return 'shared' as const;
  }
  downloadPdf(file);
  return 'downloaded' as const;
}

