import { Prisma } from '@prisma/client';

/**
 * Payments that still stand: not a reversal row, and not reversed. A reversed payment and its reversal cancel out,
 * so totals, counts and lists leave both out. (Summing every row gives the same totals; counts would not.)
 */
export const STANDING_PAYMENT_WHERE: Prisma.PaymentWhereInput = { reversalOfId: null, reversedBy: { is: null } };
