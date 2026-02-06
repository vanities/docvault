import { Building2, User, Tractor } from 'lucide-react';
import type { Entity } from '../../types';
import { ENTITIES } from '../../config';

interface EntitySwitcherProps {
  selectedEntity: Entity;
  onEntityChange: (entity: Entity) => void;
}

const ENTITY_ICONS: Record<Entity, React.ComponentType<{ className?: string }>> = {
  personal: User,
  'am2-llc': Building2,
  'manna-llc': Tractor,
};

const ENTITY_COLORS: Record<Entity, { bg: string; border: string; text: string; ring: string }> = {
  personal: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    ring: 'ring-blue-500',
  },
  'am2-llc': {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    ring: 'ring-green-500',
  },
  'manna-llc': {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    ring: 'ring-amber-500',
  },
};

export function EntitySwitcher({ selectedEntity, onEntityChange }: EntitySwitcherProps) {
  return (
    <div className="flex gap-2">
      {ENTITIES.map((entity) => {
        const Icon = ENTITY_ICONS[entity.id];
        const colors = ENTITY_COLORS[entity.id];
        const isSelected = selectedEntity === entity.id;

        return (
          <button
            key={entity.id}
            onClick={() => onEntityChange(entity.id)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all
              ${
                isSelected
                  ? `${colors.bg} ${colors.border} ${colors.text} ring-2 ${colors.ring} ring-offset-1`
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }
            `}
          >
            <Icon className="w-4 h-4" />
            <span className="font-medium text-sm">{entity.name}</span>
          </button>
        );
      })}
    </div>
  );
}
