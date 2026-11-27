import { useEffect, useRef } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import PrintRounded from '@mui/icons-material/PrintRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type ReportTable } from '../api/client';
import { dateTime, num, signed, STATUS_HE } from '../format';
import { useWarehouseName } from '../hooks';
import { tokens } from '../theme/theme';

/**
 * Printable report → PDF via the browser's "Save as PDF".
 * The browser does Hebrew shaping and RTL correctly, which server-side PDF libraries do not.
 */
export function PrintReportPage() {
  const { id, type } = useParams();
  const navigate = useNavigate();
  const whName = useWarehouseName();
  const printed = useRef(false);
  const q = useQuery({
    queryKey: ['report-data', id, type],
    queryFn: () => api.get<ReportTable>(`/api/rounds/${id}/report-data/${type}`),
  });

  useEffect(() => {
    if (!q.data || printed.current) return;
    printed.current = true;
    document.title = `${q.data.title} – ${q.data.round.name}`;
    // Let fonts and layout settle before opening the print dialog.
    void document.fonts.ready.then(() => window.setTimeout(() => window.print(), 300));
  }, [q.data]);

  if (q.isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress aria-label="טוען דוח" />
      </Box>
    );
  }
  if (q.error || !q.data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{q.error instanceof ApiError ? q.error.message : 'הדוח לא נטען'}</Alert>
      </Box>
    );
  }
  const r = q.data;
  const total = r.sections.reduce((s, x) => s + x.rows.length, 0);

  return (
    <Box className="print-root" sx={{ bgcolor: '#fff', minHeight: '100dvh' }}>
      <style>{PRINT_CSS}</style>

      <Stack
        className="no-print"
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'center' }}
        sx={{ position: 'sticky', top: 0, zIndex: 1, px: 3, py: 1.5, bgcolor: tokens.panel, borderBottom: `1px solid ${tokens.line}` }}
      >
        <Button startIcon={<ArrowForwardRounded />} onClick={() => navigate(`/rounds/${id}/close`)}>
          חזרה
        </Button>
        <Typography variant="body2" sx={{ flex: 1, color: 'text.primary' }}>
          בחלון ההדפסה בוחרים ביעד <b>"שמירה כ-PDF"</b> (Save as PDF) ולוחצים שמירה.
        </Typography>
        <Button variant="contained" startIcon={<PrintRounded />} onClick={() => window.print()}>
          שמירה כ-PDF / הדפסה
        </Button>
      </Stack>

      <Box className="sheet">
        <header className="report-head">
          <div>
            <h1>{r.title}</h1>
            <p>
              {r.round.name} · סבב #{r.round.id} · סטטוס: {STATUS_HE[r.round.status]}
            </p>
            <p>
              מחסנים: {r.round.warehouses.map((w) => `${w} ${whName(w)}`).join(', ')} · צילום מצב SAP: {dateTime(r.round.snapshotAt)}
            </p>
          </div>
          <div className="meta">
            <div>הופק: {dateTime(r.generatedAt)}</div>
            <div>{num(total)} שורות</div>
          </div>
        </header>

        {r.sections.map((sec) => (
          <section key={sec.name}>
            {r.sections.length > 1 && <h2>{sec.name}</h2>}
            {sec.rows.length === 0 ? (
              <p className="empty">אין נתונים בדוח הזה.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    {sec.columns.map((c) => (
                      <th key={c.key} className={c.numeric ? 'num' : undefined}>
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((row, i) => (
                    <tr key={i}>
                      {sec.columns.map((c) => {
                        const v = row[c.key];
                        const text =
                          v === null || v === undefined || v === ''
                            ? '—'
                            : c.numeric && typeof v === 'number'
                              ? c.key === 'diff'
                                ? signed(v)
                                : num(v)
                              : String(v);
                        const neg = c.key === 'diff' && typeof v === 'number' && v < 0;
                        const pos = c.key === 'diff' && typeof v === 'number' && v > 0;
                        return (
                          <td key={c.key} className={[c.numeric ? 'num' : '', neg ? 'neg' : '', pos ? 'pos' : ''].join(' ').trim() || undefined}>
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </Box>
    </Box>
  );
}

const PRINT_CSS = `
.sheet { max-width: 1200px; margin: 0 auto; padding: 24px; color: ${tokens.ink}; }
.report-head { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start;
  border-bottom: 2px solid ${tokens.ink}; padding-bottom: 12px; margin-bottom: 16px; }
.report-head h1 { font-size: 22px; margin: 0 0 4px; }
.report-head p { margin: 2px 0; font-size: 12.5px; color: ${tokens.inkMuted}; }
.report-head .meta { text-align: left; font-size: 12px; color: ${tokens.inkMuted}; white-space: nowrap; }
.sheet h2 { font-size: 16px; margin: 20px 0 8px; }
.sheet .empty { color: ${tokens.inkMuted}; font-size: 13px; }
.sheet table { width: 100%; border-collapse: collapse; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.sheet th { background: ${tokens.panel}; font-weight: 600; text-align: right; padding: 6px 8px; border-bottom: 1px solid ${tokens.line}; }
.sheet td { padding: 5px 8px; border-bottom: 1px solid ${tokens.line}; vertical-align: top; }
.sheet th.num, .sheet td.num { text-align: left; white-space: nowrap; }
.sheet td.neg { color: ${tokens.danger}; font-weight: 600; }
.sheet td.pos { color: ${tokens.warning}; font-weight: 600; }
.sheet tbody tr:nth-child(even) td { background: #FAFBFC; }
@page { size: A4 landscape; margin: 12mm 10mm; }
@media print {
  .no-print { display: none !important; }
  body { background: #fff !important; }
  .sheet { max-width: none; padding: 0; }
  .sheet thead { display: table-header-group; }
  .sheet tr { break-inside: avoid; }
  .sheet th, .sheet tbody tr:nth-child(even) td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
