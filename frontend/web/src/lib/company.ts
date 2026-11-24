import { RESERVED_SLUGS } from '@flourishive/schemas';
import { applyBrand, applyProductBrand, brand, isCustomHost } from '@flourishive/ui';
import { useEffect, useState } from 'react';
import type { CompanyPublic } from '@flourishive/schemas';
import { useApi, remember } from './api.tsx';

export type CompanySource = 'address' | 'link' | 'remembered' | 'none';
export interface DetectedCompany {
  slug: string;
  source: CompanySource;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Which company is this? In order: the address (<slug>.<your domain>), a ?tenant= link,
 * then the last company used on this device. Pure, so it can be tested without a browser.
 */
export function detectCompany(input: {
  hostname: string;
  search: string;
  hash: string;
  saved: string;
  domain: string;
  /** The company that owns this address, when it is a company's own (hr.company.com). */
  hostSlug?: string;
}): DetectedCompany {
  if (input.hostSlug) return { slug: input.hostSlug, source: 'address' };
  const suffix = `.${input.domain}`;
  if (input.hostname.endsWith(suffix)) {
    const label = input.hostname.slice(0, -suffix.length);
    if (SLUG.test(label) && !(RESERVED_SLUGS as readonly string[]).includes(label))
      return { slug: label, source: 'address' };
  }
  const fromQuery =
    new URLSearchParams(input.search).get('tenant') ??
    new URLSearchParams(input.hash.split('?')[1] ?? '').get('tenant');
  const q = fromQuery?.trim().toLowerCase();
  if (q && SLUG.test(q)) return { slug: q, source: 'link' };
  const saved = input.saved.trim().toLowerCase();
  if (saved && SLUG.test(saved)) return { slug: saved, source: 'remembered' };
  return { slug: '', source: 'none' };
}

let hostSlug = '';

/** On a company's own address, asks the API which company that is. Call once before the first render. */
export async function resolveHostCompany(): Promise<void> {
  if (!isCustomHost(location.hostname, brand.tenantDomain)) return;
  try {
    const res = await fetch(`${brand.apiUrl.replace(/\/$/, '')}/v1/public/host`, {
      cache: 'no-cache',
    });
    if (res.ok) {
      const body = (await res.json()) as { slug?: string };
      if (body.slug && SLUG.test(body.slug)) hostSlug = body.slug;
    }
  } catch {
    // The address is not set up (or the API is down): the normal sign-in page and company search show.
  }
}

export const detectHere = (): DetectedCompany =>
  detectCompany({
    hostSlug,
    hostname: location.hostname,
    search: location.search,
    hash: location.hash,
    saved: remember.get('fh.tenant'),
    domain: brand.tenantDomain,
  });

export type CompanyState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'found'; company: CompanyPublic }
  | { status: 'missing' };

/** Looks the company up for its name and accent colour, and applies the colour to the page. */
export function useCompany(slug: string): CompanyState {
  const api = useApi();
  const [state, setState] = useState<CompanyState>({ status: slug ? 'loading' : 'none' });
  useEffect(() => {
    if (!slug) return setState({ status: 'none' });
    let live = true;
    setState({ status: 'loading' });
    api.company
      .get(slug)
      .then((company) => {
        if (!live) return;
        // The company's published brand (colours, fonts, sign-in words) on top of the product's.
        api.brand
          .company(slug)
          .then((b) => live && (applyBrand(b), setState({ status: 'found', company })))
          .catch(() => live && setState({ status: 'found', company }));
      })
      .catch(() => live && setState({ status: 'missing' }));
    return () => {
      live = false;
      applyProductBrand();
    };
  }, [api, slug]);
  return state;
}
