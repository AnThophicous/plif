import { EventEmitter } from 'node:events';
import React, { createContext, useContext, useEffect, useRef } from 'react';
import createReconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants.js';
import {
  createSlateApp,
  createElement as createSlateElement,
  createTerminalController,
  Fragment as slateFragment,
  type SlateChild,
  type SlateEvent,
} from '@slate-terminal/react';
import { createInputSource, enableMouseCapture } from '@slate-terminal/core';
import { clusterLength, displayWidth } from './text.js';

/** React host backed by Slate's flex and ANSI renderer. */

/** Repaints per second. See the note beside `createSlateApp` below. */
const SLATE_FRAME_RATE = 60;

type UiProps = Record<string, unknown>;
type HostText = { kind: 'text'; id: string; value: string; revision: number; parent?: HostNode };
type HostNode = {
  kind: 'node';
  id: string;
  nodeType: 'container' | 'scroll' | 'text';
  props: UiProps;
  children: Array<HostNode | HostText>;
  revision: number;
  parent?: HostNode;
};
type HostChild = HostNode | HostText;

let hostNodeSequence = 0;

interface CachedSlateChild {
  readonly revision: number;
  readonly context: string;
  readonly value: SlateChild;
}

const slateChildCache = new WeakMap<HostNode, CachedSlateChild>();

/**
 * Slate element id -> the meaning the component attached to that element.
 *
 * Slate already hit-tests every mouse report against the laid-out tree and
 * reports the topmost element as `event.target`. Components label the elements
 * they want to be clickable with a `hitTarget` string, and this map turns the
 * element id back into that label. Doing it this way, rather than passing an
 * `onMouse` closure through the host tree, keeps the conversion cache useful:
 * a stable string leaves a node's props unchanged between renders, while a
 * fresh closure per render would invalidate the whole subtree every frame.
 *
 * Entries are dropped when their host node leaves the tree.
 */
const hitTargets = new Map<string, string>();

/** The label a component attached to the element Slate reports as the target. */
export function hitTargetOf(elementId: string | number | undefined): string | undefined {
  return elementId === undefined ? undefined : hitTargets.get(String(elementId));
}

/**
 * Every label currently registered, in element order.
 *
 * The registry is otherwise only readable through an element id that Slate
 * assigns, which nothing outside a live mouse report has. This exposes the
 * labels themselves so a test can assert that a component reached the registry
 * at all, and that its entries leave when the component does.
 */
export function hitTargetLabels(): readonly string[] {
  return [...hitTargets.values()];
}

function shallowRecordEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' ||
    Array.isArray(left) || Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of keys) if (!Object.is(leftRecord[key], rightRecord[key])) return false;
  return true;
}

/** React passes a fresh `style` object on many parent renders. */
function hostPropsEqual(left: UiProps, right: UiProps): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    // Children are reconciled through append/remove/text callbacks. Comparing
    // the React element here would invalidate every host node on each App
    // render even when its Slate-visible props did not change.
    if (key === 'children') continue;
    const previous = left[key];
    const next = right[key];
    if (key === 'style' || key === 'textStyle') {
      if (!shallowRecordEqual(previous, next)) return false;
    } else if (!Object.is(previous, next)) {
      return false;
    }
  }
  return true;
}

function bumpRevision(node: HostNode | HostText): void {
  node.revision += 1;
  if (node.parent) bumpRevision(node.parent);
}

function attachChild(parent: HostNode, child: HostChild): void {
  child.parent = parent;
}

function forgetHitTargets(child: HostChild): void {
  hitTargets.delete(child.id);
  if (child.kind === 'node') for (const grandchild of child.children) forgetHitTargets(grandchild);
}

function detachChild(parent: HostNode, child: HostChild): void {
  if (child.parent === parent) child.parent = undefined;
  forgetHitTargets(child);
}

function contextKey(
  parentStyle: Record<string, unknown> | undefined,
  isRoot: boolean,
  inheritedVisual: { readonly color?: string; readonly backgroundColor?: string } | undefined,
  available: number | undefined,
): string {
  return [
    isRoot ? 'root' : 'child',
    parentStyle?.flexDirection ?? '',
    parentStyle?.alignItems ?? '',
    inheritedVisual?.color ?? '',
    inheritedVisual?.backgroundColor ?? '',
    available ?? '',
  ].join('\u0000');
}

/**
 * The cell width a node may occupy, resolved during the walk.
 *
 * Borders are painted here as literal rows of box-drawing characters, so the
 * rule that draws them needs a number. A component asking for a stretched
 * width used to fall through to the three-cell stub and let its content spill
 * past the frame - the footer painted as a two-character corner with the model
 * line wrapping underneath it. Resolving the percentage against the parent's
 * own resolved width keeps a stretched box's border the width it is drawn at.
 */
function resolveWidth(value: unknown, available: number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.endsWith('%') && available !== undefined) {
    const ratio = Number.parseFloat(value);
    if (Number.isFinite(ratio)) return Math.max(1, Math.floor((available * ratio) / 100));
  }
  return available;
}

/** What a node leaves to each child once its own edges are taken. */
function innerWidth(style: Record<string, unknown>, resolved: number | undefined): number | undefined {
  if (resolved === undefined) return undefined;
  const edges = Number(style.paddingLeft ?? 0) + Number(style.paddingRight ?? 0)
    + Number(style.marginLeft ?? 0) + Number(style.marginRight ?? 0);
  return Math.max(1, resolved - edges);
}

function slateElement(
  type: string | symbol,
  props: Record<string, unknown>,
  ...children: SlateChild[]
): SlateChild {
  const suppliedStyle = typeof props.style === 'object' && props.style !== null
    ? props.style as Record<string, unknown>
    : {};
  const style = {
    alignItems: 'stretch',
    ...(suppliedStyle.flexDirection === 'column' && suppliedStyle.width === undefined
      ? { width: '100%' }
      : {}),
    ...suppliedStyle,
  };
  return createSlateElement(type as never, {
    ...props,
    // Generated Slate wrappers do not pass through normalizeStyle. Keep their
    // cross-axis behavior identical to React host containers or a wrapper can
    // become a narrow clipping viewport after a conditional row disappears.
    style,
  } as never, ...children) as unknown as SlateChild;
}

