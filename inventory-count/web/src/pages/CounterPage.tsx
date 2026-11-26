import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import QrCodeScannerRounded from '@mui/icons-material/QrCodeScannerRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import RemoveRounded from '@mui/icons-material/RemoveRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type BlindItem,
  type CountResult,
  type MyAction,
  type MyAssignment,
  type Round,
  type RoundStatus,
  type User,
} from '../api/client';
import { ComparisonChip, EmptyState } from '../components/ui';
import { num, signed, time, TYPE_HE } from '../format';
import { useDebounced, useOnline, useWarehouseName } from '../hooks';
import { tokens } from '../theme/theme';
import { uuid } from '../uuid';

interface Ctx {
  roundId: number;
  roundName: string;
  status: RoundStatus;
  warehouse: string;
  zoneName: string | null;
}

/** Counter screen. Counters get their assignment; managers open it per round (/count/:roundId?wh=). */
export function CounterPage({ user }: { user: User }) {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const managerRoundId = params.roundId ? Number(params.roundId) : null;

  const assignment = useQuery({
    queryKey: ['my-assignment'],
    queryFn: () => api.get<MyAssignment>('/api/my/assignment'),
    refetchInterval: 20_000,
  });
  const managerRound = useQuery({
    queryKey: ['round', managerRoundId],
    queryFn: () => api.get<{ round: Round }>(`/api/rounds/${managerRoundId}`),
    enabled: managerRoundId !== null,
    refetchInterval: 20_000,
  });

  let ctx: Ctx | null = null;
  if (managerRoundId !== null && managerRound.data) {
    const r = managerRound.data.round;
    const wh = search.get('wh') && r.warehouses.includes(search.get('wh')!) ? search.get('wh')! : r.warehouses[0]!;
    const a = assignment.data?.assignment;
    ctx = {
      roundId: r.id,
      roundName: r.name,
      status: r.status,
      warehouse: wh,
      zoneName: a && a.roundId === r.id && a.warehouse === wh ? a.zoneName : null,
    };
  } else if (managerRoundId === null && assignment.data?.assignment) {
    const a = assignment.data.assignment;
    ctx = { roundId: a.roundId, roundName: a.roundName, status: a.status, warehouse: a.warehouse, zoneName: a.zoneName };
  }

  if (assignment.isLoading || managerRound.isLoading) {
    return <Skeleton variant="rounded" height={220} />;
  }
  if (!ctx) {
    return (
      <EmptyState title="לא שובצת לספירה" icon={<Inventory2Outlined />}>
        מנהל הספירה צריך לשבץ אותך לאזור בסבב פעיל. אחרי השיבוץ המסך הזה יתעדכן לבד תוך כמה שניות.
      </EmptyState>
    );
  }

  const warehouses = managerRound.data?.round.warehouses;
  return (
    <CountWorkspace
      key={`${ctx.roundId}-${ctx.warehouse}`}
      ctx={ctx}
      user={user}
      stats={managerRoundId === null ? assignment.data?.stats : undefined}
      warehouseOptions={warehouses}
      onWarehouse={(wh) => setSearch({ wh })}
    />
  );
}

type Panel = { kind: 'idle' } | { kind: 'item'; item: BlindItem } | { kind: 'result'; result: CountResult } | { kind: 'exception'; code: string };

