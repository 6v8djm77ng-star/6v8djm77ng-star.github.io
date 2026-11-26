import { Box, Button, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { api, type Round } from '../api/client';
import { EmptyState, RoundStatusChip } from '../components/ui';
import { dateTime } from '../format';

export function RoundsPage() {
  const navigate = useNavigate();
  const rounds = useQuery({ queryKey: ['rounds'], queryFn: () => api.get<{ rounds: Round[] }>('/api/rounds').then((r) => r.rounds) });

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h1" sx={{ flex: 1 }}>
          סבבי ספירה
        </Typography>
        <Button variant="contained" startIcon={<AddRounded />} component={RouterLink} to="/rounds/new">
          פתיחת סבב
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        {rounds.isLoading ? (
          <Stack spacing={1} sx={{ p: 2 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={44} />
            ))}
          </Stack>
        ) : !rounds.data?.length ? (
          <EmptyState title="עדיין אין סבבי ספירה" icon={<Inventory2Outlined />}>
            פתיחת סבב שומרת צילום מצב של יתרות SAP. אחר כך מגדירים אזורים, משבצים סופרים, והם מתחילים לסרוק.
            <Box sx={{ mt: 2 }}>
              <Button variant="contained" component={RouterLink} to="/rounds/new">
                פתיחת סבב ראשון
              </Button>
            </Box>
          </EmptyState>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>שם</TableCell>
                  <TableCell>מחסנים</TableCell>
                  <TableCell>סטטוס</TableCell>
                  <TableCell>צילום מצב SAP</TableCell>
                  <TableCell>נפתח ע״י</TableCell>
                  <TableCell>מסמך SAP</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rounds.data.map((r) => (
                  <TableRow
                    key={r.id}
                    hover
                    onClick={() => navigate(`/rounds/${r.id}`)}
                    sx={{ cursor: 'pointer' }}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/rounds/${r.id}`)}
                  >
                    <TableCell>{r.id}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                    <TableCell>{r.warehouses.join(', ')}</TableCell>
                    <TableCell>
                      <RoundStatusChip status={r.status} />
                    </TableCell>
                    <TableCell>{dateTime(r.snapshotAt)}</TableCell>
                    <TableCell>{r.createdBy}</TableCell>
                    <TableCell>{r.sapDocNum ? `#${r.sapDocNum}` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
