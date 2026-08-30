import { EventEmitter } from 'node:events';
import React, { createContext, useContext, useEffect } from 'react';
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
import { displayWidth } from './text.js';

/** React host backed by Slate's flex and ANSI renderer. */

type UiProps = Record<string, unknown>;
type HostText = { kind: 'text'; value: string };
type HostNode = {
  kind: 'node';
  nodeType: 'container' | 'text';
  props: UiProps;
  children: Array<HostNode | HostText>;
};
type HostChild = HostNode | HostText;

function slateElement(
  type: string | symbol,
  props: Record<string, unknown>,
  ...children: SlateChild[]
): SlateChild {
  return createSlateElement(type as never, props as never, ...children) as unknown as SlateChild;
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
  readonly meta: boolean;
}

export function Box(props: UiProps & { readonly children?: React.ReactNode }): React.ReactElement {
  return React.createElement('slate-container', props);
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
  useEffect(() => {
    return value.subscribeInput(handler);
  }, [handler, value]);
}

function normalizeStyle(props: UiProps): Record<string, unknown> {
  const style: Record<string, unknown> = {
    // Ink's Box defaults to a horizontal row; Slate's container defaults to
    // a column. Keep the established Plif layout contract unless a component
    // explicitly asks for a column.
    flexDirection: props.flexDirection ?? 'row',
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
  return style;
}

function toSlateChild(
  child: HostChild,
  ids: { value: number },
  parentStyle?: Record<string, unknown>,
  isRoot = false,
  inheritedVisual?: { readonly color?: string; readonly backgroundColor?: string },
): SlateChild {
  if (child.kind === 'text') return child.value;
  const props: Record<string, unknown> = {
    id: `react-${ids.value++}`,
    style: normalizeStyle(child.props),
  };
  const style = props.style as Record<string, unknown>;
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
  if (
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
  if (child.props.visible !== undefined) props.visible = child.props.visible;
  if (child.props.focusable !== undefined) props.focusable = child.props.focusable;
  const press = child.props.onPress ?? child.props.onClick;
  if (typeof press === 'function') props.onPress = press;
  if (typeof child.props.onMouse === 'function') props.onMouse = child.props.onMouse;
  if (typeof child.props.onKey === 'function') props.onKey = child.props.onKey;
  // Slate's text widget owns one terminal line. React/Ink commonly nests
  // several Text nodes to style spans inline; leaving them as Slate children
  // would make Flex place each span on a separate row. Coalesce the spans so
  // prose, prompts and model reasoning retain their inline geometry.
  if (child.nodeType === 'text') {
    const value = flattenHostText(child).replace(/\r\n/g, '\n');
    const nested = child.children.some((item) => item.kind === 'node');
    if (!value.includes('\n') && !nested) {
      props.text = value;
      return slateElement('text', props);
    }
    if (nested && !value.includes('\n')) {
      return slateElement('container', {
        id: `react-${ids.value++}`,
        style: { ...(props.style as Record<string, unknown>), flexDirection: 'row', height: 1, flexShrink: 0 },
        ...(foreground ? { foreground } : {}),
        ...(background ? { background } : {}),
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
            id: `react-${ids.value++}`,
            text: item.value,
            ...(foreground ? { foreground } : {}),
            ...(background ? { background } : {}),
          })
          : toSlateChild(item, ids, props.style as Record<string, unknown>, false, {
            color: foreground,
            backgroundColor: background,
          })];
      }));
    }
    // Slate text widgets are single-line by design; a newline character is
    // treated as a zero-width glyph by the ANSI painter. Split it into a
    // column of text widgets so streamed answers, diffs and pasted content
    // keep their actual terminal rows.
    const lines = value.split('\n');
    return slateElement('container', {
      id: `react-${ids.value++}`,
      style: { ...(props.style as Record<string, unknown>), flexDirection: 'column', height: lines.length, flexShrink: 0 },
      ...(foreground ? { foreground } : {}),
      ...(background ? { background } : {}),
    }, ...lines.map((line) => slateElement('text', {
      id: `react-${ids.value++}`,
      text: line,
      ...(foreground ? { foreground } : {}),
      ...(background ? { background } : {}),
    })));
  }
  const children = child.children.map((item) => toSlateChild(item, ids, props.style as Record<string, unknown>));
  if (typeof child.props.borderStyle === 'string') {
    const style = props.style as Record<string, unknown>;
    const width = typeof style.width === 'number' ? style.width : undefined;
    const borderWidth = width !== undefined ? Math.max(3, Math.floor(width)) : undefined;
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
    const text = (value: string): SlateChild => slateElement('text', {
      id: `react-${ids.value++}`,
      text: value,
      ...(foreground ? { foreground } : {}),
    });
    const rail = (): SlateChild => slateElement('container', {
      id: `react-${ids.value++}`,
      style: { flexDirection: 'column', width: 1, height: bodyHeight, flexShrink: 0 },
    }, ...Array.from({ length: bodyHeight }, () => text('\u2502')));
    const middle = slateElement('container', {
      id: `react-${ids.value++}`,
      style: { flexDirection: 'row', height: bodyHeight, ...(borderWidth === undefined ? {} : { width: borderWidth }) },
    }, rail(), slateElement('container', {
      id: `react-${ids.value++}`,
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
    return slateElement('container', {
      id: `react-${ids.value++}`,
      style: wrapperStyle,
    }, text(top), middle, text(bottom));
  }
  return slateElement('container', props, ...children);
}

function intrinsicHostSize(child: HostNode, axis: 'width' | 'height'): number {
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
  return Math.max(1, Math.ceil(Math.max(own, explicitSize) + padding));
}

function flattenHostText(node: HostNode): string {
  return node.children.map((child) => child.kind === 'text' ? child.value : flattenHostText(child)).join('');
}

function treeFor(root: UiRoot): SlateChild {
  const ids = { value: 0 };
  if (root.children.length === 1) return toSlateChild(root.children[0]!, ids, undefined, true);
  return slateElement(slateFragment, {}, ...root.children.map((child) => toSlateChild(child, ids)));
}

function keyForEvent(event: SlateEvent): Key {
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
    ctrl: (modifiers & 1) !== 0,
    shift: (modifiers & 2) !== 0,
    meta: (modifiers & 4) !== 0,
  };
}

function keyForRaw(char: string): Key {
  const code = char === '\r' || char === '\n' ? 'enter'
    : char === '\u001b' ? 'escape'
      : char === '\u007f' || char === '\b' ? 'backspace'
        : '';
  return keyForEvent({
    kind: 'key',
    code,
    text: char,
    modifiers: char.length === 1 && char.charCodeAt(0) > 0 && char.charCodeAt(0) < 32 ? 1 : 0,
  });
}

function dispatchRawInput(
  raw: string,
  input: EventEmitter,
  inputListeners: ReadonlySet<(char: string, key: Key) => void>,
): void {
  let cursor = 0;
  while (cursor < raw.length) {
    let char = raw[cursor] ?? '';
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
      cursor += 1;
    }
    input.emit('input', char);
    for (const listener of [...inputListeners]) listener(char, key);
  }
}

