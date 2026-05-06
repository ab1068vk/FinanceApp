import Feather from '@expo/vector-icons/Feather';

export type FeatherIconName = keyof typeof Feather.glyphMap;

export function featherIconName(name?: string | null, fallback: FeatherIconName = 'circle'): FeatherIconName {
  return name && Object.prototype.hasOwnProperty.call(Feather.glyphMap, name)
    ? (name as FeatherIconName)
    : fallback;
}
