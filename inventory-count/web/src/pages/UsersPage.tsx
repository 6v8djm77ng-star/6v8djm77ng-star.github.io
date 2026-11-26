import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Role, type User } from '../api/client';
import { tokens } from '../theme/theme';
import { Section } from './round/OverviewTab';

export function UsersPage({ me }: { me: User }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/api/users').then((r) => r.users) });
  const [form, setForm] = useState({ username: '', displayName: '', role: 'counter' as Role, pin: '' });
  const [pinFor, setPinFor] = useState<{ id: number; pin: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ user: User }>('/api/users', form),
    onSuccess: ({ user }) => {
      setFlash(`המשתמש ${user.displayName} נוצר. שם משתמש: ${user.username}`);
      setForm({ username: '', displayName: '', role: 'counter', pin: '' });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: number; body: Partial<{ active: boolean; role: Role; pin: string }> }) => api.patch(`/api/users/${v.id}`, v.body),
    onSuccess: (_, v) => {
      if (v.body.pin) setFlash('הקוד עודכן. ההתחברויות הקיימות של המשתמש נותקו.');
      setPinFor(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFlash(null);
    create.mutate();
  };
  const err = create.error ?? update.error;

  return (
    <Stack spacing={2.5}>
      <Typography variant="h1">משתמשים</Typography>
      {flash && <Alert severity="success" onClose={() => setFlash(null)}>{flash}</Alert>}
      {err && <Alert severity="error">{err instanceof ApiError ? err.message : 'הפעולה נכשלה'}</Alert>}

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '360px minmax(0,1fr)' }, alignItems: 'start' }}>
        <Section title="משתמש חדש">
          <Stack component="form" spacing={2} sx={{ p: 2 }} onSubmit={submit}>
            <TextField label="שם לתצוגה" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <TextField
              label="שם משתמש (באנגלית)"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s/g, '') })}
              inputProps={{ dir: 'ltr', autoCapitalize: 'none' }}
              helperText="לדוגמה: yossi"
            />
            <TextField select label="תפקיד" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <MenuItem value="counter">סופר</MenuItem>
              <MenuItem value="manager">מנהל</MenuItem>
            </TextField>
            <TextField
              label="קוד אישי (4–8 ספרות)"
              required
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })}
              inputProps={{ inputMode: 'numeric', dir: 'ltr' }}
            />
            <Button type="submit" variant="contained" disabled={create.isPending || form.pin.length < 4 || !form.username || !form.displayName}>
              יצירת משתמש
            </Button>
          </Stack>
        </Section>

        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          {users.isLoading ? (
            <Skeleton variant="rounded" height={200} />
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>שם</TableCell>
                    <TableCell>שם משתמש</TableCell>
                    <TableCell>תפקיד</TableCell>
                    <TableCell>פעיל</TableCell>
                    <TableCell>קוד</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(users.data ?? []).map((u) => (
                    <TableRow key={u.id} sx={{ opacity: u.active ? 1 : 0.6 }}>
                      <TableCell sx={{ fontWeight: 600 }}>
                        {u.displayName} {u.id === me.id && <Chip size="small" label="את/ה" sx={{ marginInlineStart: 8, bgcolor: tokens.accentTint, color: tokens.accent }} />}
                      </TableCell>
                      <TableCell>{u.username}</TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={u.role}
                          disabled={u.id === me.id}
                          onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value as Role } })}
                          inputProps={{ 'aria-label': `תפקיד ${u.displayName}` }}
                        >
                          <MenuItem value="counter">סופר</MenuItem>
                          <MenuItem value="manager">מנהל</MenuItem>
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={u.active}
                          disabled={u.id === me.id}
                          onChange={(e) => update.mutate({ id: u.id, body: { active: e.target.checked } })}
                          inputProps={{ 'aria-label': `${u.displayName} פעיל` }}
                        />
                      </TableCell>
                      <TableCell>
                        {pinFor?.id === u.id ? (
                          <Stack direction="row" spacing={1}>
                            <TextField
                              size="small"
                              placeholder="קוד חדש"
                              value={pinFor.pin}
                              onChange={(e) => setPinFor({ id: u.id, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                              inputProps={{ inputMode: 'numeric', dir: 'ltr', 'aria-label': 'קוד חדש' }}
                              sx={{ width: 110 }}
                            />
                            <Button size="small" variant="contained" disabled={pinFor.pin.length < 4} onClick={() => update.mutate({ id: u.id, body: { pin: pinFor.pin } })}>
                              שמירה
                            </Button>
                            <Button size="small" onClick={() => setPinFor(null)}>ביטול</Button>
                          </Stack>
                        ) : (
                          <Button size="small" onClick={() => setPinFor({ id: u.id, pin: '' })}>
                            החלפת קוד
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}