function mouseSequence(event: SlateEvent): string {
  const button = event.button === 'right' ? 2 : event.button === 'middle' ? 1 : 0;
  const action = event.action === 'move' || event.action === 'drag' ? 32 : 0;
  const suffix = event.action === 'release' ? 'm' : 'M';
  return `\u001b[<${button | action};${Math.max(1, event.x ?? 0) + 1};${Math.max(1, event.y ?? 0) + 1}${suffix}`;
}

function dispatchSlateEvent(
  event: SlateEvent,
  input: EventEmitter,
  stdout: NodeJS.WriteStream,
  inputListeners: ReadonlySet<(char: string, key: Key) => void>,
): void {
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
  if (event.kind === 'mouse') char = mouseSequence(event);
  else if (event.kind === 'paste') char = `\u001b[200~${event.text ?? ''}\u001b[201~`;
  else if (event.kind === 'key') char = event.text ?? '';
  if (!char && event.kind !== 'key') return;
  input.emit('input', char);
  const key = keyForEvent(event);
  for (const listener of [...inputListeners]) listener(char, key);
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

const hostConfig = {
  getRootHostContext: () => ({ insideText: false }),
  getChildHostContext: (parent: { insideText: boolean }, type: string) => ({ insideText: parent.insideText || type === 'slate-text' }),
  prepareForCommit: () => null,
  clearContainer: (root: UiRoot) => { root.children.length = 0; return false; },
  resetAfterCommit: (root: UiRoot) => root.repaint(),
  shouldSetTextContent: () => false,
  createInstance: (type: string, props: UiProps) => ({
    kind: 'node',
    nodeType: type === 'slate-text' ? 'text' : 'container',
    props: { ...props },
    children: [],
  }) as HostNode,
  createTextInstance: (value: string, _root: UiRoot, parent: { insideText: boolean }) => {
    if (!parent.insideText) throw new Error('Text must be rendered inside Text');
    return { kind: 'text', value } as HostText;
  },
  appendInitialChild: (parent: HostNode, child: HostChild) => parent.children.push(child),
  appendChild: (parent: HostNode, child: HostChild) => parent.children.push(child),
  appendChildToContainer: (root: UiRoot, child: HostChild) => root.children.push(child),
  insertBefore: (parent: HostNode, child: HostChild, before: HostChild) => parent.children.splice(parent.children.indexOf(before), 0, child),
  insertInContainerBefore: (root: UiRoot, child: HostChild, before: HostChild) => root.children.splice(root.children.indexOf(before), 0, child),
  removeChild: (parent: HostNode, child: HostChild) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); },
  removeChildFromContainer: (root: UiRoot, child: HostChild) => { const index = root.children.indexOf(child); if (index >= 0) root.children.splice(index, 1); },
  prepareUpdate: () => true,
  commitUpdate: (node: HostNode, _payload: unknown, _type: string, _old: UiProps, next: UiProps) => { node.props = { ...next }; },
  commitTextUpdate: (node: HostText, _old: string, next: string) => { node.value = next; },
  resetTextContent: () => undefined,
  hideInstance: (node: HostNode) => { node.props = { ...node.props, visible: false }; },
  unhideInstance: (node: HostNode) => { node.props = { ...node.props, visible: true }; },
  hideTextInstance: (node: HostText) => { node.value = ''; },
  unhideTextInstance: (node: HostText, value: string) => { node.value = value; },
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
  const subscribeInput = (handler: (char: string, key: Key) => void): (() => void) => {
    inputListeners.add(handler);
    return () => { inputListeners.delete(handler); };
  };
  let resolveExit!: () => void;
  let paintScheduled = false;
  let skipNextRepaint = false;
  let terminalController: ReturnType<typeof createTerminalController> | null = null;
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
      slate.setViewport({
        width: stdout.columns ?? 80,
        height: stdout.rows ?? 24,
      });
      slate.flush();
    });
  } };
  const slate = createSlateApp(() => treeFor(root), {
    viewport: { width: stdout.columns ?? 80, height: stdout.rows ?? 24 },
    autoMount: false,
    frameRate: 0,
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
  };
  reconciler.updateContainer(React.createElement(context.Provider, { value }, element), container, null, undefined);
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
    dispatchSlateEvent(event, input, stdout, inputListeners);
    return 'consumed';
  });
  slate.setViewport({ width: stdout.columns ?? 80, height: stdout.rows ?? 24 });
  slate.flush();
  // updateContainer scheduled one host repaint before the controller existed;
  // the explicit flush above already mounted that tree. Drop only that stale
  // callback so the controller produces exactly one initial frame.
  skipNextRepaint = true;
  const nativeTerminal = stdout === process.stdout && stdin === process.stdin;
  const source = nativeTerminal ? createInputSource() : { poll: () => null };
  terminalController = createTerminalController(
    slate,
    source,
    { write: (frame) => stdout.write(normalizeSlateFrame(frame)) },
    { intervalMs: 8, animationFps: 0, render: { hideCursor: true } },
  );
  terminalController.start();
  return {
    unmount: () => {
      terminalController?.dispose();
      terminalController = null;
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
