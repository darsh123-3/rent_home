import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { ApiError, authedFetch } from '@/api/client';

const PDF_ERROR = 'The PDF could not be generated. Please check your internet connection and try again.';
const IMAGE_ERROR = 'The bill image could not be generated. Please check your internet connection and try again.';

export interface BillPdf {
  /** Browser only: the file bytes, kept so sharing can happen synchronously inside a tap. */
  blob?: Blob;
  /** Local file:// uri on devices; blob: url in the browser preview. */
  uri: string;
  fileName: string;
}
/** The same bill as a JPEG picture (WhatsApp shows it inline in the chat). */
export type BillImage = BillPdf;

const isImage = (file: BillPdf) => file.fileName.endsWith('.jpg');

/** Downloads the invoice from the backend (authenticated, auto-refreshing) into the app cache. */
export const fetchBillPdf = (billId: string, billNumber: string) => fetchBillFile(`/bills/${billId}/pdf`, `Invoice-${billNumber}.pdf`, PDF_ERROR);

/** Downloads the bill as a JPEG picture, rendered by the backend from the same PDF. */
export const fetchBillImage = (billId: string, billNumber: string): Promise<BillImage> => fetchBillFile(`/bills/${billId}/image`, `Bill-${billNumber}.jpg`, IMAGE_ERROR);

async function fetchBillFile(path: string, fileName: string, errorMessage: string): Promise<BillPdf> {
  const res = await authedFetch(path);
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'Bill not found' : errorMessage);

  if (Platform.OS === 'web') {
    const blob = await res.blob();
    return { uri: URL.createObjectURL(blob), blob, fileName };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return { uri: file.uri, fileName };
}

/** Opens the invoice in the phone's PDF viewer. */
export async function viewPdf(pdf: BillPdf) {
  if (Platform.OS === 'web') {
    window.open(pdf.uri, '_blank');
  } else if (Platform.OS === 'android') {
    const contentUri = await getContentUriAsync(pdf.uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: 'application/pdf' });
  } else {
    await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
}

/** Native share sheet for the PDF or the JPG picture: WhatsApp, Email, Telegram, Files, Nearby Share... whatever is installed. */
export async function shareBillFile(file: BillPdf | BillImage, dialogTitle = 'Share bill', text?: string) {
  const mimeType = isImage(file) ? 'image/jpeg' : 'application/pdf';
  if (Platform.OS === 'web') {
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    const shared = new globalThis.File([file.blob!], file.fileName, { type: mimeType });
    if (nav.canShare?.({ files: [shared] })) return nav.share({ files: [shared], title: file.fileName, ...(text ? { text } : {}) });
    await saveToDevice(file); // desktop browsers have no share sheet for files: download instead
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, UTI: isImage(file) ? 'public.jpeg' : 'com.adobe.pdf', dialogTitle });
}

/** Saves a copy where the user chooses (Downloads, Drive, ...). Returns false if they cancelled. */
export async function saveToDevice(file: BillPdf): Promise<boolean> {
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = file.uri;
    a.download = file.fileName;
    a.click();
    return true;
  }
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return false; // picker dismissed
  }
  const source = new File(file.uri);
  const target = dir.createFile(file.fileName.replace(/\.(pdf|jpg)$/i, ''), isImage(file) ? 'image/jpeg' : 'application/pdf');
  target.write(new Uint8Array(await source.bytes()));
  return true;
}
