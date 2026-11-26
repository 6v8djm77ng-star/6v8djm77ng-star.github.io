import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type FreezeCheck, type Round } from '../../api/client';
import { dateTime, num, signed } from '../../format';
import { useMeta } from '../../hooks';
import { tokens } from '../../theme/theme';
import type { RoundData } from '../RoundPage';
import { Section } from './OverviewTab';

export function CloseTab({ data }: { data: RoundData }) {
  const { round } = data;
  return (
    <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1.3fr) minmax(0,1fr)' }, alignItems: 'start' }}>
      <Stack spacing={2.5} sx={{ minWidth: 0 }}>
        <FreezeAndClose round={round} />
        <SendToSap round={round} />
      </Stack>
      <Reports roundId={round.id} />
    </Box>
  );
}

function FreezeAndClose({ round }: { round: Round }) {
  const qc = useQueryClient();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');
  const check = useQuery({
    queryKey: ['freeze', round.id],
    queryFn: () => api.get<FreezeCheck>(`/api/rounds/${round.id}/freeze-check`),
    enabled: false,
  });
  const close = useMutation({
    mutationFn: () => api.post<{ round: Round }>(`/api/rounds/${round.id}/status`, { status: 'closed', acknowledgeMovements: ack, note: note || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['round', round.id] });
      void qc.invalidateQueries({ queryKey: ['rounds'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'FREEZE_VIOLATION') qc.setQueryData(['freeze', round.id], e.details as FreezeCheck);
    },
  });
  const reopen = useMutation({
    mutationFn: () => api.post(`/api/rounds/${round.id}/status`, { status: 'review' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['round', round.id] }),
  });
  const fc = check.data;

  return (
    <Section title="בקרת הקפאה וסגירת הסבב">
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2">
          המערכת בודקת ב-SAP אם נרשמה תנועת מלאי כלשהי במחסנים {round.warehouses.join(', ')} מאז צילום המצב ({dateTime(round.snapshotAt)}).
          תנועה כזו אומרת שההשוואה ליתרת SAP כבר לא מדויקת.
        </Typography>
        <Box>
          <Button variant="outlined" onClick={() => void check.refetch()} disabled={check.isFetching}>
            {check.isFetching ? 'בודק מול SAP…' : 'בדיקת הקפאה עכשיו'}
          </Button>
        </Box>
        {check.error && <Alert severity="error">{check.error instanceof ApiError ? check.error.message : 'הבדיקה נכשלה'}</Alert>}
        {fc && fc.clean && <Alert severity="success">ההקפאה נשמרה: אין תנועות מלאי מאז פתיחת הסבב. (נבדק {dateTime(fc.checkedAt)})</Alert>}
        {fc && !fc.clean && (
          <>
            <Alert severity="error">נמצאו {fc.movements.length} תנועות מלאי בזמן הסבב. ההפרשים בפריטים האלה לא אמינים.</Alert>
            <Box sx={{ overflowX: 'auto', border: `1px solid ${tokens.line}`, borderRadius: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>מחסן</TableCell>
                    <TableCell>מק״ט</TableCell>
                    <TableCell>תיאור</TableCell>
                    <TableCell align="left">כמות</TableCell>
                    <TableCell>סוג מסמך / אסמכתא</TableCell>
                    <TableCell>תאריך</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fc.movements.map((m) => (
                    <TableRow key={m.transNum}>
                      <TableCell>{m.warehouse}</TableCell>
                      <TableCell>{m.itemCode}</TableCell>
                      <TableCell>{m.itemName}</TableCell>
                      <TableCell align="left" sx={{ fontWeight: 700 }}>{signed(m.qty)}</TableCell>
                      <TableCell>{m.transType} / {m.baseRef ?? '—'}</TableCell>
                      <TableCell>{dateTime(m.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </>
        )}

        {round.status === 'review' && (
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="h4">סגירת הסבב</Typography>
            <Typography variant="body2">אחרי הסגירה אי אפשר לספור או לשנות אישורים. אפשר להחזיר לבקרה כל עוד הסבב לא נשלח ל-SAP.</Typography>
            {fc && !fc.clean && (
              <>
                <FormControlLabel
                  control={<Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />}
                  label="בדקתי את התנועות ואני מאשר לסגור בכל זאת"
                />
                <TextField size="small" label="הסבר (נשמר ביומן)" value={note} onChange={(e) => setNote(e.target.value)} />
              </>
            )}
            {close.error && !(close.error instanceof ApiError && close.error.code === 'FREEZE_VIOLATION') && (
              <Alert severity="error">{close.error instanceof ApiError ? close.error.message : 'הסגירה נכשלה'}</Alert>
            )}
            <Box>
              <Button
                variant="contained"
                onClick={() => close.mutate()}
                disabled={close.isPending || (fc && !fc.clean && (!ack || !note.trim())) || false}
              >
                {close.isPending ? 'סוגר…' : 'סגירת הסבב'}
              </Button>
            </Box>
          </Stack>
        )}
        {round.status === 'open' || round.status === 'paused' ? (
          <Alert severity="info">כדי לסגור, קודם מעבירים את הסבב לבקרה (כפתור "סיום ספירה ומעבר לבקרה" למעלה).</Alert>
        ) : null}
        {round.status === 'closed' && !round.sapSentAt && (
          <Box>
            <Button onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              החזרת הסבב לבקרה
            </Button>
          </Box>
        )}
      </Stack>
    </Section>
  );
}

function SendToSap({ round }: { round: Round }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const [confirm, setConfirm] = useState(false);
  const preview = useQuery({
    queryKey: ['sap-preview', round.id],
    queryFn: () => api.get<{ lines: number; uncountedWithStock: number; negative: number }>(`/api/rounds/${round.id}/sap-preview`),
    enabled: round.status === 'closed' && !round.sapSentAt,
  });
  const send = useMutation({
    mutationFn: () => api.post<{ docEntry: number; docNum: number; lines: number }>(`/api/rounds/${round.id}/send-to-sap`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['round', round.id] });
      void qc.invalidateQueries({ queryKey: ['rounds'] });
    },
  });

  return (
    <Section title="יצירת מסמך ספירת מלאי ב-SAP">
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2">
          יוצר ב-SAP מסמך ספירת מלאי (Inventory Counting) עם הכמות הסופית לכל פריט: הכמות שאושרה, ואם אין אישור, סך הספירה.
          המסמך לא משנה מלאי. התאמת המלאי נעשית ב-SAP עצמו, ידנית, ע״י מנהל מורשה.
        </Typography>
        {meta?.sapMode === 'mock' && <Alert severity="warning">מצב הדגמה: שום מסמך לא ייווצר ב-SAP אמיתי.</Alert>}
        {round.sapSentAt ? (
          <Alert severity="success">
            נשלח ל-SAP · מסמך ספירה {round.sapDocNum} (DocEntry {round.sapDocEntry}) · {dateTime(round.sapSentAt)}
          </Alert>
        ) : round.status !== 'closed' ? (
          <Alert severity="info">אפשר לשלוח ל-SAP רק אחרי סגירת הסבב.</Alert>
        ) : (
          <>
            {preview.data && (
              <Stack spacing={1}>
                <Typography>
                  <b>{num(preview.data.lines)}</b> שורות יישלחו למסמך.
                </Typography>
                {preview.data.uncountedWithStock > 0 && (
                  <Alert severity="warning">
                    {num(preview.data.uncountedWithStock)} פריטים עם יתרה ב-SAP לא נספרו ולא אושרו. הם לא ייכללו במסמך, ו-SAP ישאיר אותם כפי שהם.
                  </Alert>
                )}
                {preview.data.negative > 0 && (
                  <Alert severity="error">{num(preview.data.negative)} פריטים עם כמות שלילית. יש לאשר להם כמות לפני השליחה.</Alert>
                )}
              </Stack>
            )}
            <FormControlLabel
              control={<Checkbox checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />}
              label="בדקתי את דוח ההפרשים ואני מאשר ליצור את המסמך ב-SAP"
            />
            {send.error && <Alert severity="error">{send.error instanceof ApiError ? send.error.message : 'השליחה נכשלה'}</Alert>}
            <Box>
              <Button
                variant="contained"
                onClick={() => send.mutate()}
                disabled={!confirm || send.isPending || !preview.data || preview.data.negative > 0 || preview.data.lines === 0}
              >
                {send.isPending ? 'יוצר מסמך ב-SAP…' : 'יצירת מסמך ספירה ב-SAP'}
              </Button>
            </Box>
          </>
        )}
      </Stack>
    </Section>
  );
}

function Reports({ roundId }: { roundId: number }) {
  const meta = useMeta();
  return (
    <Section title="דוחות Excel">
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {Object.entries(meta?.reports ?? {}).map(([key, label]) => (
          <Box component="li" key={key} sx={{ borderBottom: `1px solid ${tokens.line}`, '&:last-child': { borderBottom: 0 } }}>
            <Button
              component="a"
              href={`/api/rounds/${roundId}/reports/${key}`}
              download
              fullWidth
              startIcon={<FileDownloadOutlined />}
              sx={{ justifyContent: 'flex-start', px: 2, py: 1.25, borderRadius: 0, color: 'text.primary', fontWeight: 500 }}
            >
              {label}
            </Button>
          </Box>
        ))}
      </Box>
    </Section>
  );
}