interface UiRoot {
  children: HostChild[];
  repaint: () => void;
}

interface UiContextValue {
  readonly exit: () => void;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly input: EventEmitter;
  readonly subscribeInput: (handler: (char: string, key: Key) => void) => () => void;
  readonly subscribeSlateEvent: (handler: (event: SlateEvent) => void) => () => void;
}

const context = createContext<UiContextValue | null>(null);

export interface Key {
  readonly upArrow: boolean;
  readonly downArrow: boolean;
  readonly leftArrow: boolean;
  readonly rightArrow: boolean;
  readonly pageUp: boolean;
  readonly pageDown: boolean;
  readonly home: boolean;
  readonly end: boolean;
  readonly return: boolean;
  readonly escape: boolean;
  readonly tab: boolean;
  readonly backspace: boolean;
  readonly delete: boolean;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly super: boolean;
  readonly meta: boolean;
}

export function Box(props: UiProps & { readonly children?: React.ReactNode }): React.ReactElement {
  return React.createElement('slate-container', props);
}

/** A Slate scrollView with the same JSX surface as Box. */
export function ScrollView(props: UiProps & { readonly children?: React.ReactNode }): React.ReactElement {
  return React.createElement('slate-scroll', props);
}

export function Text(props: UiProps & { readonly children?: React.ReactNode }): React.ReactElement {
  return React.createElement('slate-text', props);
}

export function Static(props: UiProps & {
  readonly items?: readonly unknown[];
  readonly children?: React.ReactNode | ((item: any) => React.ReactNode);
}): React.ReactElement {
  const { items, children, ...rest } = props;
  let rendered: React.ReactNode = children as React.ReactNode;
  if (typeof children === 'function' && items) {
    rendered = items.map((item, index) => <React.Fragment key={index}>{children(item)}</React.Fragment>);
  }
  return React.createElement('slate-container', {
    flexDirection: 'column',
    width: '100%',
    ...rest,
  }, rendered);
}

export function useApp(): { readonly exit: () => void } {
  const value = useContext(context);
  if (!value) throw new Error('useApp must be used inside the Slate terminal');
  return { exit: value.exit };
}

export function useStdin(): {
  readonly stdin: NodeJS.ReadStream;
  readonly internal_eventEmitter: EventEmitter;
} {
  const value = useContext(context);
  if (!value) throw new Error('useStdin must be used inside the Slate terminal');
  return { stdin: value.stdin, internal_eventEmitter: value.input };
}

export function useStdout(): { readonly stdout: NodeJS.WriteStream } {
  const value = useContext(context);
  if (!value) throw new Error('useStdout must be used inside the Slate terminal');
  return { stdout: value.stdout };
}

export function useInput(handler: (char: string, key: Key) => void): void {
  const value = useContext(context);
  if (!value) throw new Error('useInput must be used inside the Slate terminal');
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    // App renders frequently while a model is streaming. Subscribe once and
    // read the latest callback through a ref; re-subscribing on every render
    // creates a small input race and needlessly churns Slate's listener set.
    return value.subscribeInput((char, key) => handlerRef.current(char, key));
  }, [value]);
}

/** Subscribe to Slate's normalized events without converting them to bytes. */
export function useSlateEvent(handler: (event: SlateEvent) => void): void {
  const value = useContext(context);
  if (!value) throw new Error('useSlateEvent must be used inside the Slate terminal');
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    return value.subscribeSlateEvent((event) => handlerRef.current(event));
  }, [value]);
}

function normalizeStyle(props: UiProps): Record<string, unknown> {
  const style: Record<string, unknown> = {
    // Ink's Box defaults to a horizontal row; Slate's container defaults to
    // a column. Keep the established Plif layout contract unless a component
    // explicitly asks for a column.
    flexDirection: props.flexDirection ?? 'row',
    // Yoga/Ink stretches children across the cross-axis by default. Slate's
    // compact flex engine otherwise sizes a column wrapper to its narrowest
    // child, clipping dynamic timeline rows (and even the last character of
    // a model id) when a dialog closes.
    alignItems: props.alignItems ?? 'stretch',
    ...(typeof props.style === 'object' && props.style !== null ? props.style : {}),
  };
  const copy = (from: string, to = from): void => {
    if (props[from] !== undefined && style[to] === undefined) style[to] = props[from];
  };
  for (const key of [
    'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'width', 'height',
    'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'justifyContent', 'alignItems',
    'alignContent', 'alignSelf', 'gap', 'rowGap', 'columnGap', 'padding', 'paddingTop',
    'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginTop', 'marginRight',
    'marginBottom', 'marginLeft', 'position', 'top', 'right', 'bottom', 'left', 'overflow',
    'overflowX', 'overflowY', 'scrollLeft', 'scrollTop',
  ]) copy(key);
  // Yoga/Ink leaves flex items at their intrinsic size unless a component
  // explicitly opts into shrinking. Slate's lightweight engine defaults to a
  // CSS-like shrink factor of 1; that makes nested rows collapse to zero and
  // paint their children on top of the next line (especially chooser options
  // with descriptions). Keep the old terminal layout contract by opting out
  // unless the component supplied a value.
  if (style.flexShrink === undefined) style.flexShrink = 0;
  if (props.paddingX !== undefined) {
    copy('paddingX', 'paddingLeft');
    copy('paddingX', 'paddingRight');
  }
  if (props.paddingY !== undefined) {
    copy('paddingY', 'paddingTop');
    copy('paddingY', 'paddingBottom');
  }
  if (props.marginX !== undefined) {
    copy('marginX', 'marginLeft');
    copy('marginX', 'marginRight');
  }
  if (props.marginY !== undefined) {
    copy('marginY', 'marginTop');
    copy('marginY', 'marginBottom');
  }
  // Ink/Yoga gives column children the available cross-axis width by default.
  // Slate's compact flex engine measures an unconstrained column at its
  // intrinsic width, turning a wrapper around the timeline into a tiny
  // overflow clip. Materialize the same contract only for column nodes;
  // horizontal rows must keep their intrinsic width for inline spans.
  if (style.flexDirection === 'column' && style.width === undefined) style.width = '100%';
  return style;
}

