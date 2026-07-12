import type { ProviderModelOption } from "@shared/schemas/provider.js";

export function formatContextLength(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}m`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

export function formatPrice(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${Number(value.toPrecision(2))}`;
  if (value < 1) return `$${Number(value.toFixed(2))}`;
  return `$${Number(value.toFixed(value < 10 ? 2 : 0))}`;
}

export function formatModelMeta(model: ProviderModelOption): string {
  const parts: string[] = [];
  if (model.contextLength !== null) {
    parts.push(`${formatContextLength(model.contextLength)} ctx`);
  }

  const prices: string[] = [];
  if (model.pricingInputPerMillion !== null) {
    prices.push(`${formatPrice(model.pricingInputPerMillion)} in`);
  }
  if (model.pricingOutputPerMillion !== null) {
    prices.push(`${formatPrice(model.pricingOutputPerMillion)} out`);
  }
  if (prices.length > 0) parts.push(`${prices.join(" / ")} per 1M`);
  return parts.join(" · ");
}
