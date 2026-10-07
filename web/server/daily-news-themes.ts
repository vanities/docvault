// Daily News "themes" — selectable house styles whose guidance is injected into
// the edition's system prompt. A theme changes the VOICE only; it's appended
// AFTER the base prompt's hard constraints (use only the digest, never invent),
// so a playful style can't license fabricated facts.
//
// DAILY_NEWS_THEMES is the single source of truth: the engine reads the prompt
// text via getThemePrompt(), and GET /api/daily-news/themes serves {id,label}
// to the Settings dropdown — the frontend never hardcodes the list.

export interface DailyNewsTheme {
  id: string;
  label: string;
  /** Style guidance appended to the system prompt as the "house style". */
  prompt: string;
}

export const DAILY_NEWS_THEMES: DailyNewsTheme[] = [
  {
    id: 'standard',
    label: 'Newspaper of record',
    prompt:
      'measured and authoritative, in the neutral voice of a paper of record (think The Wall Street Journal): clear, precise, and free of hyperbole.',
  },
  {
    id: 'economist',
    label: 'The Economist',
    prompt:
      'analytical and globally framed, like The Economist: dry wit, a clear point of view in each section, and crisp topic sentences that lead with the argument.',
  },
  {
    id: 'brew',
    label: 'Morning Brew',
    prompt:
      'breezy, witty, and conversational, like Morning Brew: punchy subheads, short paragraphs, and the occasional tasteful emoji — informative but fun to read over coffee.',
  },
  {
    id: 'analyst',
    label: 'Equity research desk',
    prompt:
      'terse and structured, like a sell-side equity research note: lead with the takeaway, quantify everything, and call out risks first. Favor tight paragraphs over flourish.',
  },
  {
    id: 'tabloid',
    label: 'Tabloid',
    prompt:
      'bold and attention-grabbing, like a tabloid: punchy headlines and short, energetic sentences. Be sensational in TONE only — never exaggerate or invent the underlying facts.',
  },
  {
    id: 'noir',
    label: 'Noir detective',
    prompt:
      "a hard-boiled noir detective narrating the day's developments like a case file: first person, moody, and wry. Style only — every figure and name stays exact.",
  },
  {
    id: 'victorian',
    label: 'Victorian gazette',
    prompt:
      'an ornate Victorian broadsheet: formal, period diction and elaborate sentences — while keeping the facts modern and precise.',
  },
];

const BY_ID = new Map(DAILY_NEWS_THEMES.map((t) => [t.id, t]));

/** Style-guidance text for a theme id; falls back to the 'standard' voice. */
export function getThemePrompt(id: string | undefined): string {
  return (BY_ID.get(id ?? 'brew') ?? BY_ID.get('brew'))?.prompt ?? '';
}

/** {id,label} pairs for the Settings dropdown (real styles only — the sampler
 *  iterates this, so the 'cycle' meta-option is intentionally NOT included). */
export function listThemes(): Array<{ id: string; label: string }> {
  return DAILY_NEWS_THEMES.map(({ id, label }) => ({ id, label }));
}

/** The special "rotate through every style" pick. NOT a real theme — it's
 *  resolved per edition date by resolveTheme(), so a week of daily editions
 *  walks the whole set. Offered in Settings alongside the fixed styles. */
export const THEME_CYCLE = { id: 'cycle', label: 'Cycle — a different style each day' } as const;

/** Resolve a configured theme to a CONCRETE style id: a real id passes through;
 *  'cycle' rotates deterministically by date (so consecutive daily editions step
 *  through every style and a 7-day week covers all 7); anything unknown falls
 *  back to the 'brew' default. */
export function resolveTheme(configTheme: string | undefined, dateKey: string): string {
  if (configTheme && BY_ID.has(configTheme)) return configTheme;
  if (configTheme === THEME_CYCLE.id) {
    const ms = new Date(`${dateKey}T12:00:00`).getTime();
    const n = DAILY_NEWS_THEMES.length;
    if (!Number.isFinite(ms)) return DAILY_NEWS_THEMES[0].id;
    const dayNum = Math.floor(ms / 86_400_000); // whole days since epoch (local noon)
    return DAILY_NEWS_THEMES[((dayNum % n) + n) % n].id;
  }
  return 'brew';
}

// Visual-style descriptors for the optional headline image — kept parallel to
// the prose themes above so each edition's hero matches its voice.
const THEME_VISUALS: Record<string, string> = {
  standard: 'restrained documentary editorial photography, muted neutral tones, serious and clean',
  economist:
    'minimalist conceptual editorial illustration, bold flat shapes, limited palette with a single red accent',
  brew: 'playful modern flat illustration, bright friendly colors, energetic and approachable',
  analyst:
    'sleek financial aesthetic with abstract charts and market motifs, cool blues, crisp and professional',
  tabloid:
    'bold high-contrast collage, dramatic lighting, punchy saturated colors, sensational energy',
  noir: 'moody black-and-white film noir, deep shadows, rain-slicked streets, cinematic 1940s detective mood',
  victorian:
    'ornate 19th-century steel-engraving illustration, sepia tones, intricate cross-hatched linework',
};

/** Visual-style descriptor for a theme id (feeds the headline-image prompt). */
export function getThemeVisual(id: string | undefined): string {
  return THEME_VISUALS[id ?? 'brew'] ?? THEME_VISUALS.brew;
}
