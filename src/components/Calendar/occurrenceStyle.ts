// Shared color/label resolution for calendar occurrences (chips, dots,
// agenda rows). Coloring rule: an entity-tagged occurrence wears its
// entity's color (the same SETTINGS_COLOR_MAP classes the sidebar uses);
// untagged occurrences fall back to a kind color — birthday rose, task
// amber, event blue. Entity color = ownership signal; kind color =
// what-is-it signal.

import { SETTINGS_COLOR_MAP } from '../../utils/entityDisplay';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type { Occurrence } from './types';

export interface OccurrenceStyle {
  bg: string;
  border: string;
  text: string;
  dot: string; // solid dot for the mobile density view
}

const KIND_STYLE: Record<Occurrence['kind'], OccurrenceStyle> = {
  birthday: {
    bg: 'bg-rose-500/15',
    border: 'border-rose-500/30',
    text: 'text-rose-400',
    dot: 'bg-rose-400',
  },
  task: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
  },
  event: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
  },
};

const ENTITY_DOT: Record<string, string> = {
  blue: 'bg-blue-400',
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  purple: 'bg-purple-400',
  pink: 'bg-pink-400',
  red: 'bg-red-400',
};

export function occurrenceStyle(occ: Occurrence, entities: EntityConfig[]): OccurrenceStyle {
  if (occ.entityId) {
    const entity = entities.find((e) => e.id === occ.entityId);
    const mapped = entity && SETTINGS_COLOR_MAP[entity.color];
    if (entity && mapped) {
      return { ...mapped, dot: ENTITY_DOT[entity.color] ?? 'bg-surface-500' };
    }
  }
  return KIND_STYLE[occ.kind];
}

export function occurrenceLabel(occ: Occurrence): string {
  return occ.kind === 'birthday' && occ.age !== undefined
    ? `${occ.title} · turns ${occ.age}`
    : occ.title;
}