function CountWorkspace({
  ctx,
  user,
  stats,
  warehouseOptions,
  onWarehouse,
}: {
  ctx: Ctx;
  user: User;
  stats?: MyAssignment['stats'];
  warehouseOptions?: string[];
  onWarehouse: (wh: string) => void;
}) {
  const whName = useWarehouseName();
  const online = useOnline();
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel>({ kind: 'idle' });
  const [notFound, setNotFound] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const dq = useDebounced(query.trim(), 250);
  const base = `/api/rounds/${ctx.roundId}`;
  const whParam = user.role === 'manager' ? `&warehouse=${encodeURIComponent(ctx.warehouse)}` : '';

  const list = useQuery({
    queryKey: ['search', ctx.roundId, ctx.warehouse, dq],
    queryFn: () => api.get<{ items: BlindItem[] }>(`${base}/search?q=${encodeURIComponent(dq)}${whParam}`).then((r) => r.items),
    enabled: panel.kind === 'idle' && (dq.length === 0 || dq.length >= 2),
    placeholderData: (prev) => prev,
  });

  const focusScan = () => window.setTimeout(() => scanRef.current?.focus(), 30);
  useEffect(() => {
    focusScan();
  }, []);

  const select = (item: BlindItem) => {
    setPanel({ kind: 'item', item });
    setNotFound(null);
    setQuery('');
  };

  const onScan = async (e: FormEvent) => {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    setScanError(null);
    try {
      const r = await api.get<{ item: BlindItem | null }>(`${base}/lookup?code=${encodeURIComponent(code)}${whParam}`);
      if (r.item) return select(r.item);
      const s = await api.get<{ items: BlindItem[] }>(`${base}/search?q=${encodeURIComponent(code)}${whParam}`);
      if (s.items.length === 1) return select(s.items[0]!);
      setPanel({ kind: 'idle' });
      setNotFound(s.items.length === 0 ? code : null);
    } catch (err) {
      setNotFound(null);
      setScanError(err instanceof ApiError ? err.message : 'החיפוש נכשל');
    }
  };

  const blocked =
    ctx.status === 'paused'
      ? 'הסבב מושהה. אי אפשר לספור עד שהמנהל יחדש אותו.'
      : ctx.status === 'closed'
        ? 'הסבב נסגר. תודה!'
        : null;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: { xs: 2, md: 3 },
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px' },
        alignItems: 'start',
      }}
    >
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        {/* context strip */}
        <Stack direction="row" flexWrap="wrap" alignItems="center" columnGap={2} rowGap={1}>
          <Typography variant="h2" component="h1" sx={{ marginInlineEnd: 'auto' }}>
            {whName(ctx.warehouse)} <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>· {ctx.warehouse}</Box>
          </Typography>
          {warehouseOptions && warehouseOptions.length > 1 && (
            <TextField select size="small" label="מחסן" value={ctx.warehouse} onChange={(e) => onWarehouse(e.target.value)} sx={{ minWidth: 160 }}>
              {warehouseOptions.map((w) => (
                <MenuItem key={w} value={w}>
                  {w} · {whName(w)}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Typography variant="body2">
            {ctx.roundName}
            {ctx.zoneName ? ` · אזור: ${ctx.zoneName}` : user.role === 'manager' ? ' · ללא אזור (מנהל)' : ''}
          </Typography>
          {stats && (
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
              ספרת {num(stats.items)} פריטים · {num(stats.actions)} פעולות
            </Typography>
          )}
        </Stack>

        {ctx.status === 'review' && (
          <Alert severity="info">הסבב בבקרה. אפשר לספור רק פריטים שהמנהל סימן לספירה חוזרת.</Alert>
        )}
        {blocked && <Alert severity="warning">{blocked}</Alert>}

        {/* scan bar: always on top so a scanner can fire at any moment */}
        <Paper variant="outlined" component="form" onSubmit={onScan} sx={{ p: 1.5, borderRadius: 3 }}>
          <TextField
            inputRef={scanRef}
            fullWidth
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setNotFound(null);
              if (e.target.value && panel.kind !== 'item') setPanel({ kind: 'idle' });
            }}
            placeholder="סרקו ברקוד או הקלידו מק״ט / תיאור"
            autoComplete="off"
            inputProps={{ 'aria-label': 'סריקה או חיפוש פריט', enterKeyHint: 'search', style: { fontSize: '1.15rem' } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <QrCodeScannerRounded sx={{ color: tokens.accent }} />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton aria-label="ניקוי" onClick={() => (setQuery(''), focusScan())} edge="end">
                    <CloseRounded />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
              sx: { minHeight: 60 },
            }}
          />
        </Paper>

        {scanError && <Alert severity="error">{scanError}</Alert>}
        {notFound && (
          <Alert
            severity="warning"
            icon={<ReportProblemOutlined />}
            action={
              <Button color="inherit" onClick={() => setPanel({ kind: 'exception', code: notFound })} disabled={ctx.status !== 'open'}>
                הוספת פריט חריג
              </Button>
            }
          >
            לא נמצא פריט עם "{notFound}" במחסן {ctx.warehouse}.
          </Alert>
        )}

        {panel.kind === 'item' && (
          <ItemEntry
            key={panel.item.itemCode}
            ctx={ctx}
            item={panel.item}
            online={online}
            disabled={!!blocked || (ctx.status === 'review' && !panel.item.recountRequested)}
            warehouseParam={user.role === 'manager' ? ctx.warehouse : undefined}
            onCancel={() => (setPanel({ kind: 'idle' }), focusScan())}
            onSaved={(result) => {
              setPanel({ kind: 'result', result });
              void qc.invalidateQueries({ queryKey: ['my-actions', ctx.roundId] });
              void qc.invalidateQueries({ queryKey: ['my-assignment'] });
              void qc.invalidateQueries({ queryKey: ['search', ctx.roundId] });
              focusScan();
            }}
          />
        )}

        {panel.kind === 'result' && (
          <ResultCard
            result={panel.result}
            onAgain={() =>
              select({
                warehouse: panel.result.warehouse,
                itemCode: panel.result.itemCode,
                itemName: panel.result.itemName,
                barcodes: [],
                counted: true,
                recountRequested: panel.result.type === 'recount',
              })
            }
            onNext={() => (setPanel({ kind: 'idle' }), focusScan())}
          />
        )}

        {panel.kind === 'exception' && (
          <ExceptionForm
            ctx={ctx}
            initialCode={panel.code}
            online={online}
            warehouseParam={user.role === 'manager' ? ctx.warehouse : undefined}
            onDone={() => (setPanel({ kind: 'idle' }), setNotFound(null), focusScan())}
          />
        )}

        {panel.kind === 'idle' && !notFound && (
          <ItemList
            title={dq ? `תוצאות עבור "${dq}"` : 'פריטים במחסן'}
            hint={dq ? undefined : 'פריטים עם יתרה ב-SAP. פריטים שטרם נספרו מופיעים ראשונים. פריטים ביתרה אפס – דרך סריקה או חיפוש.'}
            loading={list.isLoading}
            items={list.data ?? []}
            onPick={select}
            onException={dq ? () => setPanel({ kind: 'exception', code: dq }) : undefined}
            canException={ctx.status === 'open'}
          />
        )}
      </Stack>

      <RecentActions ctx={ctx} user={user} />
    </Box>
  );
}

function ItemEntry({
  ctx,
  item,
  online,
  disabled,
  warehouseParam,
  onCancel,
  onSaved,
}: {
  ctx: Ctx;
  item: BlindItem;
  online: boolean;
  disabled: boolean;
  warehouseParam?: string;
  onCancel: () => void;
  onSaved: (r: CountResult) => void;
}) {
  const [qty, setQty] = useState('');
  // One id per intended action: retries after a network error reuse it, so the server never double-counts.
  const actionId = useRef(uuid());
  const qtyRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    qtyRef.current?.focus();
  }, []);

  const save = useMutation({
    mutationFn: () =>
      api.post<{ result: CountResult }>(`/api/rounds/${ctx.roundId}/counts`, {
        id: actionId.current,
        itemCode: item.itemCode,
        qty: Number(qty),
        ...(warehouseParam ? { warehouse: warehouseParam } : {}),
      }),
    onSuccess: (r) => onSaved(r.result),
  });

  const n = qty === '' ? NaN : Number(qty);
  const valid = Number.isInteger(n) && n >= 0 && n <= 1_000_000;
  const step = (d: number) => setQty(String(Math.max(0, (Number.isFinite(n) ? n : 0) + d)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && online && !disabled && !save.isPending) save.mutate();
  };

  return (
    <Paper variant="outlined" component="form" onSubmit={submit} sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction="row" alignItems="flex-start" spacing={2}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h2" sx={{ wordBreak: 'break-word' }}>
              {item.itemName}
            </Typography>
            <Typography sx={{ mt: 0.5, color: 'text.secondary' }}>
              מק״ט <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }} dir="ltr">{item.itemCode}</Box>
              {item.barcodes[0] && (
                <>
                  {' · '}ברקוד <span dir="ltr">{item.barcodes[0]}</span>
                </>
              )}
              {' · '}מחסן {item.warehouse}
            </Typography>
          </Box>
          <IconButton aria-label="ביטול בחירה" onClick={onCancel}>
            <CloseRounded />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {item.recountRequested && <Chip label="ספירה חוזרת" sx={{ bgcolor: tokens.warningTint, color: tokens.warning }} />}
          {item.counted && !item.recountRequested && (
            <Chip label="כבר נספר בסבב – כמות נוספת תתווסף לסה״כ" sx={{ bgcolor: tokens.accentTint, color: tokens.accent }} />
          )}
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="stretch">
          <Button variant="outlined" aria-label="הפחתה" onClick={() => step(-1)} sx={{ minWidth: 64 }} disabled={disabled}>
            <RemoveRounded />
          </Button>
          <TextField
            inputRef={qtyRef}
            label="כמות שספרתי (יחידות)"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 7))}
            disabled={disabled}
            fullWidth
            inputProps={{ inputMode: 'numeric', enterKeyHint: 'done', style: { fontSize: '2rem', fontWeight: 700, textAlign: 'center', paddingBlock: 10 } }}
          />
          <Button variant="outlined" aria-label="הוספה" onClick={() => step(1)} sx={{ minWidth: 64 }} disabled={disabled}>
            <AddRounded />
          </Button>
        </Stack>

        {save.error && (
          <Alert severity="error" action={save.error instanceof ApiError && save.error.isNetwork ? <Button color="inherit" onClick={() => save.mutate()}>נסו שוב</Button> : undefined}>
            {save.error instanceof ApiError ? save.error.message : 'השמירה נכשלה'}
          </Alert>
        )}

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!valid || !online || disabled || save.isPending}
          startIcon={save.isPending ? <CircularProgress size={20} color="inherit" /> : <CheckRounded />}
          sx={{ minHeight: 64, fontSize: '1.2rem' }}
        >
          {save.isPending ? 'שומר…' : !online ? 'אין חיבור – לא ניתן לשמור' : 'הוסף לספירה'}
        </Button>
        <Typography variant="body2" sx={{ textAlign: 'center' }}>
          יתרת SAP תוצג אחרי השמירה.
        </Typography>
      </Stack>
    </Paper>
  );
}

