import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useInvalidateCore } from '@/features/tenants/api';
import type { BillDetail, OpenBill, Paginated, PaymentListItem, PaymentMethod } from '@rental/shared';

export interface PaymentFilters { propertyId?: string; tenantId?: string; method?: PaymentMethod; from?: string; to?: string; search?: string }
export type PaymentsPage = Paginated<PaymentListItem> & { summary: { totalAmount: number; count: number } };

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

export function usePayments(filters: PaymentFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['payments', 'list', filters],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<PaymentsPage>(`/payments?${qs({ ...filters, page: pageParam, pageSize: 20 })}`),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
}

export const useOpenBill = (tenantId?: string) =>
  useQuery({ queryKey: ['payments', 'open-bill', tenantId], enabled: !!tenantId, queryFn: () => api.get<OpenBill | null>(`/tenants/${tenantId}/open-bill`) });

export interface PaymentInput { amount: number; paymentDate: string; method: PaymentMethod; reference?: string; notes?: string }

export function useRecordPayment(billId: string) {
  const invalidate = useInvalidateCore();
  return useMutation({
    mutationFn: (body: PaymentInput) => api.post<{ bill: BillDetail }>(`/bills/${billId}/payments`, body),
    onSuccess: invalidate,
  });
}

/** Undoes a payment recorded by mistake (a reversal entry is added; nothing is deleted). */
export function useReversePayment() {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/payments/${id}/reverse`, { reason }), onSuccess: invalidate });
}
