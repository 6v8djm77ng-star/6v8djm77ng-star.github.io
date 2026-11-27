import { useEffect } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, type Meta, type User } from './api/client';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { CounterPage } from './pages/CounterPage';
import { RoundsPage } from './pages/RoundsPage';
import { RoundNewPage } from './pages/RoundNewPage';
import { RoundPage } from './pages/RoundPage';
import { UsersPage } from './pages/UsersPage';
import { PrintReportPage } from './pages/PrintReportPage';
import { MetaContext } from './hooks';

export function App() {
  const qc = useQueryClient();
  const location = useLocation();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: User }>('/api/auth/me').then((r) => r.user),
    retry: false,
    staleTime: 60_000,
  });
  const meta = useQuery({
    queryKey: ['meta'],
    queryFn: () => api.get<Meta>('/api/meta'),
    enabled: !!me.data,
    staleTime: Infinity,
  });

  useEffect(() => {
    const onExpired = () => qc.setQueryData(['me'], null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [qc]);

  if (me.isLoading || (me.data && meta.isLoading)) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress aria-label="טוען" />
      </Box>
    );
  }

  const user = me.data;
  if (!user) return <LoginPage />;

  // Printable reports render without the app chrome so the PDF holds only the report.
  if (user.role === 'manager' && /^\/rounds\/\d+\/print\//.test(location.pathname)) {
    return (
      <MetaContext.Provider value={meta.data ?? null}>
        <Routes>
          <Route path="/rounds/:id/print/:type" element={<PrintReportPage />} />
        </Routes>
      </MetaContext.Provider>
    );
  }

  return (
    <MetaContext.Provider value={meta.data ?? null}>
      <AppShell user={user}>
        <Routes>
          {user.role === 'manager' ? (
            <>
              <Route path="/" element={<RoundsPage />} />
              <Route path="/rounds/new" element={<RoundNewPage />} />
              <Route path="/rounds/:id/*" element={<RoundPage />} />
              <Route path="/users" element={<UsersPage me={user} />} />
              <Route path="/count/:roundId" element={<CounterPage user={user} />} />
            </>
          ) : (
            <Route path="/" element={<CounterPage user={user} />} />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </MetaContext.Provider>
  );
}