function ResultCard({ result, onAgain, onNext }: { result: CountResult; onAgain: () => void; onNext: () => void }) {
  const isRecount = result.type === 'recount';
  const tone = result.comparison === 'match' ? tokens.success : result.comparison === 'higher' ? tokens.warning : tokens.danger;
  return (
    <Paper
      variant="outlined"
      role="status"
      aria-live="polite"
      sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, borderColor: tone, borderWidth: 2 }}
    >
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: tokens.success }}>
          <CheckRounded />
          <Typography sx={{ fontWeight: 700 }}>
            {result.duplicate ? 'הפעולה כבר נשמרה קודם' : `נשמר: ${num(result.qty)} יח׳`} · {time(result.createdAt)}
          </Typography>
        </Stack>
        <Box>
          <Typography variant="h3">{result.itemName}</Typography>
          <Typography variant="body2">
            {result.itemCode}
          </Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 1.5 }}>
          <Metric label="יתרת SAP" value={num(result.sapQty)} />
          <Metric label={isRecount ? 'סה״כ בספירה חוזרת' : 'סה״כ נספר בסבב'} value={num(result.comparedQty)} />
          <Metric label="הפרש" value={signed(result.comparedQty - result.sapQty)} color={tone} />
        </Box>
        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
          <ComparisonChip value={result.comparison} size="medium" />
          {result.comparison !== 'match' && (
            <Typography variant="body2">אם יש ספק, ספרו שוב ושמרו כמות נוספת, או בטלו את הפעולה ברשימה.</Typography>
          )}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button variant="contained" size="large" onClick={onNext} sx={{ flex: 1 }}>
            פריט הבא
          </Button>
          <Button variant="outlined" size="large" startIcon={<ReplayRounded />} onClick={onAgain} sx={{ flex: 1 }}>
            להוסיף כמות לאותו פריט
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}


