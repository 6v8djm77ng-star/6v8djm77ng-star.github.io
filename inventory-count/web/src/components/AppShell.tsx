import type { ReactNode } from 'react';
import { AppBar, Box, Button, Container, Stack, Toolbar, Typography } from '@mui/material';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { api, type User } from '../api/client';
import { useMeta, useOnline } from '../hooks';
import { tokens } from '../theme/theme';
import { OnlineBadge } from './ui';

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const qc = useQueryClient();
  const online = useOnline();
  const meta = useMeta();
  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      qc.clear();
      qc.setQueryData(['me'], null);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" sx={{ bgcolor: tokens.surface, borderBottom: `1px solid ${tokens.line}` }}>
        <Toolbar sx={{ gap: { xs: 1, sm: 2 }, minHeight: { xs: 56, sm: 60 } }}>
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Box
              aria-hidden
              sx={{ width: 28, height: 28, borderRadius: '7px', bgcolor: tokens.accent, display: 'grid', placeItems: 'center' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16">
                <path d="M3 4.5h10M3 8h10M3 11.5h6.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: '1.05rem', whiteSpace: 'nowrap' }}>ספירת מלאי</Typography>
          </Stack>

          {user.role === 'manager' && (
            <Stack component="nav" direction="row" spacing={0.5} sx={{ display: { xs: 'none', sm: 'flex' } }}>
              <NavButton to="/" end>
                סבבי ספירה
              </NavButton>
              <NavButton to="/users">משתמשים</NavButton>
            </Stack>
          )}

          <Box sx={{ flex: 1 }} />
          {meta?.sapMode === 'mock' && (
            <Typography
              variant="body2"
              sx={{ px: 1, py: 0.25, borderRadius: 1, bgcolor: tokens.warningTint, color: tokens.warning, fontWeight: 600, fontSize: '0.8rem' }}
            >
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>מצב הדגמה – ללא SAP</Box>
              <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>הדגמה</Box>
            </Typography>
          )}
          <OnlineBadge online={online} />
          <Typography sx={{ display: { xs: 'none', md: 'block' }, fontWeight: 500 }}>{user.displayName}</Typography>
          <Button color="inherit" onClick={logout} startIcon={<LogoutRounded />} sx={{ color: tokens.inkMuted, minWidth: 0, whiteSpace: 'nowrap' }}>
            יציאה
          </Button>
        </Toolbar>
        {user.role === 'manager' && (
          <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'flex', sm: 'none' }, px: 1, pb: 1 }}>
            <NavButton to="/" end>
              סבבי ספירה
            </NavButton>
            <NavButton to="/users">משתמשים</NavButton>
          </Stack>
        )}
      </AppBar>
      {!online && (
        <Box role="alert" sx={{ bgcolor: tokens.danger, color: '#fff', textAlign: 'center', py: 1, fontWeight: 600 }}>
          אין חיבור לשרת. ספירות לא יישמרו עד שהחיבור יחזור.
        </Box>
      )}
      <Container maxWidth="xl" component="main" sx={{ flex: 1, py: { xs: 2, sm: 3 }, px: { xs: 1.5, sm: 3 } }}>
        {children}
      </Container>
    </Box>
  );
}

function NavButton({ to, children, end }: { to: string; children: ReactNode; end?: boolean }) {
  return (
    <Button
      component={NavLink}
      to={to}
      end={end}
      sx={{
        color: tokens.inkMuted,
        '&.active': { color: tokens.accent, bgcolor: tokens.accentTint },
      }}
    >
      {children}
    </Button>
  );
}
