import { Alert, Box, Button, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import QrCodeScannerRounded from '@mui/icons-material/QrCodeScannerRounded';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { api, ApiError, type Assignment, type Round, type RoundStatus, type Zone } from '../api/client';
import { RoundStatusChip } from '../components/ui';
import { dateTime } from '../format';
import { OverviewTab } from './round/OverviewTab';
import { ItemsTab } from './round/ItemsTab';
import { ExceptionsTab } from './round/ExceptionsTab';
import { TeamTab } from './round/TeamTab';
import { CloseTab } from './round/CloseTab';

export interface RoundData {
  round: Round;
  zones: Zone[];
  assignments: Assignment[];
}

const TABS = [
  { path: '', label: 'סקירה' },
  { path: 'items', label: 'פריטים והפרשים' },
  { path: 'exceptions', label: 'פריטים חריגים' },
  { path: 'team', label: 'אזורים וסופרים' },
  { path: 'close', label: 'סגירה, SAP ודוחות' },
];

export function RoundPage() {
  const id = Number(useParams().id);
  const location = useLocation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['round', id],
    queryFn: () => api.get<RoundData>(`/api/rounds/${id}`),
    refetchInterval: 15_000,
  });
  const status = useMutation({
    mutationFn: (s: RoundStatus) => api.post<{ round: Round }>(`/api/rounds/${id}/status`, { status: s }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['round', id] });
      void qc.invalidateQueries({ queryKey: ['dashboard', id] });
      void qc.invalidateQueries({ queryKey: ['rounds'] });
    },
  });

  if (q.isLoading) return <Skeleton variant="rounded" height={160} />;
  if (q.error || !q.data) return <Alert severity="error">{q.error instanceof ApiError ? q.error.message : 'הסבב לא נמצא'}</Alert>;
  const { round } = q.data;
  const sub = location.pathname.split('/')[3] ?? '';
  const tabIndex = Math.max(0, TABS.findIndex((t) => t.path === sub));

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h1">{round.name}</Typography>
            <RoundStatusChip status={round.status} />
          </Stack>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            סבב #{round.id} · מחסנים {round.warehouses.join(', ')} · צילום מצב SAP {dateTime(round.snapshotAt)} · נפתח ע״י {round.createdBy}
            {round.sapDocNum ? ` · נשלח ל-SAP, מסמך ${round.sapDocNum}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {round.status !== 'closed' && (
            <Button variant="outlined" startIcon={<QrCodeScannerRounded />} component={RouterLink} to={`/count/${round.id}`}>
              מסך ספירה
            </Button>
          )}
          {round.status === 'open' && (
            <>
              <Button variant="outlined" startIcon={<PauseRounded />} onClick={() => status.mutate('paused')} disabled={status.isPending}>
                השהיה
              </Button>
              <Button variant="contained" startIcon={<FactCheckOutlined />} onClick={() => status.mutate('review')} disabled={status.isPending}>
                סיום ספירה ומעבר לבקרה
              </Button>
            </>
          )}
          {round.status === 'paused' && (
            <Button variant="contained" startIcon={<PlayArrowRounded />} onClick={() => status.mutate('open')} disabled={status.isPending}>
              חידוש הספירה
            </Button>
          )}
          {round.status === 'review' && (
            <Button variant="outlined" startIcon={<PlayArrowRounded />} onClick={() => status.mutate('open')} disabled={status.isPending}>
              החזרה לספירה
            </Button>
          )}
        </Stack>
      </Stack>
      {status.error && <Alert severity="error">{status.error instanceof ApiError ? status.error.message : 'הפעולה נכשלה'}</Alert>}

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabIndex} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
          {TABS.map((t) => (
            <Tab key={t.path} label={t.label} component={RouterLink} to={`/rounds/${id}${t.path ? `/${t.path}` : ''}`} />
          ))}
        </Tabs>
      </Box>

      <Routes>
        <Route index element={<OverviewTab data={q.data} />} />
        <Route path="items" element={<ItemsTab data={q.data} />} />
        <Route path="exceptions" element={<ExceptionsTab data={q.data} />} />
        <Route path="team" element={<TeamTab data={q.data} />} />
        <Route path="close" element={<CloseTab data={q.data} />} />
      </Routes>
    </Stack>
  );
}
