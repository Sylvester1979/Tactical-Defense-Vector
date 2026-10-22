import { DamageType, WaveModifier } from '../types';

// Shared look of damage types and wave modifiers across the HUD, sidebar and tower panel

export const DMG_STYLE: Record<DamageType, { label: string; cls: string; hex: string }> = {
  [DamageType.KINETIC]:   { label: 'KINETIC',   cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30',       hex: '#60a5fa' },
  [DamageType.ENERGY]:    { label: 'ENERGY',    cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30', hex: '#c084fc' },
  [DamageType.EXPLOSIVE]: { label: 'EXPLOSIVE', cls: 'bg-red-500/20 text-red-300 border-red-500/30',          hex: '#f87171' },
  [DamageType.FROST]:     { label: 'FROST',     cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',       hex: '#22d3ee' },
  [DamageType.FIRE]:      { label: 'FIRE',      cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30', hex: '#fb923c' },
};

export const MODIFIER_STYLE: Record<WaveModifier, { label: string; color: string; desc: string }> = {
  [WaveModifier.NONE]:  { label: '',      color: '',                desc: '' },
  [WaveModifier.RUSH]:  { label: 'RUSH',  color: 'text-accent-amber', desc: '1.6× SPEED' },
  [WaveModifier.SWARM]: { label: 'SWARM', color: 'text-accent-red',   desc: '2× COUNT / ½ HP' },
  [WaveModifier.ELITE]: { label: 'ELITE', color: 'text-purple-400',   desc: '½ COUNT / 2× HP / 1.5× CREDITS' },
};

export const MODIFIER_HEX: Record<WaveModifier, string> = {
  [WaveModifier.NONE]:  '#8b949e',
  [WaveModifier.RUSH]:  '#ffb800',
  [WaveModifier.SWARM]: '#ef4444',
  [WaveModifier.ELITE]: '#c084fc',
};