function textStyleFor(props: UiProps): Record<string, unknown> | undefined {
  const direct = typeof props.textStyle === 'object' && props.textStyle !== null
    ? { ...(props.textStyle as Record<string, unknown>) }
    : {};
  for (const name of ['bold', 'dim', 'italic', 'underline', 'strikethrough'] as const) {
    if (typeof props[name] === 'boolean') direct[name] = props[name];
  }
  return Object.keys(direct).length > 0 ? direct : undefined;
}

function toSlateChild(
  child: HostChild,
  ids: { value: number },
  parentStyle?: Record<string, unknown>,
  isRoot = false,
  inheritedVisual?: { readonly color?: string; readonly backgroundColor?: string },
  available?: number,
): SlateChild {
  if (child.kind === 'text') return child.value;
  const cacheContext = contextKey(parentStyle, isRoot, inheritedVisual, available);
  const cached = slateChildCache.get(child);
  if (cached?.revision === child.revision && cached.context === cacheContext) return cached.value;
  const cache = (value: SlateChild): SlateChild => {
    slateChildCache.set(child, { revision: child.revision, context: cacheContext, value });
    return value;
  };
  const props: Record<string, unknown> = {
    // React host nodes survive ordinary updates. Reusing their identity lets
    // Slate reconcile by node identity instead of by the node's current
    // position. Positional IDs made a closed picker hand its old clip/layout
    // to the next timeline row, which was the source of one-character cuts
    // and stale panes after dynamic updates.
    id: child.id,
    style: normalizeStyle(child.props),
  };
  // Clickable elements register their meaning under the id Slate will report.
  if (typeof child.props['hitTarget'] === 'string') {
    hitTargets.set(child.id, child.props['hitTarget']);
  }
  const style = props.style as Record<string, unknown>;
  const resolvedWidth = resolveWidth(style.width, available);
  const childAvailable = innerWidth(style, resolvedWidth);
  // Slate's compact flex engine calculates intrinsic height from children but
  // intentionally ignores margins and gaps. Ink/Yoga includes those edges in
  // the parent's measured footprint. Materialise that footprint for natural
  // containers so a column of rows cannot compress its first child to zero.
  if (
    child.nodeType === 'container' &&
    style.height === undefined &&
    child.props.height === undefined &&
    style.flexGrow === undefined
  ) {
    style.height = intrinsicHostSize(child, 'height')
      + (typeof child.props.borderStyle === 'string' ? 2 : 0)
      + (isRoot ? Number(style.marginTop ?? 0) + Number(style.marginBottom ?? 0) : 0);
  }
  // A centred column stretches its children to full width so the *box* lands in
  // the middle. A Slate text widget draws from its own left edge, though, so
  // stretching one left-aligns the words inside a card that looks centred -
  // which is why the startup card's two lines sat against its left rail.
  // Container children keep the stretch; a text child is wrapped in a row that
  // centres it instead.
  const centredText = parentStyle?.flexDirection === 'column' &&
    parentStyle.alignItems === 'center' &&
    child.nodeType === 'text' &&
    child.props.width === undefined &&
    child.props.flexGrow === undefined;
  if (
    !centredText &&
    parentStyle?.flexDirection === 'column' &&
    parentStyle.alignItems === 'center' &&
    child.props.width === undefined &&
    child.props.flexGrow === undefined
  ) {
    (props.style as Record<string, unknown>).width = '100%';
    (props.style as Record<string, unknown>).justifyContent ??= 'center';
  }
  const foreground = typeof child.props.color === 'string' ? child.props.color : inheritedVisual?.color;
  const background = typeof child.props.backgroundColor === 'string'
    ? child.props.backgroundColor
    : inheritedVisual?.backgroundColor;
  if (foreground) props.foreground = foreground;
  if (background) props.background = background;
  const textStyle = textStyleFor(child.props);
  if (textStyle) props.textStyle = textStyle;
  if (typeof child.props.link === 'string') props.link = child.props.link;
  if (typeof child.props.wrapText === 'boolean') props.wrapText = child.props.wrapText;
  // Keep Slate 2.1's semantic props on the VNode. In particular, disabled
  // nodes must be filtered by Slate before hit-testing/focus, rather than
  // merely looking disabled in the React layer.
  for (const name of ['className', 'class'] as const) {
    if (typeof child.props[name] === 'string') props[name] = child.props[name];
  }
  if (child.props.visible !== undefined) props.visible = child.props.visible;
  if (child.props.disabled !== undefined) props.disabled = child.props.disabled;
  if (child.props.focusable !== undefined) props.focusable = child.props.focusable;
  const press = child.props.onPress ?? child.props.onClick;
  if (typeof press === 'function') props.onPress = press;
  for (const name of [
    'onEvent', 'onKey', 'onMouse', 'onHover', 'onPaste', 'onResize', 'onIme',
    'onFocus', 'onBlur', 'onScroll', 'onChange', 'onSubmit',
  ] as const) {
    if (typeof child.props[name] === 'function') props[name] = child.props[name];
  }
  // Slate's text widget owns one terminal line. React/Ink commonly nests
  // several Text nodes to style spans inline; leaving them as Slate children
  // would make Flex place each span on a separate row. Coalesce the spans so
  // prose, prompts and model reasoning retain their inline geometry.
  if (child.nodeType === 'text') {
    const value = flattenHostText(child).replace(/\r\n/g, '\n');
    const nested = child.children.some((item) => item.kind === 'node');
    if (!value.includes('\n') && !nested) {
      props.text = value;
      const element = slateElement('text', props);
      if (!centredText) return cache(element);
      return cache(slateElement('container', {
        id: child.id + ':centred',
        style: { flexDirection: 'row', justifyContent: 'center', width: '100%', height: 1, flexShrink: 0 },
      }, element));
    }
    if (nested && !value.includes('\n')) {
      return cache(slateElement('container', {
        id: `${child.id}:inline`,
        style: { ...(props.style as Record<string, unknown>), flexDirection: 'row', height: 1, flexShrink: 0 },
        ...(foreground ? { foreground } : {}),
        ...(background ? { background } : {}),
        ...(textStyle ? { textStyle } : {}),
      }, ...child.children.flatMap((item) => {
        // Slate reserves one intrinsic cell for an empty text widget. React
        // creates empty siblings around a cursor (the `after` span at the end
        // of a line is the common case), so keeping those nodes would turn a
        // single cursor cell into a visible extra gap before ghost text.
        if (
          (item.kind === 'text' && item.value.length === 0) ||
          (item.kind === 'node' && item.nodeType === 'text' && flattenHostText(item).length === 0)
        ) return [];
        return [item.kind === 'text'
          ? slateElement('text', {
            id: item.id,
            text: item.value,
            ...(foreground ? { foreground } : {}),
            ...(background ? { background } : {}),
            ...(textStyle ? { textStyle } : {}),
          })
          : toSlateChild(item, ids, props.style as Record<string, unknown>, false, {
            color: foreground,
            backgroundColor: background,
          }, childAvailable)];
      })));
    }
    // Slate text widgets are single-line by design; a newline character is
    // treated as a zero-width glyph by the ANSI painter. Split it into a
    // column of text widgets so streamed answers, diffs and pasted content
    // keep their actual terminal rows.
    const lines = value.split('\n');
    return cache(slateElement('container', {
      id: `${child.id}:lines`,
      style: { ...(props.style as Record<string, unknown>), flexDirection: 'column', height: lines.length, flexShrink: 0 },
      ...(foreground ? { foreground } : {}),
      ...(background ? { background } : {}),
    }, ...lines.map((line, index) => slateElement('text', {
      id: `${child.id}:line:${index}`,
      text: line,
      ...(foreground ? { foreground } : {}),
      ...(background ? { background } : {}),
      ...(textStyle ? { textStyle } : {}),
    }))));
  }
  const children = child.children.map(
    (item) => toSlateChild(item, ids, props.style as Record<string, unknown>, false, undefined, childAvailable),
  );
  if (typeof child.props.borderStyle === 'string') {
    const style = props.style as Record<string, unknown>;
    const borderWidth = resolvedWidth !== undefined ? Math.max(3, resolvedWidth) : undefined;
    const naturalHeight = child.props.height === undefined;
    const bodyHeight = naturalHeight
      ? Math.max(1, intrinsicHostSize(child, 'height'))
      : typeof style.height === 'number'
        ? Math.max(1, Math.floor(style.height) - 2)
      : 1;
    const foreground = typeof child.props.borderColor === 'string' ? child.props.borderColor : undefined;
    const contentStyle: Record<string, unknown> = {
      ...style,
      flexDirection: style.flexDirection ?? 'row',
      height: bodyHeight,
      ...(borderWidth === undefined ? {} : { width: Math.max(1, borderWidth - 2) }),
      paddingLeft: Number(style.paddingLeft ?? 0) + 1,
      paddingRight: Number(style.paddingRight ?? 0) + 1,
    };
    const top = borderWidth === undefined ? '\u256d\u2500\u256e' : `\u256d${'\u2500'.repeat(borderWidth - 2)}\u256e`;
    const bottom = borderWidth === undefined ? '\u2570\u2500\u256f' : `\u2570${'\u2500'.repeat(borderWidth - 2)}\u256f`;
    let borderTextIndex = 0;
    let borderRailIndex = 0;
    const text = (value: string): SlateChild => slateElement('text', {
      id: `${child.id}:border-text:${borderTextIndex++}`,
      text: value,
      ...(foreground ? { foreground } : {}),
    });
    const rail = (): SlateChild => slateElement('container', {
      id: `${child.id}:border-rail:${borderRailIndex++}`,
      style: { flexDirection: 'column', width: 1, height: bodyHeight, flexShrink: 0 },
    }, ...Array.from({ length: bodyHeight }, () => text('\u2502')));
    const middle = slateElement('container', {
      id: `${child.id}:border-middle`,
      style: { flexDirection: 'row', height: bodyHeight, ...(borderWidth === undefined ? {} : { width: borderWidth }) },
    }, rail(), slateElement('container', {
      id: `${child.id}:border-content`,
      style: contentStyle,
    }, ...children), rail());
    const wrapperStyle = {
      ...style,
      flexDirection: 'column',
      height: bodyHeight + 2,
      padding: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    };
    return cache(slateElement('container', {
      id: `${child.id}:border`,
      style: wrapperStyle,
    }, text(top), middle, text(bottom)));
  }
  return cache(slateElement(child.nodeType === 'scroll' ? 'scrollView' : 'container', props, ...children));
}

