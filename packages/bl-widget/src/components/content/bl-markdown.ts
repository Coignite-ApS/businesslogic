import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { resetStyles } from '../../theme.js';

/** Lightweight built-in markdown parser — no external dependency */
function parseMarkdown(md: string): string {
  if (!md) return '';

  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      out.push(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${codeLines.join('\n')}</code></pre>`);
      i++; // skip closing ```
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inlineFormat(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      out.push('<hr/>');
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote>${inlineFormat(bqLines.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^[-*+]\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      // Collect paragraph
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-blank lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|[-*+]\s|\d+\.\s|> |[-*_]{3,}$)/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      out.push(`<p>${inlineFormat(paraLines.join(' '))}</p>`);
    }
  }

  return out.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed;
  return '';
}

function inlineFormat(s: string): string {
  return s
    // Inline code (before bold/italic to avoid double-processing)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`)
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      const safe = sanitizeHref(href);
      if (!safe) return escapeHtml(text);
      return `<a href="${safe}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
    });
}

@customElement('bl-markdown')
export class BlMarkdown extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .md {
        font-size: 0.875rem;
        color: var(--bl-text-prose, var(--bl-text, #1f2937));
        line-height: 1.6;
      }
      .md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
        margin: 0.75em 0 0.25em;
        font-weight: 600;
        line-height: 1.25;
        color: var(--bl-text-emphasis, var(--bl-text, #1f2937));
      }
      .md h1 { font-size: 1.5rem; }
      .md h2 { font-size: 1.25rem; }
      .md h3 { font-size: 1.125rem; }
      .md h4 { font-size: 1rem; }
      .md p { margin: 0.5em 0; }
      .md ul, .md ol { margin: 0.5em 0; padding-left: 1.5em; }
      .md li { margin: 0.2em 0; }
      .md code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 0.8125em;
        background: var(--bl-bg-secondary, #f9fafb);
        border: 1px solid var(--bl-border, #e5e7eb);
        border-radius: var(--bl-radius-sm, 4px);
        padding: 1px 4px;
      }
      .md pre {
        margin: 0.5em 0;
        padding: var(--bl-spacing-sm, 8px) var(--bl-spacing, 16px);
        background: var(--bl-bg-secondary, #f9fafb);
        border: 1px solid var(--bl-border, #e5e7eb);
        border-radius: var(--bl-radius, 8px);
        overflow-x: auto;
      }
      .md pre code {
        background: none;
        border: none;
        padding: 0;
        font-size: 0.8125rem;
      }
      .md blockquote {
        margin: 0.5em 0;
        padding: 0.5em var(--bl-spacing, 16px);
        border-left: 3px solid var(--bl-primary, #3b82f6);
        color: var(--bl-text-secondary, #6b7280);
        font-style: italic;
      }
      .md hr {
        margin: 1em 0;
        border: none;
        border-top: 1px solid var(--bl-border, #e5e7eb);
      }
      .md a {
        color: var(--bl-primary, #3b82f6);
        text-decoration: none;
      }
      .md a:hover { text-decoration: underline; }
      .md strong { font-weight: 600; }
      .streaming::after {
        content: '▋';
        animation: blink 1s step-end infinite;
      }
      @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
    `,
  ];

  @property() value = '';
  @property({ type: Boolean }) streaming = false;

  render() {
    const parsed = parseMarkdown(this.value);
    return html`<div class="md${this.streaming ? ' streaming' : ''}">${unsafeHTML(parsed)}</div>`;
  }
}
