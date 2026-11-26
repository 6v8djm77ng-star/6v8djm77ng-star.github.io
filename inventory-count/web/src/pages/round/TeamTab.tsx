import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { api, ApiError, type User } from '../../api/client';
import { useWarehouseName } from '../../hooks';
import type { RoundData } from '../RoundPage';
import { Section } from './OverviewTab';

export function TeamTab({ data }: { data: RoundData }) {
  const id = data.round.id;
  const qc = useQueryClient();
  const whName = useWarehouseName();
  const closed = data.round.status === 'closed';
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/api/users').then((r) => r.users) });
  const [draft, setDraft] = useState<Record<string, string>>({});

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['round', id] });
    void qc.invalidateQueries({ queryKey: ['dashboard', id] });
  };
  const addZone = useMutation({
    mutationFn: (wh: string) => api.post(`/api/rounds/${id}/zones`, { warehouse: wh, name: draft[wh] ?? '' }),
    onSuccess: (_, wh) => (setDraft({ ...draft, [wh]: '' }), invalidate()),
  });
  const assign = useMutation({
    mutationFn: (v: { userId: number; zoneId: number | null }) => api.post(`/api/rounds/${id}/assignments`, v),
    onSuccess: invalidate,
  });

  const active = (users.data ?? []).filter((u) => u.active);
  const zoneOf = (userId: number) => data.assignments.find((a) => a.userId === userId)?.zoneId ?? '';
  const err = addZone.error ?? assign.error;

  return (
    <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) minmax(0,1.3fr)' }, alignItems: 'start' }}>
      <Section title="אזורים">
        <Stack spacing={2.5} sx={{ p: 2 }}>
          {data.round.warehouses.map((wh) => {
            const zones = data.zones.filter((z) => z.warehouse === wh);
            return (
              <Box key={wh}>
                <Typography sx={{ fontWeight: 600, mb: 1 }}>
                  מחסן {wh} · {whName(wh)}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  {zones.length === 0 && <Typography variant="body2">אין אזורים עדיין.</Typography>}
                  {zones.map((z) => (
                    <Chip
                      key={z.id}
                      label={`${z.name} · ${data.assignments.filter((a) => a.zoneId === z.id).length} סופרים`}
                      variant="outlined"
                    />
                  ))}
                </Stack>
                {!closed && (
                  <Stack
                    direction="row"
                    spacing={1}
                    component="form"
                    onSubmit={(e) => (e.preventDefault(), (draft[wh] ?? '').trim() && addZone.mutate(wh))}
                    sx={{ maxWidth: 380 }}
                  >
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="שם אזור חדש"
                      value={draft[wh] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [wh]: e.target.value })}
                      inputProps={{ 'aria-label': `אזור חדש במחסן ${wh}`, maxLength: 60 }}
                    />
                    <IconButton type="submit" color="primary" aria-label="הוספת אזור" disabled={addZone.isPending}>
                      <AddRounded />
                    </IconButton>
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>
      </Section>

      <Section
        title="שיבוץ סופרים"
        action={
          <Button size="small" component={RouterLink} to="/users">
            ניהול משתמשים
          </Button>
        }
      >
        {err && <Alert severity="error" sx={{ m: 2 }}>{err instanceof ApiError ? err.message : 'הפעולה נכשלה'}</Alert>}
        {data.zones.length === 0 ? (
          <Typography variant="body2" sx={{ p: 2 }}>
            קודם מגדירים אזורים, ואז משבצים אליהם סופרים.
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>משתמש</TableCell>
                  <TableCell>תפקיד</TableCell>
                  <TableCell sx={{ width: 260 }}>אזור</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {active.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{u.displayName}</TableCell>
                    <TableCell>{u.role === 'manager' ? 'מנהל' : 'סופר'}</TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={zoneOf(u.id)}
                        disabled={closed || assign.isPending}
                        onChange={(e) => assign.mutate({ userId: u.id, zoneId: e.target.value === '' ? null : Number(e.target.value) })}
                        inputProps={{ 'aria-label': `אזור עבור ${u.displayName}` }}
                      >
                        <MenuItem value="">לא משובץ</MenuItem>
                        {data.zones.map((z) => (
                          <MenuItem key={z.id} value={z.id}>
                            {z.warehouse} · {z.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Section>
    </Box>
  );
}
