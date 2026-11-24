import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { BrandAssetKind } from '@flourishive/schemas';
import { readImageInfo } from './image-info.js';

export interface Processed {
  body: Buffer;
  mime: 'image/png' | 'image/webp' | 'image/svg+xml';
  width: number;
  height: number;
}

/** Longest side after resizing, per kind. Pictures are shrunk to this, never enlarged. */
const TARGET: Record<BrandAssetKind, number> = {
  LOGO_LIGHT: 512,
  LOGO_DARK: 512,
  FAVICON: 64,
  PANEL_IMAGE: 2000,
};

const window = new JSDOM('').window;
const purify = createDOMPurify(
  window as unknown as Parameters<typeof createDOMPurify>[0],
);

const looksLikeSvg = (b: Buffer): boolean => {
  const head = b
    .subarray(0, 2048)
    .toString('utf8')
    .replace(/^﻿/, '')
    .trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(
    head,
  );
};

/**
 * SVG can carry script, event handlers, external references and embedded pages, so it is rebuilt through
 * DOMPurify's SVG profile: scripts, foreignObject, animation of links and every on* attribute are removed.
 * What is left is plain shapes, text and styling.
 */
export function sanitizeSvg(raw: Buffer): {
  svg: string;
  width: number;
  height: number;
} {
  const clean = purify.sanitize(raw.toString('utf8'), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'script',
      'foreignObject',
      'iframe',
      'object',
      'embed',
      'set',
      'animate',
      'animateTransform',
      'animateMotion',
      'use',
      'image',
      'a',
    ],
    FORBID_ATTR: ['href', 'xlink:href', 'style'],
    ADD_URI_SAFE_ATTR: [],
  });
  const doc = new JSDOM(clean, { contentType: 'image/svg+xml' }).window
    .document;
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg')
    throw new UnsupportedMediaTypeException('That SVG could not be read');
  if (!root.hasAttribute('xmlns'))
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const num = (v: string | null) => {
    const n = parseFloat(v ?? '');
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const width =
    vb.length === 4 && vb[2]! > 0
      ? vb[2]!
      : num(root.getAttribute('width')) || 512;
  const height =
    vb.length === 4 && vb[3]! > 0
      ? vb[3]!
      : num(root.getAttribute('height')) || 512;
  return {
    svg: new window.XMLSerializer().serializeToString(root),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Checks what was uploaded by its bytes and returns the file to store: SVG sanitised; PNG, JPEG or WebP
 * decoded and re-encoded at a sensible size (which also drops any hidden payload or metadata).
 */
export async function processImage(
  kind: BrandAssetKind,
  input: Buffer,
): Promise<Processed> {
  if (looksLikeSvg(input)) {
    const s = sanitizeSvg(input);
    return {
      body: Buffer.from(s.svg, 'utf8'),
      mime: 'image/svg+xml',
      width: s.width,
      height: s.height,
    };
  }
  const info = readImageInfo(input);
  if (!info)
    throw new UnsupportedMediaTypeException(
      'Use a PNG, JPEG, WebP or SVG picture',
    );
  try {
    const img = sharp(input, {
      limitInputPixels: 80_000_000,
      failOn: 'error',
    }).rotate();
    const side = TARGET[kind];
    if (kind === 'FAVICON') {
      const out = await img
        .resize(side, side, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      return {
        body: out.data,
        mime: 'image/png',
        width: out.info.width,
        height: out.info.height,
      };
    }
    if (kind === 'PANEL_IMAGE') {
      const out = await img
        .resize(side, side, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      return {
        body: out.data,
        mime: 'image/webp',
        width: out.info.width,
        height: out.info.height,
      };
    }
    const out = await img
      .resize(side, side, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      body: out.data,
      mime: 'image/png',
      width: out.info.width,
      height: out.info.height,
    };
  } catch {
    throw new BadRequestException(
      'That picture could not be read. Try saving it again as a PNG.',
    );
  }
}

/** An ICO file holding one PNG image (browsers accept PNG inside ICO). */
export async function toIco(png: Buffer): Promise<Buffer> {
  const small = await sharp(png)
    .resize(32, 32, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header[6] = 32; // width
  header[7] = 32; // height
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bits per pixel
  header.writeUInt32LE(small.length, 14 + 4); // size of image data
  header.writeUInt32LE(22, 18); // offset of image data
  return Buffer.concat([header, small]);
}
