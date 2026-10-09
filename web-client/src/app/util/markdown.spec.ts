import { escapeHtml, renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders bold, italic, and inline code', () => {
    expect(renderMarkdown('a **b** c')).toBe('<p>a <strong>b</strong> c</p>');
    expect(renderMarkdown('a *b* c')).toBe('<p>a <em>b</em> c</p>');
    expect(renderMarkdown('use `x = 1` here')).toBe(
      '<p>use <code>x = 1</code> here</p>',
    );
  });

  it('does not apply bold/italic inside inline code', () => {
    expect(renderMarkdown('`**not bold**`')).toBe(
      '<p><code>**not bold**</code></p>',
    );
  });

  it('renders every inline code span, not just the first', () => {
    expect(renderMarkdown('a `x` and `y` b')).toBe(
      '<p>a <code>x</code> and <code>y</code> b</p>',
    );
  });

  it('renders GitHub-style pipe tables', () => {
    const md = 'title | number\n--- | ---\ntest | 1\ntest | 2';
    expect(renderMarkdown(md)).toBe(
      '<table><thead><tr><th>title</th><th>number</th></tr></thead>' +
        '<tbody><tr><td>test</td><td>1</td></tr><tr><td>test</td><td>2</td></tr></tbody></table>',
    );
  });

  it('renders fenced code blocks verbatim', () => {
    const html = renderMarkdown('```js\nconst x = **1**;\n```');
    expect(html).toBe('<pre><code class="language-js">const x = **1**;</code></pre>');
  });

  it('renders headings, lists, and paragraphs', () => {
    expect(renderMarkdown('## Title')).toBe('<h2>Title</h2>');
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(renderMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
    expect(renderMarkdown('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });

  it('renders http(s) links and refuses other schemes', () => {
    expect(renderMarkdown('[x](https://example.com)')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe(
      '<p>[x](javascript:alert(1))</p>',
    );
  });

  it('escapes raw HTML so nothing executable can reach the DOM', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
  });
});
