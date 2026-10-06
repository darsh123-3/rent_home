/** Charge lines of a bill per category (Water, Housekeeping, MNGL gas, WiFi); every other charge counts as OTHER. */
export function chargesByCategory(items: { type: string; amount: { toNumber(): number } | number; meta: unknown }[]) {
  const out = { WATER: 0, CLEANING: 0, MNGL_GAS: 0, INTERNET: 0, OTHER: 0 };
  for (const i of items) {
    if (i.type !== 'CHARGE') continue;
    const t = (i.meta as { chargeType?: string } | null)?.chargeType;
    const key = t === 'WATER' || t === 'CLEANING' || t === 'MNGL_GAS' || t === 'INTERNET' ? t : 'OTHER';
    out[key] = Math.round((out[key] + (typeof i.amount === 'number' ? i.amount : i.amount.toNumber())) * 100) / 100;
  }
  return out;
}
