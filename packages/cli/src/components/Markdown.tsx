import React from 'react';
import { Box, Text } from '../ui.js';

import { parseMarkdown, wrapSpans } from '../markdown.js';
import type { MdBlock, MdSpan } from '../markdown.js';
import { color, glyph } from '../theme.js';
import { wrapTerminalText } from '../text.js';

interface MarkdownProps {
  readonly source: string;
  readonly width: number;
  readonly dim?: boolean;
}

export const Markdown = React.memo(function Markdown({ source, width, dim = false }: MarkdownProps): React.ReactElement {
  const blocks = parseMarkdown(source);

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => (
        <Block key={index} block={block} width={width} dim={dim} />
      ))}
    </Box>
  );
});

Markdown.displayName = 'Markdown';

function Block({
  block,
  width,
  dim,
}: {
  block: MdBlock;
  width: number;
  dim: boolean;
}): React.ReactElement | null {
  switch (block.kind) {
    case 'blank':
      return <Text> </Text>;

    case 'rule':
      return <Text color={color('ghost')}>{'─'.repeat(Math.max(4, Math.min(width, 40)))}</Text>;

    case 'heading':
      return (
        <Box marginTop={block.level === 1 ? 1 : 0}>
          <Text color={color('text')} bold>
            {block.spans.map((span) => span.text).join('')}
          </Text>
        </Box>
      );

    case 'quote':
      return (
        <Box>
          <Text color={color('ghost')}>{glyph.rail} </Text>
          <Inline spans={block.spans} dim={dim} />
        </Box>
      );

    case 'code':
      return <CodeBlock language={block.language} lines={block.lines} width={width} />;

    case 'bullet': {
      const pad = '  '.repeat(block.indent);
      const lines = wrapSpans(block.spans, Math.max(8, width - pad.length - 2));
      return (
        <Box flexDirection="column">
          {lines.map((line, index) => (
            <Box key={index}>
              <Text color={color('accentDim')}>
                {pad}
                {index === 0 ? `${block.marker} ` : '  '}
              </Text>
              <Inline spans={line} dim={dim} />
            </Box>
          ))}
        </Box>
      );
    }

    case 'text': {
      const pad = '  '.repeat(block.indent);
      const lines = wrapSpans(block.spans, Math.max(8, width - pad.length));
      return (
        <Box flexDirection="column">
          {lines.map((line, index) => (
            <Box key={index}>
              {pad && <Text>{pad}</Text>}
              <Inline spans={line} dim={dim} />
            </Box>
          ))}
        </Box>
      );
    }
  }
}

function Inline({ spans, dim }: { spans: readonly MdSpan[]; dim: boolean }): React.ReactElement {
  return (
    <Text>
      {spans.map((span, index) => {
        switch (span.style) {
          case 'bold':
            return (
              <Text key={index} color={color('text')} bold>
                {span.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={index} color={color(dim ? 'faint' : 'muted')} italic>
                {span.text}
              </Text>
            );
          case 'code':
            return (
              <Text key={index} color={color('faint')} bold={span.strong ?? false}>
                {span.text}
              </Text>
            );
          case 'link':
            return (
              <Text key={index} color={color('muted')} underline bold={span.strong ?? false}>
                {span.text}
              </Text>
            );
          case 'strike':
            return (
              <Text key={index} color={color('ghost')} strikethrough>
                {span.text}
              </Text>
            );
          default:
            return (
              <Text key={index} color={color(dim ? 'muted' : 'text')}>
                {span.text}
              </Text>
            );
        }
      })}
    </Text>
  );
}

function CodeBlock({
  language,
  lines,
  width,
}: {
  language: string;
  lines: readonly string[];
  width: number;
}): React.ReactElement {
  const gutter = String(lines.length).length;
  const codeWidth = Math.max(1, width - gutter - 6);

  return (
    <Box flexDirection="column" marginY={0}>
      {language && <Text color={color('ghost')}>{'  '}{language}</Text>}
      {lines.flatMap((line, index) => wrapTerminalText(line, codeWidth).map((part, partIndex) => (
        <Box key={`${index}:${partIndex}`}>
          <Text color={color('ghost')}>
            {partIndex === 0
              ? `  ${String(index + 1).padStart(gutter)}  `
              : ' '.repeat(gutter + 4)}
          </Text>
          <Text color={color('muted')}>{part || ' '}</Text>
        </Box>
      )))}
    </Box>
  );
}
