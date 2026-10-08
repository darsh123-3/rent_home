import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { PropertyProvider } from '@/features/properties/PropertyProvider';
import { AddTenantPage } from '@/pages/AddTenantPage';
import { AssignRoomPage } from '@/pages/AssignRoomPage';
import { BillDetailPage } from '@/pages/BillDetailPage';
import { BillSettingsPage } from '@/pages/BillSettingsPage';
import { BillsPage } from '@/pages/BillsPage';
import { EditTenantPage } from '@/pages/EditTenantPage';
import { EditBillPage, GenerateBillPage } from '@/pages/GenerateBillPage';
import { HelpPage } from '@/pages/HelpPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { MorePage } from '@/pages/MorePage';
import { MoveOutPage } from '@/pages/MoveOutPage';
import { PaymentsPage } from '@/pages/PaymentsPage';
import { PropertiesPage } from '@/pages/PropertiesPage';
import { PropertyFormPage } from '@/pages/PropertyFormPage';
import { RecordPaymentPage } from '@/pages/RecordPaymentPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { RoomDetailPage } from '@/pages/RoomDetailPage';
import { RoomFormPage } from '@/pages/RoomFormPage';
import { RoomsPage } from '@/pages/RoomsPage';
import { SecurityPage } from '@/pages/SecurityPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TenantProfilePage } from '@/pages/TenantProfilePage';
import { TenantsPage } from '@/pages/TenantsPage';

function Protected() {
  const { status } = useAuth();
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return <PropertyProvider><AppShell /></PropertyProvider>;
}

function LoginRoute() {
  const { status } = useAuth();
  return status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<Protected />}>
        <Route index element={<HomePage />} />
        <Route path="rooms" element={<RoomsPage />} />
        <Route path="rooms/new" element={<RoomFormPage />} />
        <Route path="rooms/:id" element={<RoomDetailPage />} />
        <Route path="rooms/:id/edit" element={<RoomFormPage />} />
        <Route path="tenants" element={<TenantsPage />} />
        <Route path="tenants/new" element={<AddTenantPage />} />
        <Route path="tenants/:id" element={<TenantProfilePage />} />
        <Route path="tenants/:id/edit" element={<EditTenantPage />} />
        <Route path="tenants/:id/move-out" element={<MoveOutPage />} />
        <Route path="tenants/:id/assign" element={<AssignRoomPage />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="bills/new" element={<GenerateBillPage />} />
        <Route path="bills/:id/edit" element={<EditBillPage />} />
        <Route path="bills/:id" element={<BillDetailPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="payments/new" element={<RecordPaymentPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="properties" element={<PropertiesPage />} />
        <Route path="properties/new" element={<PropertyFormPage />} />
        <Route path="properties/:id/edit" element={<PropertyFormPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/bill" element={<BillSettingsPage />} />
        <Route path="settings/security" element={<SecurityPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2 } },
  }));
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
