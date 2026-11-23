export function tint(hex: string, amount = .93): string {
  const normalized = /^#[\da-f]{6}$/i.test(hex) ? hex.slice(1) : '5064ee';
  const channels = [0, 2, 4].map(offset => Math.round(parseInt(normalized.slice(offset, offset + 2), 16) * (1 - amount) + 255 * amount));
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}
export function safePdfLink(value: string): string | undefined {
  const text = value.trim();
  if (!text || /[\s\x00-\x1f]/u.test(text)) return undefined;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(text)) return text;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(text)) return `https://${text}`;
  return undefined;
}
