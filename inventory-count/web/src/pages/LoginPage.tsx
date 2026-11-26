import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type User } from '../api/client';
import { tokens } from '../theme/theme';

export function LoginPage() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post<{ user: User }>('/api/auth/login', { username, pin });
      qc.setQueryData(['me'], user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ההתחברות נכשלה');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2, bgcolor: tokens.canvas }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 400, p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
        <Stack component="form" spacing={2.5} onSubmit={submit} noValidate>
          <Stack spacing={0.5}>
            <Typography variant="h2" component="h1">
              ספירת מלאי
            </Typography>
            <Typography variant="body2">מחסני המעבדה · כניסה עם שם משתמש וקוד אישי</Typography>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="שם משתמש"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            required
            inputProps={{ dir: 'ltr', style: { textAlign: 'right' } }}
          />
          <TextField
            label="קוד אישי"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoComplete="current-password"
            required
            inputProps={{ inputMode: 'numeric', maxLength: 8, dir: 'ltr', style: { textAlign: 'right', letterSpacing: '0.3em' } }}
          />
          <Button type="submit" variant="contained" size="large" disabled={busy || !username || pin.length < 4}>
            {busy ? 'מתחבר…' : 'כניסה'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
