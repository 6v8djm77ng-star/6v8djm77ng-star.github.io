import { useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Skeleton, Stack, TextField, Typography } from '@mui/material';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ExceptionItem } from '../../api/client';
import { EmptyState } from '../../components/ui';
import { dateTime, num } from '../../format';
import { tokens } from '../../theme/theme';
import type { RoundData } from '../RoundPage';

export function ExceptionsTab({ data }: { data: RoundData }) {
  const id = data.round.id;
  const list = useQuery({
    queryKey: ['exceptions', id],
    queryFn: () => api.get<{ exceptions: ExceptionItem[] }>(`/api/rounds/${id}/exceptions`).then((r) => r.exceptions),
    refetchInterval: data.round.status === 'open' ? 15_000 : false,
  });

  if (list.isLoading) return <Skeleton variant="rounded" height={200} />;
  const items = list.data ?? [];
  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        פריטים שנמצאו פיזית ולא קיימים ב-SAP. הם לא נשלחים ל-SAP. צריך לבדוק כל אחד: פריט שלא נקלט, מק״ט שגוי, כפילות, או סחורה שהתקבלה ולא תועדה.
      </Typography>
      {items.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState title="אין פריטים חריגים" icon={<ReportProblemOutlined />}>
            כשסופר סורק פריט שלא קיים ב-SAP, הוא מדווח עליו מהמסך שלו והפריט מגיע לכאן לבדיקה.
          </EmptyState>
        </Paper>
      ) : (
        items.map((e) => <ExceptionCard key={e.id} roundId={id} item={e} closed={data.round.status === 'closed'} />)
      )}
    </Stack>
  );
}

function ExceptionCard({ roundId, item, closed }: { roundId: number; item: ExceptionItem; closed: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const resolve = useMutation({
    mutationFn: () => api.post(`/api/rounds/${roundId}/exceptions/${item.id}/resolve`, { note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['exceptions', roundId] });
      void qc.invalidateQueries({ queryKey: ['dashboard', roundId] });
    },
  });
  const pending = item.reviewStatus === 'pending';
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: pending ? tokens.surface : tokens.canvas }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {!!item.hasPhoto && (
          <Box
            component="a"
            href={`/api/rounds/${roundId}/exceptions/${item.id}/photo`}
            target="_blank"
            rel="noopener"
            aria-label={`תמונה מלאה: ${item.description}`}
            sx={{ flexShrink: 0, display: 'block', width: { xs: '100%', md: 140 }, height: 140, borderRadius: 2, overflow: 'hidden', border: `1px solid ${tokens.line}` }}
          >
            <Box
              component="img"
              src={`/api/rounds/${roundId}/exceptions/${item.id}/photo`}
              alt={item.description}
              loading="lazy"
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h4">{item.description}</Typography>
            <Chip
              size="small"
              label={pending ? 'ממתין לבדיקה' : 'נבדק'}
              sx={pending ? { bgcolor: tokens.warningTint, color: tokens.warning } : { bgcolor: tokens.successTint, color: tokens.success }}
            />
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.primary' }}>
            כמות <b>{num(item.qty)}</b> · מחסן {item.warehouse}
            {item.code ? <> · מק״ט <span dir="ltr">{item.code}</span></> : null}
            {item.barcode ? <> · ברקוד <span dir="ltr">{item.barcode}</span></> : null}
          </Typography>
          <Typography variant="body2">
            דווח ע״י {item.userName}
            {item.zoneName ? ` · אזור ${item.zoneName}` : ''} · {dateTime(item.createdAt)}
          </Typography>
          {item.notes && <Typography variant="body2" sx={{ mt: 0.5 }}>הערת הסופר: {item.notes}</Typography>}
          {!pending && (
            <Typography sx={{ mt: 1 }}>
              <b>ממצא:</b> {item.reviewNote} <Typography component="span" variant="body2">({item.reviewedBy})</Typography>
            </Typography>
          )}
        </Box>
        {pending && !closed && (
          <Stack spacing={1} sx={{ width: { md: 340 } }}>
            <TextField size="small" label="ממצא הבדיקה" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
            {resolve.error && <Alert severity="error">{resolve.error instanceof ApiError ? resolve.error.message : 'נכשל'}</Alert>}
            <Button variant="contained" onClick={() => resolve.mutate()} disabled={!note.trim() || resolve.isPending}>
              סימון כנבדק
            </Button>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
