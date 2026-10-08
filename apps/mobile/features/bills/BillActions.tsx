import { Download, FileImage, FileText, Share2 } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { friendlyError } from '@/api/client';
import { Button, Sheet, Text } from '@/components/ui';
import { BillImage, BillPdf, fetchBillImage, fetchBillPdf, saveToDevice, shareBillFile, viewPdf } from './pdf';

type Action = 'view' | 'download' | 'share-pdf' | 'share-image';
const isWeb = Platform.OS === 'web';

/**
 * View PDF / Download / Share (as PDF or as a JPG picture). Files are always rendered fresh by the backend, so they
 * match the bill. In a browser the files are fetched ahead of time: Safari only allows share sheets and new tabs
 * directly inside a tap, not after a network wait.
 */
export function BillActions({ billId, billNumber, version, shareText, tenantName }: {
  billId: string;
  billNumber: string;
  /** changes when the bill changes (e.g. a payment), so a prefetched file is refreshed */
  version?: string;
  /** message sent along with the file where the share target supports it */
  shareText?: string;
  tenantName?: string;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  // Browser only. gcTime 0 so the blobs are not kept around after leaving the screen.
  const prefetch = useQuery({ queryKey: ['pdf-blob', billId, version], enabled: isWeb, queryFn: () => fetchBillPdf(billId, billNumber), staleTime: 0, gcTime: 0, retry: 1 });
  const imagePrefetch = useQuery({ queryKey: ['bill-image', billId, version], enabled: isWeb && choosing, queryFn: () => fetchBillImage(billId, billNumber), staleTime: 0, gcTime: 0, retry: 1 });
  const prepared: BillPdf | null = prefetch.data ?? null;
  const preparedImage: BillImage | null = imagePrefetch.data ?? null;
  const prepError = prefetch.error ? friendlyError(prefetch.error) : null;

  const run = (action: Action) => async () => {
    setMessage(null);
    if (isWeb && !prepared) return;
    if (isWeb && action === 'share-image' && !preparedImage) return;
    setBusy(action);
    try {
      if (action === 'share-image') {
        await shareBillFile(preparedImage ?? (await fetchBillImage(billId, billNumber)), tenantName ? `Send bill to ${tenantName}` : 'Share bill', shareText);
        setChoosing(false);
        return;
      }
      const pdf = prepared ?? (await fetchBillPdf(billId, billNumber));
      if (action === 'view') await viewPdf(pdf);
      else if (action === 'share-pdf') { await shareBillFile(pdf, tenantName ? `Send bill to ${tenantName}` : 'Share bill', shareText); setChoosing(false); }
      else if (await saveToDevice(pdf)) setMessage({ text: isWeb ? 'Invoice downloaded.' : 'Invoice saved to your device.', ok: true });
    } catch (e) {
      // Closing the share sheet is not an error.
      if (!(e instanceof Error && e.name === 'AbortError')) { setChoosing(false); setMessage({ text: friendlyError(e), ok: false }); }
    } finally {
      setBusy(null);
    }
  };

  const waiting = isWeb && !prepared && !prepError;
  const imageWaiting = isWeb && imagePrefetch.isFetching;
  return (
    <View className="gap-3">
      <Button label={waiting ? 'Preparing PDF...' : busy === 'view' ? 'Opening...' : 'View PDF'} icon={FileText} onPress={run('view')} loading={busy === 'view' || waiting} disabled={busy !== null || (isWeb && !prepared)} />
      <View className="flex-row gap-3">
        <View className="flex-1"><Button label="Download" icon={Download} variant="secondary" onPress={run('download')} loading={busy === 'download'} disabled={busy !== null || (isWeb && !prepared)} /></View>
        <View className="flex-1"><Button label="Share" icon={Share2} variant="secondary" onPress={() => { setMessage(null); setChoosing(true); }} disabled={busy !== null || (isWeb && !prepared)} /></View>
      </View>
      {message || prepError ? <Text variant="secondary" tone={message?.ok ? 'success' : 'danger'}>{message?.text ?? prepError}</Text> : null}

      <Sheet visible={choosing} title={tenantName ? `Share bill with ${tenantName}` : 'Share bill'} onClose={() => setChoosing(false)}>
        <View className="gap-3 pb-4">
          <Text variant="secondary" tone="soft">Choose the format, then pick WhatsApp (or email) and the tenant in the next step.</Text>
          <Button label="Share as PDF" icon={FileText} onPress={run('share-pdf')} loading={busy === 'share-pdf'} disabled={busy !== null} />
          <Button label={imageWaiting ? 'Preparing image...' : 'Share as image (JPG)'} icon={FileImage} variant="secondary" onPress={run('share-image')}
            loading={busy === 'share-image' || imageWaiting} disabled={busy !== null || (isWeb && !preparedImage)} />
          {imagePrefetch.error ? <Text variant="secondary" tone="danger">{friendlyError(imagePrefetch.error)}</Text> : null}
          <Text variant="caption" tone="muted">The image shows the bill right in the chat; the PDF is best for printing and records.</Text>
        </View>
      </Sheet>
    </View>
  );
}
