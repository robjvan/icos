/**
 * Minimal, dependency-free Markdown → HTML for chat messages (M20a).
 *
 * Safety model: the source is HTML-escaped **first**, then a small subset of
 * Markdown is expanded into tags we generate ourselves. Raw HTML in a message
 * can therefore never reach the DOM — there is nothing to sanitize away. The
 * result is bound with Angular's `[innerHTML]`, which sanitizes again.
 *
 * Supported: fenced code blocks, ATX headings, GitHub-style pipe tables,
 * unordered/ordered lists, paragraphs, hard line breaks, inline code, bold,
 * italic, and http(s) links.
 */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FENCE = /^```(\w*)\s*$/;
const CLOSING_FENCE = /^```\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const UL_ITEM = /^\s*[-*]\s+/;
const OL_ITEM = /^\s*\d+\.\s+/;
/** A table's delimiter row: `--- | :---: | ---`, pipes optional at the edges. */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

/** Render a message body to safe HTML. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[1];
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !CLOSING_FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence (or run off the end)
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]);
      i += 2; // header row + separator row
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      out.push(renderTable(header, rows));
      continue;
    }

    if (UL_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_ITEM.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(UL_ITEM, ''))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (OL_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_ITEM.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(OL_ITEM, ''))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && !isBlockStart(lines, i)) {
      paragraph.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
  }

  return out.join('');
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    line.trim() === '' ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    UL_ITEM.test(line) ||
    OL_ITEM.test(line) ||
    isTableStart(lines, index)
  );
}

function isTableStart(lines: string[], index: number): boolean {
  return (
    index + 1 < lines.length &&
    lines[index].includes('|') &&
    TABLE_SEPARATOR.test(lines[index + 1])
  );
}

function splitRow(line: string): string[] {
  let cells = line.split('|');
  if (cells.length > 0 && cells[0].trim() === '') cells = cells.slice(1);
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') {
    cells = cells.slice(0, -1);
  }
  return cells.map((cell) => cell.trim());
}

function renderTable(header: string[], rows: string[][]): string {
  const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const INLINE_CODE = /`([^`]+)`/g;
const BOLD_STAR = /\*\*([^*]+)\*\*/g;
const BOLD_UNDERSCORE = /__([^_]+)__/g;
const ITALIC_STAR = /(^|[^*])\*([^*\n]+)\*/g;
const ITALIC_UNDERSCORE = /(^|[^_])_([^_\n]+)_/g;
const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
// Private-use sentinels (not control chars) wrap stashed inline code.
const CODE_OPEN = '\uE000';
const CODE_CLOSE = '\uE001';
const PLACEHOLDER = /\uE000(\d+)\uE001/g;

/** Inline transforms; the input is already HTML-escaped. */
function renderInline(text: string): string {
  let out = escapeHtml(text);

  // Inline code is stashed behind placeholders so bold/italic/link rules
  // cannot rewrite its (already-escaped) contents.
  const code: string[] = [];
  out = out.replace(INLINE_CODE, (_match, body: string) => {
    code.push(body);
    return `${CODE_OPEN}${code.length - 1}${CODE_CLOSE}`;
  });

  out = out
    .replace(BOLD_STAR, '<strong>$1</strong>')
    .replace(BOLD_UNDERSCORE, '<strong>$1</strong>')
    .replace(ITALIC_STAR, '$1<em>$2</em>')
    .replace(ITALIC_UNDERSCORE, '$1<em>$2</em>')
    .replace(
      LINK,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );

  return out.replace(
    PLACEHOLDER,
    (_match, index: string) => `<code>${code[Number(index)] ?? ''}</code>`,
  );
}
