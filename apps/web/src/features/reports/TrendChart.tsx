import { formatINR } from '@/utils/format';

interface Point { month: string; label: string; expected: number; collected: number }

/** Six-month billed vs collected bars. Plain divs: no chart library needed for one simple chart. */
export function TrendChart({ data, highlight }: { data: Point[]; highlight: string }) {
  const max = Math.max(1, ...data.flatMap((p) => [p.expected, p.collected]));
  const height = 120;
  const summary = data.map((p) => `${p.label}: billed ${formatINR(p.expected)}, collected ${formatINR(p.collected)}`).join('. ');
  return (
    <div role="img" aria-label={`Collection trend. ${summary}`}>
      <div className="flex items-end justify-between" style={{ height }}>
        {data.map((p) => (
          <div key={p.month} className="flex flex-1 items-end justify-center gap-1" style={{ height }}>
            <div className="w-3.5 rounded-t-sm bg-line-strong sm:w-5" style={{ height: Math.max(3, (p.expected / max) * height) }} />
            <div className={`w-3.5 rounded-t-sm sm:w-5 ${p.month === highlight ? 'bg-primary' : 'bg-primary/60'}`} style={{ height: Math.max(3, (p.collected / max) * height) }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        {data.map((p) => <span key={p.month} className={`flex-1 text-center text-caption ${p.month === highlight ? 'text-primary' : 'text-ink-muted'}`}>{p.label}</span>)}
      </div>
      <div className="mt-3 flex items-center justify-center gap-5 text-caption text-ink-soft">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-line-strong" />Bills for the month</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />Received in the month</span>
      </div>
    </div>
  );
}
