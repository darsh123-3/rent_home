import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useInvalidateCore } from '@/features/tenants/api';
import type { BillDetail, BillListItem, BillPreview, BillStatus, Paginated } from '@rental/shared';

export interface BillFilters { propertyId?: string; tenantId?: string; status?: BillStatus; month?: string; search?: string }

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

export function useBills(filters: BillFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['bills', 'list', filters],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<Paginated<BillListItem>>(`/bills?${qs({ ...filters, page: pageParam, pageSize: 20 })}`),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
}

export const useBill = (id?: string) => useQuery({ queryKey: ['bills', 'detail', id], enabled: !!id, queryFn: () => api.get<BillDetail>(`/bills/${id}`) });

export interface BillRequest {
  assignmentId?: string;
  tenantId?: string;
  billingPeriod?: string;
  dueDate?: string;
  electricity?: { currentReading?: number; previousReading?: number; overrideAmount?: number };
  charges?: { type: string; name?: string; amount: number; note?: string }[];
  lateFee?: number;
  discount?: number;
  notes?: string;
}

/** All amounts shown on the Generate Bill screen come from here: the server does the maths. */
export function useBillPreview(body: BillRequest | null) {
  return useQuery({
    queryKey: ['bills', 'preview', body],
    enabled: !!body,
    queryFn: () => api.post<BillPreview>('/bills/preview', body),
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
}

export function useCreateBill() {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: (body: BillRequest) => api.post<BillDetail>('/bills', body), onSuccess: invalidate });
}

export function useDeleteBill(id: string) {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: () => api.delete<null>(`/bills/${id}`), onSuccess: invalidate });
}

export function useCancelBill(id: string) {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: (reason?: string) => api.post<BillDetail>(`/bills/${id}/cancel`, { reason }), onSuccess: invalidate });
}