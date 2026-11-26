import { createTheme, alpha } from '@mui/material/styles';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';

/**
 * Design tokens. Operate surface: restrained, high-contrast, built for tablets in a bright warehouse.
 * Accent is reserved for primary actions, selection and state; never decoration.
 */
export const tokens = {
  ink: '#16202A',
  inkMuted: '#4A5866',
  inkSubtle: '#6B7885',
  canvas: '#F4F6F8',
  surface: '#FFFFFF',
  panel: '#EBEFF3',
  line: '#D5DCE3',
  accent: '#134E6F',
  accentStrong: '#0D3B55',
  accentTint: '#E3EEF4',
  success: '#1E7B4A',
  successTint: '#E4F3EA',
  warning: '#9A5800',
  warningTint: '#FBF0DF',
  danger: '#B42318',
  dangerTint: '#FBE9E7',
  focus: '#2B7FB0',
} as const;

export const rtlCache = createCache({ key: 'muirtl', stylisPlugins: [prefixer, rtlPlugin] });

export const theme = createTheme({
  direction: 'rtl',
  palette: {
    mode: 'light',
    primary: { main: tokens.accent, dark: tokens.accentStrong, light: tokens.accentTint, contrastText: '#fff' },
    success: { main: tokens.success, light: tokens.successTint },
    warning: { main: tokens.warning, light: tokens.warningTint },
    error: { main: tokens.danger, light: tokens.dangerTint },
    text: { primary: tokens.ink, secondary: tokens.inkMuted, disabled: '#8A96A2' },
    background: { default: tokens.canvas, paper: tokens.surface },
    divider: tokens.line,
    action: { hover: alpha(tokens.accent, 0.06), selected: alpha(tokens.accent, 0.1) },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Heebo", "Segoe UI", "Arial", sans-serif',
    fontSize: 15,
    h1: { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h2: { fontSize: '1.45rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h3: { fontSize: '1.2rem', fontWeight: 600 },
    h4: { fontSize: '1.05rem', fontWeight: 600 },
    subtitle1: { fontWeight: 500 },
    body2: { color: tokens.inkMuted },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
    overline: { letterSpacing: 0, textTransform: 'none', fontWeight: 600, fontSize: '0.8rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontVariantNumeric: 'tabular-nums',
          WebkitTapHighlightColor: 'transparent',
          caretColor: tokens.accent,
          scrollbarColor: `${tokens.line} transparent`,
        },
        '::selection': { background: alpha(tokens.accent, 0.18), color: tokens.ink },
        ':focus-visible': { outline: `3px solid ${alpha(tokens.focus, 0.55)}`, outlineOffset: 2 },
        a: { color: tokens.accent, textUnderlineOffset: '0.2em' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10, paddingInline: 18, minHeight: 40 },
        sizeLarge: { minHeight: 56, fontSize: '1.1rem', paddingInline: 24 },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: tokens.line } },
    },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: 12 } } },
    MuiTextField: { defaultProps: { variant: 'outlined' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: tokens.surface },
        notchedOutline: { borderColor: tokens.line },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 8 } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: tokens.inkMuted, backgroundColor: tokens.panel, whiteSpace: 'nowrap' },
        root: { borderColor: tokens.line, paddingBlock: 10 },
      },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 48 } } },
    MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' } },
    MuiTooltip: { styleOverrides: { tooltip: { fontSize: '0.85rem' } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 10, alignItems: 'center' } } },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 8, borderRadius: 4, backgroundColor: tokens.panel }, bar: { borderRadius: 4 } },
    },
  },
});
