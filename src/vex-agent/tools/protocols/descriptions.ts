/**
 * Thin compatibility layer over shared protocol navigation metadata.
 *
 * Keeps the existing import path stable while the actual metadata lives in
 * focused modules under `tools/protocols/navigation/`.
 */

import type { ProtocolNamespace } from "./types.js";
import { MARKET_PROTOCOL_NAVIGATION } from "./navigation/entries-market.js";
import {
  PROTOCOL_NAVIGATION_GROUP_ORDER,
  type ProtocolNavigationFacet,
  type ProtocolNamespaceNavigation,
  type ProtocolNavigationGroup,
} from "./navigation/types.js";

const NAVIGATION_LIST: readonly ProtocolNamespaceNavigation[] = [
  ...MARKET_PROTOCOL_NAVIGATION,
] as const;

export const PROTOCOL_NAMESPACE_NAVIGATION: Record<ProtocolNamespace, ProtocolNamespaceNavigation> = Object.fromEntries(
  NAVIGATION_LIST.map((metadata) => [metadata.namespace, metadata]),
) as Record<ProtocolNamespace, ProtocolNamespaceNavigation>;

export const NAMESPACE_DESCRIPTIONS: Record<ProtocolNamespace, string> = Object.fromEntries(
  NAVIGATION_LIST.map((metadata) => [metadata.namespace, metadata.summary]),
) as Record<ProtocolNamespace, string>;

export const NAMESPACE_EXAMPLES: Record<ProtocolNamespace, readonly string[]> = Object.fromEntries(
  NAVIGATION_LIST.map((metadata) => [metadata.namespace, metadata.exampleQueries]),
) as Record<ProtocolNamespace, readonly string[]>;

export function maybeGetProtocolNamespaceNavigation(namespace: string): ProtocolNamespaceNavigation | undefined {
  return PROTOCOL_NAMESPACE_NAVIGATION[namespace as ProtocolNamespace];
}

export function getProtocolNamespaceNavigation(namespace: ProtocolNamespace): ProtocolNamespaceNavigation {
  return PROTOCOL_NAMESPACE_NAVIGATION[namespace];
}

export function getAdvertisedProtocolNavigation(): ProtocolNamespaceNavigation[] {
  return NAVIGATION_LIST.filter((metadata) => metadata.advertised);
}

export function getGroupedAdvertisedProtocolNavigation(): ProtocolNavigationGroup[] {
  const advertised = getAdvertisedProtocolNavigation();
  const groups: Array<ProtocolNavigationGroup | null> = PROTOCOL_NAVIGATION_GROUP_ORDER.map((groupId) => {
    const namespaces = advertised.filter((metadata) => metadata.groupId === groupId);
    if (namespaces.length === 0) return null;
    return { groupId, groupLabel: namespaces[0]!.groupLabel, namespaces };
  });
  return groups.filter((group): group is ProtocolNavigationGroup => group !== null);
}

export function buildDiscoverNamespaceDescription(): string {
  const grouped = getGroupedAdvertisedProtocolNavigation()
    .map((group) => `${group.groupLabel}: ${group.namespaces.map((metadata) => metadata.namespace).join(", ")}`)
    .join("; ");
  return `Protocol filter. Supported namespaces: ${grouped}. Reserved namespaces are not discoverable.`;
}

export function getMatchingFacetsForTool(
  namespace: ProtocolNamespace,
  toolId: string,
): ProtocolNavigationFacet[] {
  const metadata = maybeGetProtocolNamespaceNavigation(namespace);
  if (!metadata) return [];
  return metadata.facets.filter((facet) =>
    facet.toolPrefixes.some((prefix) => toolId === prefix || toolId.startsWith(`${prefix}.`)),
  );
}

export function getDiscoveryStringsForTool(namespace: ProtocolNamespace, toolId: string): string[] {
  const metadata = maybeGetProtocolNamespaceNavigation(namespace);
  if (!metadata) return [namespace];
  const strings: string[] = [
    metadata.namespace,
  ];
  for (const facet of getMatchingFacetsForTool(namespace, toolId)) {
    strings.push(facet.label, facet.summary, ...facet.hints);
  }
  return strings.filter((value) => value.trim().length > 0);
}