/**
 * Intrinsic size is a whole-subtree walk, and `toSlateChild` asks for it once
 * per container — which made a frame cost O(nodes x depth). On a long
 * transcript that walk outran the 120 ms animation clock, so ticks were
 * dropped and the shell looked frozen rather than merely slow. The result
 * depends only on the subtree, and `bumpRevision` already propagates a child's
 * change to every ancestor, so caching per node revision is exact.
 */
const intrinsicSizeCache = new WeakMap<HostNode, { revision: number; width?: number; height?: number }>();

function intrinsicHostSize(child: HostNode, axis: 'width' | 'height'): number {
  const cached = intrinsicSizeCache.get(child);
  if (cached?.revision === child.revision) {
    const hit = cached[axis];
    if (hit !== undefined) return hit;
  }
  const value = measureIntrinsicHostSize(child, axis);
  const entry = cached?.revision === child.revision ? cached : { revision: child.revision };
  entry[axis] = value;
  intrinsicSizeCache.set(child, entry);
  return value;
}

function measureIntrinsicHostSize(child: HostNode, axis: 'width' | 'height'): number {
  if (child.nodeType === 'text') {
    const value = flattenHostText(child);
    if (axis === 'height') return Math.max(1, value.split(/\r?\n/).length);
    return Math.max(1, ...value.split(/\r?\n/).map((line) => displayWidth(line)));
  }

  const style = normalizeStyle(child.props);
  const padding = axis === 'height'
    ? Number(style.paddingTop ?? 0) + Number(style.paddingBottom ?? 0)
    : Number(style.paddingLeft ?? 0) + Number(style.paddingRight ?? 0);
  const direction = style.flexDirection === 'column' ? 'column' : 'row';
  const gap = Number(direction === 'column' ? style.rowGap ?? style.gap ?? 0 : style.columnGap ?? style.gap ?? 0);
  const children = child.children.filter((item): item is HostNode => item.kind === 'node');
  const sizes = children.map((item) => {
    const itemStyle = normalizeStyle(item.props);
    const margin = axis === 'height'
      ? Number(itemStyle.marginTop ?? 0) + Number(itemStyle.marginBottom ?? 0)
      : Number(itemStyle.marginLeft ?? 0) + Number(itemStyle.marginRight ?? 0);
    const border = typeof item.props.borderStyle === 'string' ? 2 : 0;
    return intrinsicHostSize(item, axis) + border + margin;
  });
  const own = direction === 'column'
    ? axis === 'height' ? sizes.reduce((sum, value) => sum + value, 0) + Math.max(0, sizes.length - 1) * gap : Math.max(0, ...sizes)
    : axis === 'width' ? sizes.reduce((sum, value) => sum + value, 0) + Math.max(0, sizes.length - 1) * gap : Math.max(0, ...sizes);
  const explicit = style[axis];
  const explicitSize = typeof explicit === 'number' && Number.isFinite(explicit) ? explicit : 0;
  // Content that scrolls or is clipped does not enlarge the box that holds it.
  //
  // Without this, a viewport with a fixed height measured as tall as
  // everything inside it, and the parent then placed the *next* sibling —
  // the prompt — below that phantom height, off the bottom of the terminal.
  // The transcript looked fine and the input was simply gone.
  const clipped = axis === 'height' && (
    child.nodeType === 'scroll' ||
    style.overflow === 'scroll' || style.overflow === 'hidden' ||
    style.overflowY === 'scroll' || style.overflowY === 'hidden'
  );
  if (clipped && explicitSize > 0) return Math.max(1, Math.ceil(explicitSize + padding));
  return Math.max(1, Math.ceil(Math.max(own, explicitSize) + padding));
}

