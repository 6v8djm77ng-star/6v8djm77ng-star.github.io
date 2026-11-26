import type { ReactNode } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import type { Comparison, ItemState, RoundStatus } from '../api/client';
import { CMP_HE, STATE_HE, STATUS_HE } from '../format';
import { tokens } from '../theme/theme';

const CMP_STYLE: Record<Comparison, { fg: string; bg: string; icon: ReactNode }> = {
  match: { fg: tokens.success, bg: tokens.successTint, icon: <CheckCircleOutlineRounded fontSize="small" /> },
  higher: { fg: tokens.warning, bg: tokens.warningTint, icon: <ArrowUpwardRounded fontSize="small" /> },
  lower: { fg: tokens.danger, bg: tokens.dangerTint, icon: <ArrowDownwardRounded fontSize="small" /> },
};

export function ComparisonChip({ value, size = 'small' }: { value: Comparison | null; size?: 'small' | 'medium' }) {
  if (!value) return <Typography variant="body2">—</Typography>;
  const s = CMP_STYLE[value];
  return (
    <Chip
      size={size}
      icon={<Box component="span" sx={{ display: 'flex', color: `${s.fg} !important` }}>{s.icon}</Box>}
      label={CMP_HE[value]}
      sx={{ color: s.fg, bgcolor: s.bg }}
    />
  );
}

const STATUS_COLOR: Record<RoundStatus, { fg: string; bg: string }> = {
  open: { fg: tokens.success, bg: tokens.successTint },
  paused: { fg: tokens.warning, bg: tokens.warningTint },
  review: { fg: tokens.accent, bg: tokens.accentTint },
  closed: { fg: tokens.inkMuted, bg: tokens.panel },
};

export function RoundStatusChip({ status }: { status: RoundStatus }) {
  const c = STATUS_COLOR[status];
  return <Chip size="small" label={STATUS_HE[status]} sx={{ color: c.fg, bgcolor: c.bg }} />;
}

const STATE_COLOR: Record<ItemState, { fg: string; bg: string }> = {
  not_counted: { fg: tokens.inkMuted, bg: tokens.panel },
  counted: { fg: tokens.accent, bg: tokens.accentTint },
  recount: { fg: tokens.warning, bg: tokens.warningTint },
  approved: { fg: tokens.success, bg: tokens.successTint },
};

export function ItemStateChip({ state }: { state: ItemState }) {
  const c = STATE_COLOR[state];
  return <Chip size="small" label={STATE_HE[state]} sx={{ color: c.fg, bgcolor: c.bg }} />;
}

export function OnlineBadge({ online }: { online: boolean }) {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      role="status"
      aria-live="polite"
      sx={{ color: online ? tokens.success : tokens.danger, fontWeight: 600, fontSize: '0.875rem' }}
    >
      {online ? <CloudDoneOutlined fontSize="small" /> : <CloudOffOutlined fontSize="small" />}
      <span>{online ? 'מחובר' : 'אין חיבור'}</span>
    </Stack>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 6, px: 2, textAlign: 'center', color: 'text.secondary' }}>
      {icon && <Box sx={{ color: tokens.inkSubtle, '& svg': { fontSize: 40 } }}>{icon}</Box>}
      <Typography variant="h4" color="text.primary">
        {title}
      </Typography>
      {children && <Typography variant="body2" sx={{ maxWidth: 420 }}>{children}</Typography>}
    </Stack>
  );
}

/** Label + value pair used in detail panels. */
export function Field({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: strong ? 700 : 500, fontSize: strong ? '1.35rem' : '1rem' }}>{children}</Typography>
    </Box>
  );
}