function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ bgcolor: tokens.canvas, borderRadius: 2, p: 1.5 }}>
      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.6rem', fontWeight: 700, color: color ?? 'text.primary', lineHeight: 1.3 }}>{value}</Typography>
    </Box>
  );
}

function ItemList({
  title,
  hint,
  items,
  loading,
  onPick,
  onException,
  canException,
}: {
  title: string;
  hint?: string;
  items: BlindItem[];
  loading: boolean;
  onPick: (i: BlindItem) => void;
  onException?: () => void;
  canException: boolean;
}) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${tokens.line}`, bgcolor: tokens.panel }}>
        <Typography variant="h4">{title}</Typography>
        {hint && <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{hint}</Typography>}
      </Box>
      {loading ? (
        <Stack spacing={1} sx={{ p: 2 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={48} />
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <EmptyState title="לא נמצאו פריטים">
          {onException && canException ? (
            <Button variant="outlined" onClick={onException} sx={{ mt: 1 }}>
              הפריט לא ב-SAP? הוספת פריט חריג
            </Button>
          ) : (
            'נסו מק״ט או ברקוד מלא.'
          )}
        </EmptyState>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {items.map((i) => (
            <Box component="li" key={`${i.warehouse}-${i.itemCode}`} sx={{ borderBottom: `1px solid ${tokens.line}`, '&:last-child': { borderBottom: 0 } }}>
              <ButtonBase
                onClick={() => onPick(i)}
                sx={{ width: '100%', justifyContent: 'flex-start', textAlign: 'start', px: 2, py: 1.5, gap: 2, '&:hover': { bgcolor: 'action.hover' } }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }} noWrap>
                    {i.itemName}
                  </Typography>
                  <Typography variant="body2">
                    {i.itemCode}
                  </Typography>
                </Box>
                {i.recountRequested ? (
                  <Chip size="small" label="ספירה חוזרת" sx={{ bgcolor: tokens.warningTint, color: tokens.warning }} />
                ) : i.counted ? (
                  <Chip size="small" label="נספר" sx={{ bgcolor: tokens.accentTint, color: tokens.accent }} />
                ) : null}
              </ButtonBase>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}

function ExceptionForm({
  ctx,
  initialCode,
  online,
  warehouseParam,
  onDone,
}: {
  ctx: Ctx;
  initialCode: string;
  online: boolean;
  warehouseParam?: string;
  onDone: () => void;
}) {
  const looksLikeBarcode = /^\d{8,14}$/.test(initialCode);
  const [form, setForm] = useState({
    code: looksLikeBarcode ? '' : initialCode,
    barcode: looksLikeBarcode ? initialCode : '',
    description: '',
    qty: '',
    notes: '',
  });
  const id = useRef(uuid());
  const save = useMutation({
    mutationFn: () =>
      api.post(`/api/rounds/${ctx.roundId}/exceptions`, {
        id: id.current,
        code: form.code || undefined,
        barcode: form.barcode || undefined,
        description: form.description,
        qty: Number(form.qty),
        notes: form.notes || undefined,
        ...(warehouseParam ? { warehouse: warehouseParam } : {}),
      }),
    onSuccess: onDone,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const valid = form.description.trim().length > 1 && /^\d+$/.test(form.qty) && Number(form.qty) > 0;

  return (
    <Paper
      variant="outlined"
      component="form"
      onSubmit={(e: FormEvent) => (e.preventDefault(), valid && online && save.mutate())}
      sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="h3">פריט חריג – לא קיים ב-SAP</Typography>
          <Typography variant="body2">הפריט יישמר רק במערכת הספירה ויעבור לבדיקת מנהל. לא ייווצר פריט ב-SAP.</Typography>
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField label="מק״ט (אם מופיע על המוצר)" value={form.code} onChange={set('code')} inputProps={{ dir: 'ltr' }} />
          <TextField label="ברקוד" value={form.barcode} onChange={set('barcode')} inputProps={{ dir: 'ltr', inputMode: 'numeric' }} />
        </Box>
        <TextField label="תיאור הפריט" required value={form.description} onChange={set('description')} autoFocus />
        <TextField
          label="כמות שנספרה"
          required
          value={form.qty}
          onChange={(e) => setForm({ ...form, qty: e.target.value.replace(/\D/g, '').slice(0, 7) })}
          inputProps={{ inputMode: 'numeric', style: { fontSize: '1.4rem', fontWeight: 700 } }}
        />
        <TextField label="הערות" value={form.notes} onChange={set('notes')} multiline minRows={2} />
        {save.error && <Alert severity="error">{save.error instanceof ApiError ? save.error.message : 'השמירה נכשלה'}</Alert>}
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5}>
          <Button size="large" onClick={onDone} sx={{ flex: 1 }}>
            ביטול
          </Button>
          <Button type="submit" size="large" variant="contained" disabled={!valid || !online || save.isPending} sx={{ flex: 2 }}>
            {save.isPending ? 'שומר…' : 'שמירת פריט חריג'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

const CANCEL_REASONS = ['נספר פעמיים', 'הוקלדה כמות שגויה', 'נבחר פריט שגוי'];

function RecentActions({ ctx, user }: { ctx: Ctx; user: User }) {
  const qc = useQueryClient();
  const actions = useQuery({
    queryKey: ['my-actions', ctx.roundId],
    queryFn: () => api.get<{ actions: MyAction[] }>(`/api/rounds/${ctx.roundId}/my-actions`).then((r) => r.actions),
  });
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/api/counts/${id}/cancel`, { reason }),
    onSuccess: () => {
      setCancelling(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['my-actions', ctx.roundId] });
      void qc.invalidateQueries({ queryKey: ['my-assignment'] });
    },
  });
  const canCancel = ctx.status === 'open' || user.role === 'manager';
  const visible = (actions.data ?? []).filter((a) => a.warehouse === ctx.warehouse);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', position: { md: 'sticky' }, top: { md: 88 } }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${tokens.line}`, bgcolor: tokens.panel }}>
        <Typography variant="h4">הפעולות שלי</Typography>
        <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
          כל פעולה נשמרת בשרת מיד. אפשר לצאת ולחזור בלי לאבד נתונים.
        </Typography>
      </Box>
      {actions.isLoading ? (
        <Stack spacing={1} sx={{ p: 2 }}>
          <Skeleton variant="rounded" height={44} />
          <Skeleton variant="rounded" height={44} />
        </Stack>
      ) : visible.length === 0 ? (
        <Typography variant="body2" sx={{ p: 2 }}>
          עוד לא נשמרו ספירות. סרקו פריט כדי להתחיל.
        </Typography>
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, maxHeight: { md: 'calc(100dvh - 220px)' }, overflowY: 'auto' }}>
          {visible.slice(0, 60).map((a) => {
            const isCancelled = a.status === 'cancelled';
            return (
              <Box component="li" key={a.id} sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${tokens.line}`, opacity: isCancelled ? 0.6 : 1 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography sx={{ fontWeight: 700, minWidth: 44, textAlign: 'center', fontSize: '1.1rem', textDecoration: isCancelled ? 'line-through' : 'none' }}>
                    {num(a.qty)}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 500, fontSize: '0.95rem' }} noWrap>
                      {a.itemName}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                      {time(a.createdAt)} · {TYPE_HE[a.type]}
                      {isCancelled ? ` · בוטל: ${a.cancelReason}` : ''}
                    </Typography>
                  </Box>
                  {!isCancelled && canCancel && cancelling !== a.id && (
                    <Button size="small" onClick={() => (setCancelling(a.id), setReason(''))} sx={{ color: tokens.inkMuted }}>
                      ביטול
                    </Button>
                  )}
                </Stack>
                {cancelling === a.id && (
                  <Stack spacing={1} sx={{ mt: 1.25 }}>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {CANCEL_REASONS.map((r) => (
                        <Chip key={r} label={r} onClick={() => setReason(r)} color={reason === r ? 'primary' : 'default'} variant={reason === r ? 'filled' : 'outlined'} />
                      ))}
                    </Stack>
                    <TextField size="small" label="סיבת ביטול" value={reason} onChange={(e) => setReason(e.target.value)} />
                    {cancel.error && <Alert severity="error">{cancel.error instanceof ApiError ? cancel.error.message : 'הביטול נכשל'}</Alert>}
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" color="error" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate(a.id)}>
                        לבטל את הפעולה
                      </Button>
                      <Button size="small" onClick={() => setCancelling(null)}>
                        חזרה
                      </Button>
                    </Stack>
                  </Stack>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}