function flattenHostText(node: HostNode): string {
  return node.children.map((child) => child.kind === 'text' ? child.value : flattenHostText(child)).join('');
}

function treeFor(root: UiRoot, available: number): SlateChild {
  const ids = { value: 0 };
  if (root.children.length === 1) {
    return toSlateChild(root.children[0]!, ids, undefined, true, undefined, available);
  }
  return slateElement(
    slateFragment,
    {},
    ...root.children.map((child) => toSlateChild(child, ids, undefined, false, undefined, available)),
  );
}

/** Convert Slate's canonical modifier bits into the legacy key shape. */
export function keyForEvent(event: SlateEvent): Key {
  const code = (event.code ?? '').toLowerCase();
  const modifiers = event.modifiers ?? 0;
  return {
    upArrow: code === 'up' || code === 'arrowup',
    downArrow: code === 'down' || code === 'arrowdown',
    leftArrow: code === 'left' || code === 'arrowleft',
    rightArrow: code === 'right' || code === 'arrowright',
    pageUp: code === 'pageup',
    pageDown: code === 'pagedown',
    home: code === 'home',
    end: code === 'end',
    return: code === 'enter' || code === 'return',
    escape: code === 'escape' || code === 'esc',
    tab: code === 'tab',
    backspace: code === 'backspace',
    delete: code === 'delete' || code === 'del',
    // Slate's canonical modifier bits are SHIFT=1, CONTROL=2, ALT=4 and
    // SUPER=8. The old adapter had SHIFT and CONTROL reversed, so every
    // shifted printable key (A, :, ., ;, ç on an ABNT layout, etc.) was
    // classified as Ctrl input and discarded by the prompt.
    ctrl: (modifiers & 2) !== 0,
    shift: (modifiers & 1) !== 0,
    alt: (modifiers & 4) !== 0,
    super: (modifiers & 8) !== 0,
    meta: (modifiers & (4 | 8)) !== 0,
  };
}

function keyForRaw(char: string): Key {
  const code = char === '\r' || char === '\n' ? 'enter'
    : char === '\u001b' ? 'escape'
      : char === '\u007f' || char === '\b' ? 'backspace'
        // Tab is a named key everywhere else in the app - it walks the screen
        // bar, it drives completion - so the raw path has to name it too, or a
        // terminal that reaches this path silently loses it.
        : char === '\t' ? 'tab'
          : '';
  return keyForEvent({
    kind: 'key',
    code,
    text: char,
    modifiers: char.length === 1 && char.charCodeAt(0) > 0 && char.charCodeAt(0) < 32 ? 2 : 0,
  });
}

/** Recover printable text when a native terminal reports only a key code. */
function printableTextForEvent(event: SlateEvent): string {
  if (event.text) return event.text;
  const code = event.code ?? '';
  if (code.length === 1) return code;
  const modifiers = event.modifiers ?? 0;
  const shifted = (modifiers & 1) !== 0;
  if (/^Key[A-Za-z]$/.test(code)) return shifted ? code.slice(3).toUpperCase() : code.slice(3).toLowerCase();
  const punctuation: Record<string, [string, string]> = {
    Semicolon: [';', ':'],
    Comma: [',', '<'],
    Period: ['.', '>'],
    Slash: ['/', '?'],
    Quote: ["'", '"'],
    Backquote: ['`', '~'],
    Minus: ['-', '_'],
    Equal: ['=', '+'],
    BracketLeft: ['[', '{'],
    BracketRight: [']', '}'],
    Backslash: ['\\', '|'],
  };
  return punctuation[code]?.[shifted ? 1 : 0] ?? '';
}

