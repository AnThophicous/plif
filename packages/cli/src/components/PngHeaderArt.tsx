import fs from 'node:fs';
import zlib from 'node:zlib';

import React from 'react';
import { Box, Text } from 'ink';

import { color } from '../theme.js';

type Rgba = readonly [number, number, number, number];

interface IndexedPng {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

interface Crop {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PngHeaderCell {
  /** Undefined means: let the surface beneath the art show through. */
  readonly foreground?: string;
  /** Undefined means: do not paint a terminal background for this half-cell. */
  readonly background?: string;
  readonly glyph: '▀' | '▄' | ' ';
}

const ASSET_URL = new URL('../../assets/negrocomcachecol.png', import.meta.url);
const PANEL_FALLBACK = '#303030';
// Keep the mascot legible without letting the raster dominate the header card.
const TARGET_WIDTH = 16;
const HALF_ROWS_PER_CELL = 2;
// A terminal half-block is physically taller than one character column on
// the Windows terminal fonts Plif targets. Compensate before sampling so a
// square source mark remains square on screen instead of becoming vertical.
const HALF_ROW_ASPECT = 1.15;

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function unfilterRows(raw: Uint8Array, rowBytes: number, bytesPerPixel: number, height: number): Uint8Array[] {
  const rows: Uint8Array[] = [];
  const previous = new Uint8Array(rowBytes);
  let offset = 0;

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = raw[offset] ?? 0;
    const row = raw.slice(offset + 1, offset + 1 + rowBytes);
    offset += rowBytes + 1;

    for (let index = 0; index < row.length; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel]! : 0;
      const up = previous[index] ?? 0;
      const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel]! : 0;

      if (filter === 1) row[index] = (row[index]! + left) & 0xff;
      else if (filter === 2) row[index] = (row[index]! + up) & 0xff;
      else if (filter === 3) row[index] = (row[index]! + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const leftDistance = Math.abs(estimate - left);
        const upDistance = Math.abs(estimate - up);
        const upLeftDistance = Math.abs(estimate - upLeft);
        const predictor = leftDistance <= upDistance && leftDistance <= upLeftDistance
          ? left
          : upDistance <= upLeftDistance ? up : upLeft;
        row[index] = (row[index]! + predictor) & 0xff;
      } else if (filter !== 0) {
        throw new Error('unsupported PNG filter ' + filter);
      }
    }

    rows.push(row);
    previous.set(row);
  }

  return rows;
}

function decodePng(bytes: Uint8Array): IndexedPng {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('invalid PNG signature');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = new Uint8Array();
  let transparency = new Uint8Array();
  const imageData: Uint8Array[] = [];

  for (let offset = 8; offset < bytes.length; ) {
    const length = readUInt32(bytes, offset);
    const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (kind === 'IHDR') {
      width = readUInt32(chunk, 0);
      height = readUInt32(chunk, 4);
      bitDepth = chunk[8] ?? 0;
      colorType = chunk[9] ?? 0;
    } else if (kind === 'PLTE') palette = chunk;
    else if (kind === 'tRNS') transparency = chunk;
    else if (kind === 'IDAT') imageData.push(chunk);
  }

  if (bitDepth !== 8 || (colorType !== 3 && colorType !== 6)) {
    throw new Error('header PNG must be 8-bit indexed or RGBA colour');
  }
  if (!width || !height || imageData.length === 0 || (colorType === 3 && palette.length === 0)) {
    throw new Error('header PNG is missing image data');
  }

  const filtered = zlib.inflateSync(Buffer.concat(imageData.map((chunk) => Buffer.from(chunk))));
  const bytesPerPixel = colorType === 6 ? 4 : 1;
  const rows = unfilterRows(filtered, width * bytesPerPixel, bytesPerPixel, height);
  const pixels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (y * width + x) * 4;
      if (colorType === 6) {
        const sourceOffset = x * 4;
        const row = rows[y]!;
        pixels[pixelOffset] = row[sourceOffset] ?? 0;
        pixels[pixelOffset + 1] = row[sourceOffset + 1] ?? 0;
        pixels[pixelOffset + 2] = row[sourceOffset + 2] ?? 0;
        pixels[pixelOffset + 3] = row[sourceOffset + 3] ?? 0;
      } else {
        const paletteIndex = rows[y]![x]!;
        const paletteOffset = paletteIndex * 3;
        pixels[pixelOffset] = palette[paletteOffset] ?? 0;
        pixels[pixelOffset + 1] = palette[paletteOffset + 1] ?? 0;
        pixels[pixelOffset + 2] = palette[paletteOffset + 2] ?? 0;
        pixels[pixelOffset + 3] = transparency[paletteIndex] ?? 255;
      }
    }
  }

  return { width, height, pixels };
}

