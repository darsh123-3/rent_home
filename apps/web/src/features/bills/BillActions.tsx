import { useQuery } from '@tanstack/react-query';
import { Download, FileImage, FileText, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { friendlyError } from '@/api/client';
import { Button, Modal, Notice } from '@/components/ui';
import { downloadPdf, fetchBillImage, fetchBillPdf, shareFile, viewPdf, type BillImage, type BillPdf } from './pdf';

/**
 * View PDF / Download / Share (as PDF or as a JPG picture). Files are rendered fresh by the backend and fetched ahead of
 * time, because browsers (Safari especially) only allow new tabs and share sheets directly inside a tap, not after a
 * network wait. The picture is fetched when the share choice opens, so it is ready by the time the owner taps it.
 */
export function BillActions({ billId, billNumber, version, shareText, tenantName }: {
  billId: string;
  billNumber: string;
  /** changes when the bill changes, so a prefetched file is refreshed */
  version?: string;
  /** message sent along with the file, e.g. "Rent bill for August 2026: ₹7,100 due by 10 Sep 2026" */
  shareText?: string;
  tenantName?: string;
}) {
  const [busy, setBusy] = useState<'pdf' | 'image' | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const prefetch = useQuery({ queryKey: ['pdf-blob', billId, version], queryFn: () => fetchBillPdf(billId, billNumber), staleTime: 0, gcTime: 0, retry: 1 });
  const image = useQuery({ queryKey: ['bill-image', billId, version], enabled: choosing, queryFn: () => fetchBillImage(billId, billNumber), staleTime: 0, gcTime: 0, retry: 1 });
  const pdf = prefetch.data ?? null;
  const jpg = image.data ?? null;
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);
  useEffect(() => () => { if (jpg) URL.revokeObjectURL(jpg.url); }, [jpg]);
  const prepError = prefetch.error ? friendlyError(prefetch.error) : null;
  const waiting = !pdf && !prepError;

  const view = () => { if (pdf) { setMessage(null); viewPdf(pdf); } };
  const download = () => { if (pdf) { downloadPdf(pdf); setMessage({ text: 'Invoice downloaded.', ok: true }); } };
  const share = async (kind: 'pdf' | 'image', file: BillPdf | BillImage | null) => {
    if (!file) return;
    setMessage(null); setBusy(kind);
    try {
      const result = await shareFile(file, shareText);
      setChoosing(false);
      if (result === 'downloaded') setMessage({ text: `Sharing is not available in this browser, so the ${kind === 'pdf' ? 'PDF' : 'picture'} was downloaded. Send it from WhatsApp or email.`, ok: true });
    } catch (e) {
      // Closing the share sheet is not an error.
      if (!(e instanceof Error && e.name === 'AbortError')) { setChoosing(false); setMessage({ text: friendlyError(e), ok: false }); }
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <Button icon={FileText} onClick={view} loading={waiting} disabled={!pdf}>{waiting ? 'Preparing PDF...' : 'View PDF'}</Button>
      <div className="flex gap-3">
        <Button variant="secondary" icon={Download} onClick={download} disabled={!pdf}>Download</Button>
        <Button variant="secondary" icon={Share2} onClick={() => { setMessage(null); setChoosing(true); }} disabled={!pdf}>Share</Button>
      </div>
      {message || prepError ? <Notice tone={message?.ok ? 'success' : 'danger'}>{message?.text ?? prepError}</Notice> : null}

      <Modal open={choosing} title={tenantName ? `Share bill with ${tenantName}` : 'Share bill'} onClose={() => setChoosing(false)}>
        <div className="space-y-3 pb-2">
          <p className="text-small text-ink-soft">Choose the format, then pick WhatsApp (or email) and the tenant in the next step.</p>
          <Button icon={FileText} onClick={() => void share('pdf', pdf)} loading={busy === 'pdf'} disabled={!pdf || busy !== null}>Share as PDF</Button>
          <Button variant="secondary" icon={FileImage} onClick={() => void share('image', jpg)} loading={busy === 'image' || image.isFetching} disabled={!jpg || busy !== null}>
            {image.isFetching ? 'Preparing image...' : 'Share as image (JPG)'}
          </Button>
          {image.error ? <Notice tone="danger">{friendlyError(image.error)}</Notice> : null}
          <p className="text-caption text-ink-muted">The image shows the bill right in the chat; the PDF is best for printing and records.</p>
        </div>
      </Modal>
    </div>
  );
}
