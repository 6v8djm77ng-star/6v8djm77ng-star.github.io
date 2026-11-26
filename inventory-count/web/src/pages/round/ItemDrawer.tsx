import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ItemHistory } from '../../api/client';
import { ComparisonChip, Field, ItemStateChip } from '../../components/ui';
import { dateTime, num, signed, TYPE_HE } from '../../format';
import { tokens } from '../../theme/theme';
import type { RoundData } from '../RoundPage';

export function ItemDrawer({
  data,
  target,
  onClose,
}: {
  data: RoundData;
  target: { warehouse: string; itemCode: string } | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      anchor="right"
      open={!!target}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' } }}
    >
      {target && <ItemDetail key={`${target.warehouse}-${target.itemCode}`} data={data} target={target} onClose={onClose} />}
    </Drawer>
  );
}

function ItemDetail({ data, target, onClose }: { data: RoundData; target: { warehouse: string; itemCode: string }; onClose: () => void }) {
  const id = data.round.id;
  const qc = useQueryClient();
  const key = ['item', id, target.warehouse, target.itemCode];
  const h = useQuery({
    queryKey: key,
    queryFn: () => api.get<ItemHistory>(`/api/rounds/${id}/items/${encodeURIComponent(target.warehouse)}/${encodeURIComponent(target.itemCode)}`),
  });
  const refresh = (next: ItemHistory) => {
    qc.setQueryData(key, next);
    void qc.invalidateQueries({ queryKey: ['items', id] });
    void qc.invalidateQueries({ queryKey: ['dashboard', id] });
  };

  const [recountNote, setRecountNote] = useState('');
  const [assignee, setAssignee] = useState<number | ''>('');
  const [approveQty, setApproveQty] = useState('');
  const [approveNote, setApproveNote] = useState('');
  useEffect(() => {
    const s = h.data?.summary;
    if (s && approveQty === '') setApproveQty(String(s.approvedQty ?? s.recounted ?? s.counted ?? 0));
  }, [h.data, approveQty]);

  const recount = useMutation({
    mutationFn: () =>
      api.post<ItemHistory>(`/api/rounds/${id}/recounts`, {
        ...target,
        assignedTo: assignee === '' ? null : assignee,
        note: recountNote || undefined,
      }),
    onSuccess: (r) => (refresh(r), setRecountNote('')),
  });
  const approve = useMutation({
    mutationFn: () => api.post<ItemHistory>(`/api/rounds/${id}/approvals`, { ...target, qty: Number(approveQty), note: approveNote || undefined }),
    onSuccess: (r) => (refresh(r), setApproveNote('')),
  });
  const revoke = useMutation({
    mutationFn: () => api.post<ItemHistory>(`/api/rounds/${id}/approvals/revoke`, target),
    onSuccess: refresh,
  });

  const closed = data.round.status === 'closed';
  const s = h.data?.summary;

  return (
    <Stack sx={{ height: '100%' }}>
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ p: 2.5, pb: 2, borderBottom: `1px solid ${tokens.line}` }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h3" component="h2">
            {h.data?.itemName ?? '…'}
          </Typography>
          <Typography variant="body2">
            מק״ט <span dir="ltr">{target.itemCode}</span> · מחסן {target.warehouse}
            {h.data?.barcodes[0] ? <> · ברקוד <span dir="ltr">{h.data.barcodes[0]}</span></> : null}
          </Typography>
        </Box>
        <IconButton aria-label="סגירה" onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
        {h.isLoading || !h.data ? (
          <Skeleton variant="rounded" height={240} />
        ) : (
          <Stack spacing={3}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 2 }}>
              <Field label="יתרת SAP (צילום מצב)" strong>{num(h.data.sapQty)}</Field>
              <Field label="נספר" strong>{num(s?.counted)}</Field>
              <Field label="ספירה חוזרת" strong>{num(s?.recounted)}</Field>
              <Field label="כמות סופית" strong>{num(s?.finalQty)}</Field>
              <Field label="הפרש" strong>{signed(s?.diff)}</Field>
              <Box>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 0.5 }}>מצב</Typography>
                <Stack spacing={0.5} alignItems="flex-start">
                  {s && <ItemStateChip state={s.state} />}
                  {s?.comparison && <ComparisonChip value={s.comparison} />}
                </Stack>
              </Box>
            </Box>

            <Box>
              <Typography variant="h4" sx={{ mb: 1 }}>היסטוריית ספירות</Typography>
              {h.data.actions.length === 0 ? (
                <Typography variant="body2">הפריט עוד לא נספר.</Typography>
              ) : (
                <Box sx={{ overflowX: 'auto', border: `1px solid ${tokens.line}`, borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>זמן</TableCell>
                        <TableCell>סופר</TableCell>
                        <TableCell>אזור</TableCell>
                        <TableCell>סוג</TableCell>
                        <TableCell align="left">כמות</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {h.data.actions.map((a) => (
                        <TableRow key={a.id} sx={{ opacity: a.status === 'cancelled' ? 0.55 : 1 }}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateTime(a.createdAt)}</TableCell>
                          <TableCell>{a.userName}</TableCell>
                          <TableCell>{a.zoneName ?? '—'}</TableCell>
                          <TableCell>
                            {TYPE_HE[a.type]}
                            {a.status === 'cancelled' && (
                              <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>
                                בוטל ע״י {a.cancelledBy}: {a.cancelReason}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="left" sx={{ fontWeight: 700, textDecoration: a.status === 'cancelled' ? 'line-through' : 'none' }}>
                            {num(a.qty)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Box>

            {h.data.recounts.length > 0 && (
              <Box>
                <Typography variant="h4" sx={{ mb: 1 }}>בקשות לספירה חוזרת</Typography>
                {h.data.recounts.map((r) => (
                  <Typography key={r.id} variant="body2" sx={{ color: 'text.primary' }}>
                    {dateTime(r.createdAt)} · {r.createdBy}
                    {r.assignedTo ? ` → ${r.assignedTo}` : ' → כל סופר'} · {r.status === 'open' ? 'פתוחה' : 'הסתיימה'}
                    {r.note ? ` · ${r.note}` : ''}
                  </Typography>
                ))}
              </Box>
            )}

            <Divider />

            {!closed && !s?.openRecount && (
              <Stack spacing={1.5}>
                <Typography variant="h4">הוראה לספירה חוזרת</Typography>
                <Typography variant="body2">הספירה החוזרת נשמרת בנפרד ולא דורסת את המקורית.</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField select size="small" label="סופר" value={assignee} onChange={(e) => setAssignee(e.target.value === '' ? '' : Number(e.target.value))} sx={{ minWidth: 180 }}>
                    <MenuItem value="">כל סופר במחסן</MenuItem>
                    {data.assignments
                      .filter((a) => a.warehouse === target.warehouse)
                      .map((a) => (
                        <MenuItem key={a.userId} value={a.userId}>
                          {a.displayName} · {a.zoneName}
                        </MenuItem>
                      ))}
                  </TextField>
                  <TextField size="small" label="הערה לסופר" value={recountNote} onChange={(e) => setRecountNote(e.target.value)} fullWidth />
                </Stack>
                {recount.error && <Alert severity="error">{recount.error instanceof ApiError ? recount.error.message : 'נכשל'}</Alert>}
                <Box>
                  <Button variant="outlined" onClick={() => recount.mutate()} disabled={recount.isPending}>
                    שליחה לספירה חוזרת
                  </Button>
                </Box>
              </Stack>
            )}

            {!closed && (
              <Stack spacing={1.5}>
                <Typography variant="h4">אישור כמות סופית</Typography>
                {h.data.approval && (
                  <Alert severity="success">
                    אושר {num(h.data.approval.approvedQty)} ע״י {h.data.approval.approvedBy} · {dateTime(h.data.approval.approvedAt)}
                    {h.data.approval.note ? ` · ${h.data.approval.note}` : ''}
                  </Alert>
                )}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    size="small"
                    label="כמות מאושרת"
                    value={approveQty}
                    onChange={(e) => setApproveQty(e.target.value.replace(/\D/g, ''))}
                    inputProps={{ inputMode: 'numeric' }}
                    sx={{ maxWidth: { sm: 150 } }}
                  />
                  <TextField size="small" label="הערה" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} fullWidth />
                </Stack>
                {(approve.error || revoke.error) && (
                  <Alert severity="error">{((approve.error ?? revoke.error) as ApiError).message}</Alert>
                )}
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={() => approve.mutate()} disabled={approveQty === '' || approve.isPending}>
                    אישור כמות
                  </Button>
                  {h.data.approval && (
                    <Button onClick={() => revoke.mutate()} disabled={revoke.isPending}>
                      ביטול האישור
                    </Button>
                  )}
                </Stack>
                <Typography variant="body2">הכמות המאושרת היא זו שתישלח למסמך ספירת המלאי ב-SAP.</Typography>
              </Stack>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
