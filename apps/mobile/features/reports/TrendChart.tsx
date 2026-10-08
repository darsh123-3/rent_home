import { View } from 'react-native';
import { Text } from '@/components/ui';
import { formatINR } from '@/utils/format';

interface Point { month: string; label: string; expected: number; collected: number }

/** Six-month billed vs collected bars. Plain Views: no chart library needed for one simple chart. */
export function TrendChart({ data, highlight }: { data: Point[]; highlight: string }) {
  const max = Math.max(1, ...data.flatMap((p) => [p.expected, p.collected]));
  const height = 120;
  const summary = data.map((p) => `${p.label}: billed ${formatINR(p.expected)}, collected ${formatINR(p.collected)}`).join('. ');
  return (
    <View accessible accessibilityLabel={`Collection trend. ${summary}`}>
      <View className="flex-row items-end justify-between" style={{ height }}>
        {data.map((p) => (
          <View key={p.month} className="flex-1 flex-row items-end justify-center gap-1" style={{ height }}>
            <View className="w-3.5 rounded-t-sm bg-line-strong" style={{ height: Math.max(3, (p.expected / max) * height) }} />
            <View className={`w-3.5 rounded-t-sm ${p.month === highlight ? 'bg-primary' : 'bg-primary/60'}`} style={{ height: Math.max(3, (p.collected / max) * height) }} />
          </View>
        ))}
      </View>
      <View className="mt-2 flex-row justify-between">
        {data.map((p) => <Text key={p.month} variant="caption" tone={p.month === highlight ? 'primary' : 'muted'} className="flex-1 text-center">{p.label}</Text>)}
      </View>
      <View className="mt-3 flex-row items-center justify-center gap-5">
        <View className="flex-row items-center gap-1.5"><View className="h-2.5 w-2.5 rounded-sm bg-line-strong" /><Text variant="caption" tone="soft">Bills for the month</Text></View>
        <View className="flex-row items-center gap-1.5"><View className="h-2.5 w-2.5 rounded-sm bg-primary" /><Text variant="caption" tone="soft">Received in the month</Text></View>
      </View>
    </View>
  );
}
