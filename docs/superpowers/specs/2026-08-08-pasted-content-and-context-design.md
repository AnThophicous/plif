# Pasted Content Attachments and DeepSeek Context Design

## Goal

Make every clipboard paste a compact attachment in the Plif CLI while sending its complete content to the model, add multiline input with `Shift+Enter`, and use the 1,000,000-token context window of the default OpenCode DeepSeek model.

## User Experience

- Every paste creates a sequential marker in the prompt: `[Pasted Content #N - X Lines]`.
- The marker is the only representation shown in the prompt and message timeline; pasted payloads never flood the terminal UI.
- The model receives the complete pasted payload alongside the user message. A text paste is transmitted as text attachment content and an image paste is transmitted as image bytes.
- `X Lines` is the number of logical lines in a text paste. Image-only pastes use `0 Lines`.
- `Enter` submits the current message (or queues it while the agent is busy). `Shift+Enter` inserts a newline at the cursor without submitting.
- The prompt is rendered as a multiline field. It preserves manual newlines and wraps only after the usable width of the input box is reached; it does not wrap early to reserve unnecessary empty space.

## Architecture

### Clipboard and attachment model

Extend the core `Attachment` union so a user message may carry either image data or text data. The CLI maintains one ordered pending-attachment collection for every pasted payload. Clipboard handling identifies image clipboard data first; otherwise it reads text, sanitizes unsafe terminal control characters while preserving line breaks, assigns the next generic marker, and retains the full text in the pending attachment.

When the message is submitted, the CLI appends the compact markers to the visible message text and encodes the pending attachments for the model request. Queued messages retain their associated attachments until the agent drains that exact queued message, so no attachment is lost or sent with a different message.

The OpenAI-compatible provider serializes text attachments into the user content sent on the wire, while image attachments keep their existing image-url serialization. The model therefore sees the complete payload even though the terminal only renders the marker.

### Multiline prompt

Replace one-line cursor windowing with a width-aware layout function. It divides input into display rows using explicit newlines and soft wraps at the final usable cell. The renderer displays those rows inside the existing bordered prompt and places the synthetic cursor at the correct grapheme boundary. Long unbroken text wraps at the boundary rather than before it; normal whitespace is preferred as a wrap point only when it fits at the boundary.

### Context budget

Set the exported default context budget to `1_000_000`. Both interactive run-loop calls and the header meter already consume this shared value, so compaction thresholds and UI capacity remain aligned with the DeepSeek V4 Flash Free model's context window.

## Error Handling

- An empty or unsupported clipboard paste produces the existing non-fatal notice and does not change the prompt.
- Image-size validation remains in place.
- If an image file cannot be read at send time, the CLI warns and sends the rest of the message and attachments.
- Text attachment content remains in memory through send; no project file is created for a pasted text payload.

## Tests

- Unit-test text paste sanitization, line counts, marker numbering, and preservation of the complete attached text.
- Unit-test generic attachment encoding and OpenAI request serialization for text and images.
- Unit-test `Shift+Enter`, normal `Enter`, explicit newline rendering, soft wrapping at the usable boundary, and cursor placement across wrapped rows.
- Assert the default context constant and CLI session budget are one million tokens.
