import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Paginated, PaymentMethod, SecurityDepositSummary, TenantDetail, TenantElectricity, TenantListItem, TenantStatus } from '@rental/shared';

export interface TenantFilters { propertyId?: string; status?: TenantStatus; search?: string; dues?: 'true' }

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

export function useTenants(filters: TenantFilters) {
  return useInfiniteQuery({
    queryKey: ['tenants', 'list', filters],
    enabled: !!filters.propertyId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<Paginated<TenantListItem>>(`/tenants?${qs({ ...filters, page: pageParam, pageSize: 20 })}`),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
}

export const useTenant = (id?: string) => useQuery({ queryKey: ['tenants', 'detail', id], enabled: !!id, queryFn: () => api.get<TenantDetail>(`/tenants/${id}`) });

/** Anything that changes tenants, rooms or balances refreshes all of them. */
export function useInvalidateCore() {
  const qc = useQueryClient();
  return () => Promise.all(['tenants', 'rooms', 'properties', 'dashboard', 'bills', 'payments', 'reports'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useCreateTenant() {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: (body: Record<string, unknown>) => api.post<TenantDetail>('/tenants', body), onSuccess: invalidate });
}

export function useUpdateTenant(id: string) {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: (body: Record<string, unknown>) => api.put<TenantDetail>(`/tenants/${id}`, body), onSuccess: invalidate });
}

export function useDeleteTenant(id: string) {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: () => api.delete<null>(`/tenants/${id}`), onSuccess: invalidate });
}

export function useAssignRoom() {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: (body: Record<string, unknown>) => api.post('/room-assignments', body), onSuccess: invalidate });
}

export function useMoveOut(assignmentId: string) {
  const invalidate = useInvalidateCore();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ finalBalance: number }>(`/room-assignments/${assignmentId}/move-out`, body),
    onSuccess: invalidate,
  });
}

export function useChangeRent(assignmentId: string) {
  const invalidate = useInvalidateCore();
  return useMutation({
    mutationFn: (body: { amount: number; effectiveFrom: string }) => api.post(`/room-assignments/${assignmentId}/rent`, body),
    onSuccess: invalidate,
  });
}

export interface ElectricityTerms { electricityMode?: 'METER' | 'FIXED' | 'NONE'; ratePerUnit?: number; fixedElectricity?: number; applyToRoom?: boolean }
export function useChangeElectricity(assignmentId: string) {
  const invalidate = useInvalidateCore();
  return useMutation({
    mutationFn: (body: ElectricityTerms) => api.post(`/room-assignments/${assignmentId}/electricity`, body),
    onSuccess: invalidate,
  });
}

export const useTenantElectricity = (tenantId?: string) =>
  useQuery({ queryKey: ['tenants', 'electricity', tenantId], enabled: !!tenantId, queryFn: () => api.get<TenantElectricity>(`/tenants/${tenantId}/electricity`) });
export interface DepositInput { amount: number; receivedOn: string; method: PaymentMethod; note?: string }
/** Security deposit received for a stay, in instalments. Never part of a bill. */
export function useAddDeposit(assignmentId: string) {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: (body: DepositInput) => api.post<SecurityDepositSummary>(`/room-assignments/${assignmentId}/deposits`, body), onSuccess: invalidate });
}
export function useDeleteDeposit(assignmentId: string) {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: (receiptId: string) => api.delete<SecurityDepositSummary>(`/room-assignments/${assignmentId}/deposits/${receiptId}`), onSuccess: invalidate });
}
/** Sets or corrects the agreed deposit of a stay (what the tenant should pay). */
export function useSetAgreedDeposit(assignmentId: string) {
  const invalidate = useInvalidateCore();
  return useMutation({ mutationFn: (amount: number) => api.post<SecurityDepositSummary>(`/room-assignments/${assignmentId}/agreed-deposit`, { amount }), onSuccess: invalidate });
}
