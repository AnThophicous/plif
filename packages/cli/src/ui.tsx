/**
 * Terminal UI boundary.
 *
 * Components import primitives from here instead of binding themselves to a
 * renderer. This is the seam used by the Slate migration: layout, text,
 * lifecycle and input can be replaced together without touching feature code.
 */
export {
  Box,
  Static,
  Text,
  useApp,
  useInput,
  useStdin,
  useStdout,
} from 'ink';
export type { Key } from 'ink';
