import { useMemo, useState } from 'react';
import {
  Box,
  InputAdornment,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, type ItemRow } from '../../api/client';
import { ComparisonChip, EmptyState, ItemStateChip } from '../../components/ui';
import { num, signed } from '../../format';
import { useDebounced } from '../../hooks';
import { tokens } from '../../theme/theme';
import type { RoundData } from '../RoundPage';
import { ItemDrawer } from './ItemDrawer';

const FILTERS = [
  { v: 'all', l: 'הכל' },
  { v: 'diff', l: 'עם הפרש' },
  { v: 'not_counted', l: 'טרם נספרו' },
  { v: 'zero_found', l: 'אפס שנמצא' },
  { v: 'multi_zone', l: 'ביותר מאזור' },
  { v: 'recount', l: 'ספירה חוזרת' },
  { v: 'approved', l: 'אושרו' },
] as const;

export function ItemsTab({ data }: { data: RoundData }) {
  const id = data.round.id;
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'all';
  const warehouse = params.get('wh') ?? '';
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [open, setOpen] = useState<{ warehouse: string; itemCode: string } | null>(null);

  const items = useQuery({
    queryKey: ['items', id, filter, warehouse, dq],
    queryFn: () =>
      api
        .get<{ items: ItemRow[] }>(
          `/api/rounds/${id}/items?filter=${filter}${warehouse ? `&warehouse=${warehouse}` : ''}${dq ? `&q=${encodeURIComponent(dq)}` : ''}`,
        )
        .then((r) => r.items),
    placeholderData: (prev) => prev,
    refetchInterval: data.round.status === 'open' ? 15_000 : false,
  });
  const rows = items.data ?? [];
  const pageRows = useMemo(() => rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [rows, page, rowsPerPage]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    setPage(0);
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <Box sx={{ overflowX: 'auto', flex: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={filter}
            onChange={(_, v) => v && setParam('filter', v)}
            aria-label="סינון פריטים"
            sx={{ '& .MuiToggleButton-root': { px: 1.5, whiteSpace: 'nowrap', fontWeight: 600 } }}
          >
            {FILTERS.map((f) => (
              <ToggleButton key={f.v} value={f.v}>
                {f.l}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        <TextField
          select
          size="small"
          label="מחסן"
          value={warehouse}
          onChange={(e) => setParam('wh', e.target.value)}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">כל המחסנים</MenuItem>
          {data.round.warehouses.map((w) => (
            <MenuItem key={w} value={w}>
              {w}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          placeholder="מק״ט או תיאור"
          value={q}
          onChange={(e) => (setQ(e.target.value), setPage(0))}
          inputProps={{ 'aria-label': 'חיפוש פריט' }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: { md: 240 } }}
        />
      </Stack>

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        {items.isLoading ? (
          <Stack spacing={1} sx={{ p: 2 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="rounded" height={40} />
            ))}
          </Stack>
        ) : rows.length === 0 ? (
          <EmptyState title="אין פריטים בסינון הזה">
            {filter === 'diff' ? 'אין כרגע פריטים עם הפרש מול SAP.' : 'נסו סינון אחר או חיפוש אחר.'}
          </EmptyState>
        ) : (
          <>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>מחסן</TableCell>
                    <TableCell>מק״ט</TableCell>
                    <TableCell>תיאור</TableCell>
                    <TableCell align="left">SAP</TableCell>
                    <TableCell align="left">נספר</TableCell>
                    <TableCell align="left">חוזרת</TableCell>
                    <TableCell align="left">סופי</TableCell>
                    <TableCell align="left">הפרש</TableCell>
                    <TableCell>השוואה</TableCell>
                    <TableCell>סטטוס</TableCell>
                    <TableCell>אזורים</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow
                      key={`${r.warehouse}-${r.itemCode}`}
                      hover
                      tabIndex={0}
                      onClick={() => setOpen({ warehouse: r.warehouse, itemCode: r.itemCode })}
                      onKeyDown={(e) => e.key === 'Enter' && setOpen({ warehouse: r.warehouse, itemCode: r.itemCode })}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>{r.warehouse}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>
                        <bdi>{r.itemCode}</bdi>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography noWrap sx={{ fontSize: 'inherit' }}>
                          {r.itemName}
                        </Typography>
                      </TableCell>
                      <TableCell align="left">{num(r.sapQty)}</TableCell>
                      <TableCell align="left">{num(r.counted)}</TableCell>
                      <TableCell align="left">{num(r.recounted)}</TableCell>
                      <TableCell align="left" sx={{ fontWeight: 600 }}>
                        {num(r.finalQty)}
                      </TableCell>
                      <TableCell
                        align="left"
                        sx={{ fontWeight: 700, color: !r.diff ? tokens.inkSubtle : r.diff > 0 ? tokens.warning : tokens.danger }}
                      >
                        {signed(r.diff)}
                      </TableCell>
                      <TableCell>
                        <ComparisonChip value={r.comparison} />
                      </TableCell>
                      <TableCell>
                        <ItemStateChip state={r.state} />
                      </TableCell>
                      <TableCell sx={{ color: r.zones > 1 ? tokens.warning : undefined, fontWeight: r.zones > 1 ? 600 : 400 }}>
                        {r.zoneNames || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <TablePagination
              component="div"
              count={rows.length}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => (setRowsPerPage(Number(e.target.value)), setPage(0))}
              rowsPerPageOptions={[25, 50, 100, 250]}
              labelRowsPerPage="שורות בעמוד"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} מתוך ${count}`}
            />
          </>
        )}
      </Paper>

      <ItemDrawer data={data} target={open} onClose={() => setOpen(null)} />
    </Stack>
  );
}
