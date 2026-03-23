import {
  Building2,
  User,
  Tractor,
  LayoutGrid,
  Briefcase,
  Home,
  Store,
  Factory,
  Landmark,
  ShoppingBag,
  Truck,
  Wrench,
  Coffee,
  Leaf,
  Heart,
  Star,
  Zap,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import type { EntityConfig } from '../hooks/useFileSystemServer';

// =============================================================================
// ICON DEFINITIONS
// =============================================================================

// Icon mapping — string key to Lucide component
export const ICON_MAP: Record<string, LucideIcon> = {
  user: User,
  building: Building2,
  briefcase: Briefcase,
  home: Home,
  store: Store,
  factory: Factory,
  landmark: Landmark,
  shopping: ShoppingBag,
  truck: Truck,
  tractor: Tractor,
  wrench: Wrench,
  coffee: Coffee,
  leaf: Leaf,
  heart: Heart,
  star: Star,
  zap: Zap,
  globe: Globe,
};

// Available icons for entity picker UI
export const AVAILABLE_ICONS: { id: string; icon: LucideIcon; label: string }[] = [
  { id: 'user', icon: User, label: 'Person' },
  { id: 'building', icon: Building2, label: 'Building' },
  { id: 'briefcase', icon: Briefcase, label: 'Briefcase' },
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'store', icon: Store, label: 'Store' },
  { id: 'factory', icon: Factory, label: 'Factory' },
  { id: 'landmark', icon: Landmark, label: 'Bank' },
  { id: 'shopping', icon: ShoppingBag, label: 'Shopping' },
  { id: 'truck', icon: Truck, label: 'Truck' },
  { id: 'tractor', icon: Tractor, label: 'Farm' },
  { id: 'wrench', icon: Wrench, label: 'Tools' },
  { id: 'coffee', icon: Coffee, label: 'Cafe' },
  { id: 'leaf', icon: Leaf, label: 'Nature' },
  { id: 'heart', icon: Heart, label: 'Health' },
  { id: 'star', icon: Star, label: 'Star' },
  { id: 'zap', icon: Zap, label: 'Energy' },
  { id: 'globe', icon: Globe, label: 'Global' },
];

// Default icons for known entities (used if no icon is set in config)
export const DEFAULT_ENTITY_ICONS: Record<string, string> = {
  all: 'grid',
  personal: 'user',
};

// Get the icon component for an entity
export function getEntityIcon(entity: EntityConfig): LucideIcon {
  if (entity.icon && ICON_MAP[entity.icon]) {
    return ICON_MAP[entity.icon];
  }
  const defaultIcon = DEFAULT_ENTITY_ICONS[entity.id];
  if (defaultIcon && ICON_MAP[defaultIcon]) {
    return ICON_MAP[defaultIcon];
  }
  return Building2;
}

// Render an entity icon as a JSX element (used by Sidebar)
export function renderEntityIcon(entity: EntityConfig, className: string) {
  const iconKey =
    entity.id === 'all' ? 'grid' : entity.icon || DEFAULT_ENTITY_ICONS[entity.id] || 'building';
  switch (iconKey) {
    case 'grid':
      return <LayoutGrid className={className} />;
    default: {
      const Icon = ICON_MAP[iconKey] || Building2;
      return <Icon className={className} />;
    }
  }
}

// =============================================================================
// COLOR DEFINITIONS
// =============================================================================

// Sidebar color map (dark theme with glow effects)
export const SIDEBAR_COLOR_MAP: Record<
  string,
  { accent: string; glow: string; bg: string; text: string }
> = {
  blue: {
    accent: 'bg-blue-500/15',
    glow: 'glow-blue',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
  },
  green: {
    accent: 'bg-emerald-500/15',
    glow: 'glow-emerald',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
  },
  amber: {
    accent: 'bg-amber-500/15',
    glow: 'glow-amber',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
  },
  purple: {
    accent: 'bg-purple-500/15',
    glow: 'glow-purple',
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
  },
  pink: {
    accent: 'bg-pink-500/15',
    glow: 'glow-purple',
    bg: 'bg-pink-500/10',
    text: 'text-pink-400',
  },
  red: { accent: 'bg-red-500/15', glow: 'glow-red', bg: 'bg-red-500/10', text: 'text-red-400' },
  gray: {
    accent: 'bg-surface-400/20',
    glow: '',
    bg: 'bg-surface-400/10',
    text: 'text-surface-800',
  },
};

// EntitySwitcher color map (light theme with borders and rings)
export const ENTITY_COLOR_MAP: Record<
  string,
  { bg: string; border: string; text: string; ring: string }
> = {
  blue: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    ring: 'ring-blue-500',
  },
  green: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    ring: 'ring-green-500',
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    ring: 'ring-amber-500',
  },
  purple: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    ring: 'ring-purple-500',
  },
  pink: {
    bg: 'bg-pink-50',
    border: 'border-pink-200',
    text: 'text-pink-700',
    ring: 'ring-pink-500',
  },
  red: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    ring: 'ring-red-500',
  },
  gray: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-700',
    ring: 'ring-gray-500',
  },
};

// Settings color map (dark theme with borders and rings)
export const SETTINGS_COLOR_MAP: Record<
  string,
  { bg: string; border: string; text: string; ring: string }
> = {
  blue: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    ring: 'ring-blue-500',
  },
  green: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500',
  },
  amber: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    ring: 'ring-amber-500',
  },
  purple: {
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/30',
    text: 'text-purple-400',
    ring: 'ring-purple-500',
  },
  pink: {
    bg: 'bg-pink-500/15',
    border: 'border-pink-500/30',
    text: 'text-pink-400',
    ring: 'ring-pink-500',
  },
  red: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    ring: 'ring-red-500',
  },
};

// Available color names for entity color picker
export const AVAILABLE_COLORS = ['blue', 'green', 'amber', 'purple', 'pink', 'red'];
