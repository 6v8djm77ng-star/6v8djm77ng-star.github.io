import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type Round } from '../api/client';
import { useMeta } from '../hooks';

export function RoundNewPage() {
  const meta = useMeta();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short' }).format(new Date());
  const [name, setName] = useState(`ספירת מלאי ${today}`);
  const [warehouses, setWarehouses] = useState<string[]>(meta?.warehouses.map((w) => w.code) ?? []);
  const [zones, setZones] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () =>
      api.post<{ round: Round }>('/api/rounds', {
        name,
        warehouses,
        zones: warehouses.flatMap((w) => (zones[w] ?? []).map((n) => ({ warehouse: w, name: n }))),
      }),
    onSuccess: ({ round }) => {
      void qc.invalidateQueries({ queryKey: ['rounds'] });
      navigate(`/rounds/${round.id}/team`);
    },
  });

  const addZone = (wh: string) => {
    const v = (draft[wh] ?? '').trim();
    if (!v || zones[wh]?.includes(v)) return;
    setZones({ ...zones, [wh]: [...(zones[wh] ?? []), v] });
    setDraft({ ...draft, [wh]: '' });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && warehouses.length) create.mutate();
  };

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        פתיחת סבב ספירה
      </Typography>
      <Typography variant="body2" sx={{ mb: 3 }}>
        בפתיחה המערכת שומרת את יתרות SAP באותו רגע. כל ההשוואות בסבב נעשות מול צילום המצב הזה.
      </Typography>
      <Paper variant="outlined" component="form" onSubmit={submit} sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
        <Stack spacing={3}>
          <TextField label="שם הסבב" value={name} onChange={(e) => setName(e.target.value)} required inputProps={{ maxLength: 100 }} />

          <Box>
            <Typography variant="h4" sx={{ mb: 1 }}>
              מחסנים
            </Typography>
            <FormGroup row>
              {meta?.warehouses.map((w) => (
                <FormControlLabel
                  key={w.code}
                  control={
                    <Checkbox
                      checked={warehouses.includes(w.code)}
                      onChange={(e) =>
                        setWarehouses(e.target.checked ? [...warehouses, w.code] : warehouses.filter((x) => x !== w.code))
                      }
                    />
                  }
                  label={`${w.code} · ${w.name}`}
                />
              ))}
            </FormGroup>
          </Box>

          <Box>
            <Typography variant="h4">אזורים פיזיים</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              כל סופר משובץ לאזור אחד. אפשר להוסיף אזורים גם אחרי הפתיחה.
            </Typography>
            <Stack spacing={2.5}>
              {warehouses.map((wh) => (
                <Box key={wh}>
                  <Typography sx={{ fontWeight: 600, mb: 1 }}>
                    מחסן {wh} · {meta?.warehouses.find((w) => w.code === wh)?.name}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                    {(zones[wh] ?? []).map((z) => (
                      <Chip key={z} label={z} onDelete={() => setZones({ ...zones, [wh]: zones[wh]!.filter((x) => x !== z) })} />
                    ))}
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ maxWidth: 420 }}>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="לדוגמה: מדפים A–C"
                      value={draft[wh] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [wh]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addZone(wh);
                        }
                      }}
                      inputProps={{ 'aria-label': `אזור חדש במחסן ${wh}`, maxLength: 60 }}
                    />
                    <IconButton aria-label="הוספת אזור" onClick={() => addZone(wh)} color="primary">
                      <AddRounded />
                    </IconButton>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Box>

          <Alert severity="warning">
            לפני הפתיחה: לוודא שאין קבלות, ניפוקים או העברות במחסנים שנבחרו עד סוף הספירה. בסגירה המערכת תבדוק זאת מול SAP.
          </Alert>

          {create.error && <Alert severity="error">{create.error instanceof ApiError ? create.error.message : 'הפתיחה נכשלה'}</Alert>}

          <Stack direction="row" spacing={1.5} justifyContent="flex-end">
            <Button onClick={() => navigate('/')}>ביטול</Button>
            <Button type="submit" variant="contained" size="large" disabled={!name.trim() || !warehouses.length || create.isPending}>
              {create.isPending ? 'קורא יתרות מ-SAP…' : 'פתיחת הסבב'}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
