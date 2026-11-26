import type { ReactNode } from 'react';
import {
  Box,
  ButtonBase,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Dashboard } from '../../api/client';
import { num, pct, time, TYPE_HE } from '../../format';
import { useWarehouseName } from '../../hooks';
import { tokens } from '../../theme/theme';
import type { RoundData } from '../RoundPage';

export function OverviewTab({ data }: { data: RoundData }) {
  const id = data.round.id;
  const whName = useWarehouseName();
  const navigate = useNavigate();
  const d = useQuery({
    queryKey: ['dashboard', id],
    queryFn: () => api.get<Dashboard>(`/api/rounds/${id}/dashboard`),
    refetchInterval: data.round.status === 'open' ? 10_000 : false,
  });
  if (d.isLoading || !d.data) return <Skeleton variant="rounded" height={320} />;
  const { totals, byWarehouse, byUser, recent } = d.data;
  const go = (filter: string) => navigate(`/rounds/${id}/items?filter=${filter}`);

  return (
    <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.25fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
      <Stack spacing={2.5} sx={{ minWidth: 0 }}>
        <Section title="התקדמות">
          <Stack spacing={2.25} sx={{ p: 2 }}>
            <ProgressLine label="כל המחסנים" counted={totals.counted} expected={totals.expected} progress={totals.progress} strong />
            {byWarehouse.map((w) => (
              <ProgressLine
                key={w.warehouse}
                label={`${w.warehouse} · ${whName(w.warehouse)}`}
                counted={w.counted}
                expected={w.expected}
                progress={w.progress}
              />
            ))}
          </Stack>
        </Section>

        <Section title="לטיפול">
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            <TodoRow label="פריטים עם הפרש מול SAP" value={totals.withDiff} onClick={() => go('diff')} tone={totals.withDiff ? 'warn' : 'ok'} />
            <TodoRow label="פריטים שטרם נספרו" value={totals.notCounted} onClick={() => go('not_counted')} />
            <TodoRow label="יתרת SAP אפס, נמצאה כמות" value={totals.zeroFound} onClick={() => go('zero_found')} tone={totals.zeroFound ? 'warn' : 'ok'} />
            <TodoRow label="מק״טים שנספרו ביותר מאזור אחד" value={totals.multiZone} onClick={() => go('multi_zone')} />
            <TodoRow label="ספירות חוזרות פתוחות" value={totals.openRecounts} onClick={() => go('recount')} />
            <TodoRow
              label="פריטים חריגים ממתינים לבדיקה"
              value={totals.exceptionsPending}
              onClick={() => navigate(`/rounds/${id}/exceptions`)}
              tone={totals.exceptionsPending ? 'warn' : 'ok'}
            />
            <TodoRow label="פריטים שאושרו ידנית" value={totals.approved} onClick={() => go('approved')} />
          </Box>
        </Section>
      </Stack>

      <Stack spacing={2.5} sx={{ minWidth: 0 }}>
        <Section title="לפי סופר">
          {byUser.length === 0 ? (
            <Typography variant="body2" sx={{ p: 2 }}>
              עדיין אין סופרים משובצים. משבצים בלשונית "אזורים וסופרים".
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>סופר</TableCell>
                    <TableCell>אזור</TableCell>
                    <TableCell align="left">פריטים</TableCell>
                    <TableCell align="left">פעולות</TableCell>
                    <TableCell>אחרונה</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {byUser.map((u) => (
                    <TableRow key={u.userId}>
                      <TableCell sx={{ fontWeight: 600 }}>{u.displayName}</TableCell>
                      <TableCell>{u.zoneName ? `${u.warehouse} · ${u.zoneName}` : '—'}</TableCell>
                      <TableCell align="left">{num(u.items)}</TableCell>
                      <TableCell align="left">{num(u.actions)}</TableCell>
                      <TableCell>{time(u.lastAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Section>

        <Section title="פעולות אחרונות">
          {recent.length === 0 ? (
            <Typography variant="body2" sx={{ p: 2 }}>
              עוד לא נשמרו ספירות.
            </Typography>
          ) : (
            <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {recent.map((r) => (
                <Stack
                  component="li"
                  key={r.id}
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  sx={{ px: 2, py: 1, borderBottom: `1px solid ${tokens.line}`, opacity: r.status === 'cancelled' ? 0.55 : 1 }}
                >
                  <Typography sx={{ fontWeight: 700, minWidth: 40, textAlign: 'center' }}>{num(r.qty)}</Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 500, fontSize: '0.95rem' }}>
                      {r.itemName}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                      {r.userName} · {r.warehouse}
                      {r.zoneName ? ` · ${r.zoneName}` : ''} · {TYPE_HE[r.type]}
                      {r.status === 'cancelled' ? ' · בוטל' : ''}
                    </Typography>
                  </Box>
                  <Typography variant="body2">{time(r.createdAt)}</Typography>
                </Stack>
              ))}
            </Box>
          )}
        </Section>
      </Stack>
    </Box>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.25, bgcolor: tokens.panel, borderBottom: `1px solid ${tokens.line}` }}>
        <Typography variant="h4" component="h2" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

function ProgressLine({ label, counted, expected, progress, strong }: { label: string; counted: number; expected: number; progress: number; strong?: boolean }) {
  return (
    <Box>
      <Stack direction="row" alignItems="baseline" sx={{ mb: 0.75 }}>
        <Typography sx={{ flex: 1, fontWeight: strong ? 700 : 500 }}>{label}</Typography>
        <Typography sx={{ fontWeight: 700, fontSize: strong ? '1.25rem' : '1rem' }}>{pct(progress)}</Typography>
        <Typography variant="body2" sx={{ marginInlineStart: 12, minWidth: 110, textAlign: 'left' }}>
          {num(counted)} מתוך {num(expected)}
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={Math.min(100, progress * 100)} aria-label={`התקדמות ${label}`} />
    </Box>
  );
}

function TodoRow({ label, value, onClick, tone }: { label: string; value: number; onClick: () => void; tone?: 'warn' | 'ok' }) {
  const color = tone === 'warn' && value > 0 ? tokens.warning : value === 0 ? tokens.inkSubtle : tokens.ink;
  return (
    <Box component="li" sx={{ borderBottom: `1px solid ${tokens.line}`, '&:last-child': { borderBottom: 0 } }}>
      <ButtonBase onClick={onClick} sx={{ width: '100%', px: 2, py: 1.5, gap: 1.5, justifyContent: 'flex-start', '&:hover': { bgcolor: 'action.hover' } }}>
        <Typography sx={{ flex: 1, textAlign: 'start' }}>{label}</Typography>
        <Typography sx={{ fontWeight: 700, fontSize: '1.1rem', color, minWidth: 40, textAlign: 'left' }}>{num(value)}</Typography>
        <ChevronLeftRounded sx={{ color: tokens.inkSubtle }} />
      </ButtonBase>
    </Box>
  );
}
