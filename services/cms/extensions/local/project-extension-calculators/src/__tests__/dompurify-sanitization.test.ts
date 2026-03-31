import { describe, it, expect } from 'vitest';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// DOMPurify needs a window object in Node — create one via jsdom
const window = new JSDOM('').window;
const purify = DOMPurify(window as any);

const CODE_ALLOWED_TAGS = ['span', 'b', 'i', 'em', 'strong'];
const CODE_ALLOWED_ATTR = ['class'];

describe('DOMPurify sanitization for v-html content', () => {
	it('strips script tags from highlighted code output', () => {
		const malicious = '<span class="hljs-keyword">const</span><script>alert("xss")</script>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS: CODE_ALLOWED_TAGS, ALLOWED_ATTR: CODE_ALLOWED_ATTR });
		expect(clean).not.toContain('<script>');
		expect(clean).toContain('<span class="hljs-keyword">');
	});

	it('strips onerror attributes from highlighted output', () => {
		const malicious = '<span class="hljs-string" onerror="alert(1)">value</span>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS: CODE_ALLOWED_TAGS, ALLOWED_ATTR: CODE_ALLOWED_ATTR });
		expect(clean).not.toContain('onerror');
		expect(clean).toContain('hljs-string');
	});

	it('strips event handlers from markdown output', () => {
		const MARKDOWN_ALLOWED_TAGS = [
			'p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
			'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
			'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
			'span', 'div', 'hr', 'del', 'sup', 'sub',
		];
		const MARKDOWN_ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'id'];

		const malicious = '<p>Hello</p><img src=x onerror=alert(1)><a href="javascript:alert(1)">click</a>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS, ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR });
		expect(clean).not.toContain('<img');
		expect(clean).not.toContain('onerror');
		expect(clean).toContain('<p>Hello</p>');
		expect(clean).toContain('<a');
	});

	it('preserves hljs class names on spans', () => {
		const safe = '<span class="hljs-keyword">function</span> <span class="hljs-title">foo</span>';
		const clean = purify.sanitize(safe, { ALLOWED_TAGS: CODE_ALLOWED_TAGS, ALLOWED_ATTR: CODE_ALLOWED_ATTR });
		expect(clean).toBe(safe);
	});

	it('handles empty string input', () => {
		expect(purify.sanitize('', { ALLOWED_TAGS: CODE_ALLOWED_TAGS, ALLOWED_ATTR: CODE_ALLOWED_ATTR })).toBe('');
	});
});