function dispatchRawInput(
  raw: string,
  input: EventEmitter,
  inputListeners: ReadonlySet<(char: string, key: Key) => void>,
): void {
  let cursor = 0;
  while (cursor < raw.length) {
    const length = Math.max(1, clusterLength(raw, cursor));
    let char = raw.slice(cursor, cursor + length);
    let key = keyForRaw(char);
    if (char === '\u001b' && raw[cursor + 1] === '[') {
      const sequence = raw.slice(cursor, cursor + 3);
      const code = sequence === '\u001b[A' ? 'up'
        : sequence === '\u001b[B' ? 'down'
          : sequence === '\u001b[C' ? 'right'
            : sequence === '\u001b[D' ? 'left'
              : '';
      if (code) {
        char = sequence;
        key = keyForEvent({ kind: 'key', code, text: '' });
        cursor += 3;
      } else {
        cursor += 1;
      }
    } else {
      // A data chunk is UTF-8 decoded before it reaches this fallback. Keep a
      // full grapheme together so pasted accents and emoji cannot be split into
      // separate React/Slate text instances.
      cursor += length;
    }
    input.emit('input', char);
    for (const listener of [...inputListeners]) listener(char, key);
  }
}

function dispatchSlateEvent(
  event: SlateEvent,
  input: EventEmitter,
  stdout: NodeJS.WriteStream,
  inputListeners: ReadonlySet<(char: string, key: Key) => void>,
): void {
  // Native Slate mouse events are already normalized and use one-based
  // terminal coordinates. Re-encoding them as an SGR string would shift the
  // hit target and send scroll reports as fake left clicks. Mouse consumers
  // receive the typed event directly through useSlateEvent instead.
  if (event.kind === 'mouse') return;
  // The native source reports both key press and key release. Ink's useInput
  // contract exposes a key once, so releases must never become a second
  // printable character in the composer.
  if (event.kind === 'key' && event.phase === 'release') return;
  if (event.kind === 'resize') {
    if (event.width !== undefined) (stdout as NodeJS.WriteStream & { columns?: number }).columns = event.width;
    if (event.height !== undefined) (stdout as NodeJS.WriteStream & { rows?: number }).rows = event.height;
    stdout.emit('resize');
    return;
  }
  let char = '';
  if (event.kind === 'paste') char = `\u001b[200~${event.text ?? ''}\u001b[201~`;
  else if (event.kind === 'key') char = printableTextForEvent(event);
  if (!char && event.kind !== 'key') return;
  input.emit('input', char);
  const key = keyForEvent(event);
  for (const listener of [...inputListeners]) listener(char, key);
}

/**
 * Preserve distinct repeated keypresses across Slate's semantic deduplicator.
 *
 * The normalizer intentionally drops the same event returned twice by a noisy
 * source. A real keyboard can, however, legitimately produce `aa` as two
 * adjacent `press` events. Give those adjacent events alternating press/repeat
 * phases before the controller normalizes them; the phase is ignored by the
 * prompt and keeps both characters alive.
 */
function createLosslessInputSource(): ReturnType<typeof createInputSource> {
  const source = createInputSource();
  let previousSignature: string | null = null;
  let duplicatePhase: 'press' | 'repeat' = 'press';
  return {
    poll(timeoutMs?: number): SlateEvent | null {
      const event = source.poll(timeoutMs);
      if (!event) {
        previousSignature = null;
        duplicatePhase = 'press';
        return null;
      }
      if (event.kind !== 'key' || event.phase === 'release') {
        previousSignature = null;
        duplicatePhase = 'press';
        return event;
      }
      const signature = JSON.stringify([event.code ?? null, event.text ?? null, event.modifiers ?? 0]);
      if (signature === previousSignature) {
        duplicatePhase = duplicatePhase === 'press' ? 'repeat' : 'press';
        previousSignature = signature;
        return { ...event, phase: duplicatePhase };
      }
      previousSignature = signature;
      duplicatePhase = event.phase === 'repeat' ? 'repeat' : 'press';
      return event.phase === undefined ? { ...event, phase: 'press' } : event;
    },
    close: source.close,
    size: source.size,
  };
}