function pixel(image: IndexedPng, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * 4;
  return [
    image.pixels[offset] ?? 0,
    image.pixels[offset + 1] ?? 0,
    image.pixels[offset + 2] ?? 0,
    image.pixels[offset + 3] ?? 0,
  ];
}

function visibleCrop(image: IndexedPng): Crop {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (pixel(image, x, y)[3] <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) throw new Error('header PNG has no visible pixels');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function parseHex(value: string): readonly [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return [25, 27, 32];
  const numeric = Number.parseInt(match[1]!, 16);
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff];
}

function hex(rgb: readonly [number, number, number]): string {
  return '#' + rgb.map((part) => part.toString(16).padStart(2, '0')).join('');
}

function composite(pixelValue: Rgba, background: readonly [number, number, number]): string {
  const alpha = pixelValue[3] / 255;
  if (alpha <= 0.03) return hex(background);
  if (alpha >= 0.98) return hex([pixelValue[0], pixelValue[1], pixelValue[2]]);
  return hex([
    Math.round(background[0] * (1 - alpha) + pixelValue[0] * alpha),
    Math.round(background[1] * (1 - alpha) + pixelValue[1] * alpha),
    Math.round(background[2] * (1 - alpha) + pixelValue[2] * alpha),
  ]);
}

const image = decodePng(new Uint8Array(fs.readFileSync(ASSET_URL)));
const crop = visibleCrop(image);
export const PNG_HEADER_ART_WIDTH = TARGET_WIDTH;
export const PNG_HEADER_ART_PIXEL_HEIGHT = Math.max(1, Math.round(
  TARGET_WIDTH * crop.height / crop.width / HALF_ROW_ASPECT,
));
export const PNG_HEADER_ART_HEIGHT = Math.max(1, Math.ceil(
  PNG_HEADER_ART_PIXEL_HEIGHT / HALF_ROWS_PER_CELL,
));

const cellsByBackground = new Map<string, readonly (readonly PngHeaderCell[])[]>();

export function pngHeaderCells(backgroundColor = color('panel')): readonly (readonly PngHeaderCell[])[] {
  const cached = cellsByBackground.get(backgroundColor);
  if (cached) return cached;

  const background = parseHex(backgroundColor || PANEL_FALLBACK);
  const targetPixelHeight = PNG_HEADER_ART_PIXEL_HEIGHT;
  const rows: PngHeaderCell[][] = [];

  for (let cellY = 0; cellY < PNG_HEADER_ART_HEIGHT; cellY += 1) {
    const row: PngHeaderCell[] = [];
    for (let cellX = 0; cellX < PNG_HEADER_ART_WIDTH; cellX += 1) {
      const sourceX = Math.min(
        crop.width - 1,
        Math.max(0, Math.round((cellX + 0.5) * crop.width / PNG_HEADER_ART_WIDTH - 0.5)),
      );
      const sourceY = (halfRow: number): number | undefined => {
        if (halfRow >= targetPixelHeight) return undefined;
        return Math.min(
          crop.height - 1,
          Math.max(0, Math.round((halfRow + 0.5) * crop.height / targetPixelHeight - 0.5)),
        );
      };
      const topY = sourceY(cellY * HALF_ROWS_PER_CELL);
      const bottomY = sourceY(cellY * HALF_ROWS_PER_CELL + 1);
      const topPixel: Rgba = topY === undefined
        ? [0, 0, 0, 0]
        : pixel(image, crop.left + sourceX, crop.top + topY);
      const bottomPixel: Rgba = bottomY === undefined
        ? [0, 0, 0, 0]
        : pixel(image, crop.left + sourceX, crop.top + bottomY);
      const topVisible = topPixel[3] > 8;
      const bottomVisible = bottomPixel[3] > 8;
      row.push({
        // A transparent half must not receive an explicit background colour:
        // doing so paints the PNG's crop rectangle instead of preserving the
        // header surface behind it. Only paint the lower half when both halves
        // are visible; a lone lower pixel uses `▄` with no background.
        foreground: topVisible
          ? composite(topPixel, background)
          : bottomVisible ? composite(bottomPixel, background) : undefined,
        background: topVisible && bottomVisible ? composite(bottomPixel, background) : undefined,
        glyph: topVisible ? '▀' : bottomVisible ? '▄' : ' ',
      });
    }
    rows.push(row);
  }

  const result = Object.freeze(rows.map((row) => Object.freeze(row.slice())));
  cellsByBackground.set(backgroundColor, result);
  return result;
}

export function PngHeaderArt(): React.ReactElement {
  const rows = pngHeaderCells();
  return (
    <Box flexDirection="column" width={PNG_HEADER_ART_WIDTH} height={PNG_HEADER_ART_HEIGHT}>
      {rows.map((row, rowIndex) => (
        <Text key={rowIndex}>
          {row.map((cell, cellIndex) => (
            <Text key={cellIndex} color={cell.foreground} backgroundColor={cell.background}>
              {cell.glyph}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
