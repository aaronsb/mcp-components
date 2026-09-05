/**
 * A descriptor built from a plain table of service to methods, for tests and
 * for APIs small enough to list by hand. Real descriptors wrap OpenAPI,
 * Google Discovery, or a GraphQL schema behind the same interface.
 */

import type { Descriptor, CallContext } from './types.js';

export function staticDescriptor(
  methods: Record<string, string[]>,
  call: (service: string, resource: string, params: Record<string, unknown>, ctx: CallContext) => Promise<unknown>,
): Descriptor {
  return {
    has: (service, resource) => (methods[service] ?? []).includes(resource),
    methods: service => methods[service] ?? [],
    call,
  };
}