function normalizeSlateFrame(frame: string): string {
  const lines = frame.split('\n');
  // Slate's ANSI renderer separates control codes with newlines for readable
  // captured output. In a real terminal those newlines move the cursor, so
  // collapse only the control prelude and retain the complete viewport body.
  // The built-in terminal controller owns frame deduplication and the
  // clear-once policy; this adapter only normalizes the wire representation.
  let preludeEnd = 0;
  while (preludeEnd < lines.length && /^(?:\u001b\[[0-?]*[ -/]*[@-~])+$/.test(lines[preludeEnd] ?? '')) {
    preludeEnd += 1;
  }
  return lines.slice(0, preludeEnd).join('') + lines.slice(preludeEnd).join('\n');
}

/**
 * Do not let a slow terminal output buffer turn streamed frames into a queue.
 *
 * `stdout.write()` can return false on Windows Terminal, pipes and redirected
 * output. Keeping every frame in that case makes the UI show stale frames long
 * after the model has moved on. A terminal frame is a snapshot, so only the
 * newest pending snapshot has value; intermediate frames can be discarded.
 */
function createCoalescingWriter(stdout: NodeJS.WriteStream): {
  readonly write: (frame: string) => void;
  readonly dispose: () => void;
} {
  let pending: string | null = null;
  let waitingDrain = false;
  let disposed = false;

  const pump = (): void => {
    if (disposed || waitingDrain || pending === null) return;
    const frame = pending;
    pending = null;
    if (!stdout.write(frame)) {
      waitingDrain = true;
      stdout.once('drain', onDrain);
    }
  };
  const onDrain = (): void => {
    waitingDrain = false;
    pump();
  };

  return {
    write(frame) {
      if (disposed) return;
      pending = frame;
      pump();
    },
    dispose() {
      disposed = true;
      pending = null;
      if (waitingDrain) stdout.off('drain', onDrain);
      waitingDrain = false;
    },
  };
}

const hostConfig = {
  // React 19's reconciler asks the host for the current update priority even
  // for a synchronous terminal renderer. Keep this renderer synchronous and
  // mirror Slate's official React adapter for the rest of the host contract.
  now: () => Date.now(),
  getCurrentUpdatePriority: () => 1,
  setCurrentUpdatePriority: () => undefined,
  resolveUpdatePriority: () => 1,
  trackSchedulerEvent: () => undefined,
  getRootHostContext: () => ({ insideText: false }),
  getChildHostContext: (parent: { insideText: boolean }, type: string) => ({ insideText: parent.insideText || type === 'slate-text' }),
  prepareForCommit: () => null,
  clearContainer: (root: UiRoot) => {
    for (const child of root.children) forgetHitTargets(child);
    root.children.length = 0;
    return false;
  },
  resetAfterCommit: (root: UiRoot) => root.repaint(),
  shouldSetTextContent: () => false,
  createInstance: (type: string, props: UiProps) => ({
    kind: 'node',
    id: `host-${++hostNodeSequence}`,
    nodeType: type === 'slate-text' ? 'text' : type === 'slate-scroll' ? 'scroll' : 'container',
    props: { ...props },
    children: [],
    revision: 0,
  }) as HostNode,
  createTextInstance: (value: string, _root: UiRoot, parent: { insideText: boolean }) => {
    if (!parent.insideText) throw new Error('Text must be rendered inside Text');
    return { kind: 'text', id: `host-${++hostNodeSequence}`, value, revision: 0 } as HostText;
  },
  appendInitialChild: (parent: HostNode, child: HostChild) => {
    attachChild(parent, child);
    parent.children.push(child);
  },
  appendChild: (parent: HostNode, child: HostChild) => {
    const existing = parent.children.indexOf(child);
    if (existing >= 0) parent.children.splice(existing, 1);
    attachChild(parent, child);
    parent.children.push(child);
    bumpRevision(parent);
  },
  appendChildToContainer: (root: UiRoot, child: HostChild) => {
    const existing = root.children.indexOf(child);
    if (existing >= 0) root.children.splice(existing, 1);
    root.children.push(child);
  },
  insertBefore: (parent: HostNode, child: HostChild, before: HostChild) => {
    const existing = parent.children.indexOf(child);
    if (existing >= 0) parent.children.splice(existing, 1);
    attachChild(parent, child);
    const target = parent.children.indexOf(before);
    if (target < 0) parent.children.push(child);
    else parent.children.splice(target, 0, child);
    bumpRevision(parent);
  },
  insertInContainerBefore: (root: UiRoot, child: HostChild, before: HostChild) => {
    const existing = root.children.indexOf(child);
    if (existing >= 0) root.children.splice(existing, 1);
    const target = root.children.indexOf(before);
    if (target < 0) root.children.push(child);
    else root.children.splice(target, 0, child);
  },
  removeChild: (parent: HostNode, child: HostChild) => {
    const index = parent.children.indexOf(child);
    if (index < 0) return;
    parent.children.splice(index, 1);
    detachChild(parent, child);
    bumpRevision(parent);
  },
  removeChildFromContainer: (root: UiRoot, child: HostChild) => {
    const index = root.children.indexOf(child);
    if (index < 0) return;
    root.children.splice(index, 1);
    if (child.kind === 'node' || child.kind === 'text') child.parent = undefined;
    forgetHitTargets(child);
  },
  prepareUpdate: (_node: HostNode, _type: string, oldProps: UiProps, nextProps: UiProps) =>
    hostPropsEqual(oldProps, nextProps) ? null : true,
  commitUpdate: (node: HostNode, _type: string, _old: UiProps, next: UiProps) => {
    node.props = { ...next };
    bumpRevision(node);
  },
  commitTextUpdate: (node: HostText, _old: string, next: string) => {
    node.value = next;
    bumpRevision(node);
  },
  resetTextContent: () => undefined,
  hideInstance: (node: HostNode) => { node.props = { ...node.props, visible: false }; bumpRevision(node); },
  unhideInstance: (node: HostNode) => { node.props = { ...node.props, visible: true }; bumpRevision(node); },
  hideTextInstance: (node: HostText) => { node.value = ''; bumpRevision(node); },
  unhideTextInstance: (node: HostText, value: string) => { node.value = value; bumpRevision(node); },
  finalizeInitialChildren: () => false,
  getPublicInstance: (node: HostNode) => node,
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getCurrentEventPriority: () => DefaultEventPriority,
  maySuspendCommit: () => false,
  preloadInstance: () => undefined,
  startSuspendingCommit: () => undefined,
  suspendInstance: () => undefined,
  waitForCommitToBeReady: () => null,
  preparePortalMount: () => undefined,
  beforeActiveInstanceBlur: () => undefined,
  afterActiveInstanceBlur: () => undefined,
  detachDeletedInstance: () => undefined,
};

const reconciler = createReconciler(hostConfig as never) as any;

export interface RenderOptions {
  readonly stdout?: NodeJS.WriteStream;
  readonly stdin?: NodeJS.ReadStream;
  readonly exitOnCtrlC?: boolean;
  readonly patchConsole?: boolean;
}

export function render(element: React.ReactElement, options: RenderOptions = {}): {
  readonly unmount: () => void;
  readonly waitUntilExit: () => Promise<void>;
} {
  const stdout = options.stdout ?? process.stdout;
  const stdin = options.stdin ?? process.stdin;
  const input = new EventEmitter();
  const inputListeners = new Set<(char: string, key: Key) => void>();
  const slateEventListeners = new Set<(event: SlateEvent) => void>();
  const subscribeInput = (handler: (char: string, key: Key) => void): (() => void) => {
    inputListeners.add(handler);
    return () => { inputListeners.delete(handler); };
  };
  const subscribeSlateEvent = (handler: (event: SlateEvent) => void): (() => void) => {
    slateEventListeners.add(handler);
    return () => { slateEventListeners.delete(handler); };
  };
  let resolveExit!: () => void;
  let paintScheduled = false;
  let skipNextRepaint = false;
  let terminalController: ReturnType<typeof createTerminalController> | null = null;
  let renderFailure: unknown;
  const initialViewport = {
    width: stdout.columns ?? 80,
    height: stdout.rows ?? 24,
  };
  let viewport = initialViewport;
  const syncViewport = (): void => {
    const next = {
      width: stdout.columns ?? 80,
      height: stdout.rows ?? 24,
    };
    if (next.width === viewport.width && next.height === viewport.height) return;
    viewport = next;
    slate.setViewport(next);
  };
  const exited = new Promise<void>((resolve) => { resolveExit = resolve; });
  const root: UiRoot = { children: [], repaint: () => {
    if (paintScheduled) return;
    paintScheduled = true;
    queueMicrotask(() => {
      paintScheduled = false;
      if (skipNextRepaint) {
        skipNextRepaint = false;
        return;
      }
      // React owns the logical dimensions through useTerminalSize while
      // Slate owns the physical viewport. Keep both in lockstep for resize
      // events delivered by custom streams as well as the native poller.
      syncViewport();
      slate.render();
    });
  } };
  // Coalesce repaints onto a frame budget instead of painting on every
  // microtask.
  //
  // A frame rate of 0 makes Slate schedule with `queueMicrotask`, so a burst of
  // work — a streaming turn arriving as dozens of deltas per 100 ms, a resize,
  // an animation tick landing beside them — produced one full render, layout
  // and paint *per event*. The terminal cannot show them, and the event loop
  // spent on them is the loop the animation clock needed to keep its own
  // cadence, which is what made a busy session feel like it was dropping every
  // other frame. Bounding the work at 60 Hz costs at most 16 ms of latency on
  // the first event of a burst, and returns the rest of the budget.
  const slate = createSlateApp(() => treeFor(root, viewport.width), {
    viewport: initialViewport,
    autoMount: false,
    frameRate: SLATE_FRAME_RATE,
  });
  const container = reconciler.createContainer(root, 0, null, false, null, 'plif', () => undefined, null);
  const value = {
    exit: () => {
      terminalController?.stop();
      reconciler.updateContainer(null, container, null, resolveExit);
    },
    stdin,
    stdout,
    input,
    subscribeInput,
    subscribeSlateEvent,
  };
  const mountedElement = React.createElement(context.Provider, { value }, element);
  // React 19 schedules updateContainer asynchronously. Mount the initial
  // tree synchronously so Slate's first frame is never an empty viewport;
  // subsequent state updates can keep using the normal concurrent path.
  if (typeof reconciler.updateContainerSync === 'function') {
    reconciler.updateContainerSync(mountedElement, container, null, undefined);
    reconciler.flushSyncWork?.();
  } else {
    reconciler.updateContainer(mountedElement, container, null, undefined);
  }
  // React's passive-effect queue is normally drained by a browser host. A CLI
  // renderer has no browser scheduler, so flush the first batch here; this
  // starts input listeners and animation clocks before render() returns.
  reconciler.flushPassiveEffects?.();
  const onData = (chunk: Buffer | string): void => dispatchRawInput(
    typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
    input,
    inputListeners,
  );
  if (stdin !== process.stdin) stdin.on('data', onData);

  // Let Slate's own controller be the sole owner of both native polling and
  // terminal writes. React still supplies the legacy component tree, while
  // Slate now handles clear-once, full-viewport repainting and event routing.
  // A no-op source keeps previews/tests on their injected stdin stream and
  // prevents a real terminal's native queue from leaking into them.
  slate.subscribeInput((event) => {
    if (event.kind === 'resize') slate.setViewport({
      width: event.width ?? stdout.columns ?? 80,
      height: event.height ?? stdout.rows ?? 24,
    });
    for (const listener of [...slateEventListeners]) listener(event);
    dispatchSlateEvent(event, input, stdout, inputListeners);
    // App-level listeners observe the normalized event, while Slate's own
    // scrollView/list handlers still need the event for wheel and paging.
    return 'ignored';
  });
  syncViewport();
  slate.render();
  // If React committed synchronously, the explicit flush above already
  // mounted the tree and the queued host repaint is redundant. React 19 may
  // commit asynchronously, though; in that case the queued repaint is the
  // first one that can see the mounted React children and must be preserved.
  skipNextRepaint = root.children.length > 0;
  const nativeTerminal = stdout === process.stdout && stdin === process.stdin;
  // createTerminalController already applies Slate's canonical input
  // normalizer. Wrapping the native source here caused a second deduplication
  // window and made fast repeated/pasted characters disappear.
  const source = nativeTerminal ? createLosslessInputSource() : { poll: () => null };
  const output = createCoalescingWriter(stdout);
  terminalController = createTerminalController(
    slate,
    source,
    { write: (frame) => output.write(normalizeSlateFrame(frame)) },
    {
      intervalMs: 16,
      animationFps: 0,
      render: { hideCursor: true },
      // Slate stops the controller on a render error, which leaves a frozen
      // terminal and no explanation. Record it so the failure is at least
      // reported when the process ends instead of looking like a hang.
      onError: (error: unknown) => { renderFailure = error; },
    },
  );
  terminalController.start();
  return {
    unmount: () => {
      if (renderFailure !== undefined) {
        process.stderr.write(`plif: the terminal renderer stopped: ${
          renderFailure instanceof Error ? renderFailure.stack ?? renderFailure.message : String(renderFailure)
        }
`);
        renderFailure = undefined;
      }
      terminalController?.dispose();
      terminalController = null;
      output.dispose();
      if (stdin !== process.stdin) stdin.off('data', onData);
      slate.unmount();
      reconciler.updateContainer(null, container, null, resolveExit);
    },
    waitUntilExit: () => exited,
  };
}

export function enableSlateMouse(): void {
  enableMouseCapture();
}
