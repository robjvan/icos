/**
 * Shared Markdown parsing for persona source files (M14b core, M14c
 * seeds). Pure and deterministic — the same text always yields the same
 * sections and statements.
 */

export interface MarkdownSection {
  heading: string;
  body: string;
  /** 0-based order of appearance; part of a seed statement's key. */
  ordinal: number;
}

/**
 * Split a Markdown document into `#`–`###` sections. Empty sections are
 * retained so a recognized-but-empty category can be warned about rather
 * than silently dropped.
 */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: MarkdownSection[] = [];
  let heading = '';
  let body: string[] = [];
  let ordinal = 0;
  const flush = () => {
    if (heading) {
      sections.push({ heading, body: body.join('\n').trim(), ordinal });
      ordinal += 1;
    }
    body = [];
  };

  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (match) {
      flush();
      heading = cleanMarkdown(match[1]);
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

/** Bullets and paragraphs become statements; code fences and short lines go. */
export function statementsIn(body: string): string[] {
  const statements: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const content = cleanMarkdown(paragraph.join(' '));
    if (content) {
      statements.push(content);
    }
    paragraph = [];
  };

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line === '---') {
      flush();
      continue;
    }
    if (/^```/.test(line)) {
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flush();
      const content = cleanMarkdown(bullet[1]);
      if (content) {
        statements.push(content);
      }
      continue;
    }
    paragraph.push(line.replace(/^>\s?/, ''));
  }
  flush();
  return statements.filter((statement) => statement.length >= 8);
}

/** Strip emphasis/backticks and collapse whitespace. */
export function cleanMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Unresolved `[bracketed]` template placeholders are never persisted. */
export function hasTemplatePlaceholder(content: string): boolean {
  return /\[(?:agent name|value\s*\d*|one sentence|direction\s*\d*|describe|current self|fill|your)/i.test(
    content,
  );
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
