import type { ParsedContent } from './types.js';

export async function parsePdf(buffer: Buffer): Promise<ParsedContent[]> {
	// Use pdfjs-dist directly to avoid pdf-parse's dynamic require() that breaks rollup
	const pdfjsLib = await import('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
	try { pdfjsLib.disableWorker = true; } catch { /* frozen module */ }
	const doc = await pdfjsLib.getDocument(buffer);
	let fullText = '';
	const pageTexts: string[] = [];

	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		let lastY: number | undefined;
		let pageText = '';
		for (const item of content.items) {
			if (lastY === (item as any).transform[5] || lastY === undefined) {
				pageText += (item as any).str;
			} else {
				pageText += '\n' + (item as any).str;
			}
			lastY = (item as any).transform[5];
		}
		pageTexts.push(pageText);
		fullText += '\n\n' + pageText;
	}
	doc.destroy();

	// Return per-page sections
	if (pageTexts.length > 1) {
		return pageTexts
			.filter((t) => t.trim())
			.map((text, i) => ({
				text: text.trim(),
				metadata: { page_number: i + 1 },
			}));
	}

	return [{ text: fullText.trim(), metadata: { page_number: 1 } }];
}

export async function parseDocx(buffer: Buffer): Promise<ParsedContent[]> {
	const mammoth = await import('mammoth');
	const result = await mammoth.extractRawText({ buffer });
	const text = result.value.trim();

	if (!text) return [];

	// Group paragraphs under headings (like markdown parser)
	// A "heading" is a short line (<200 chars) followed by longer content
	const paragraphs = text.split(/\n{2,}/).filter((s: string) => s.trim());
	const sections: ParsedContent[] = [];
	let currentHeading: string | undefined;
	let currentText = '';

	for (const para of paragraphs) {
		const trimmed = para.trim();
		// Detect heading: short line, no sentence-ending punctuation, not starting with common body patterns
		const isHeading = trimmed.length < 200
			&& !trimmed.match(/[.!?:,]$/)
			&& trimmed.split('\n').length === 1;

		if (isHeading && currentText.trim()) {
			// Flush previous section
			sections.push({
				text: currentText.trim(),
				metadata: { section_heading: currentHeading },
			});
			currentHeading = trimmed;
			currentText = '';
		} else if (isHeading && !currentText.trim()) {
			// Heading with no accumulated text — just update heading
			currentHeading = trimmed;
		} else {
			currentText += (currentText ? '\n\n' : '') + trimmed;
		}
	}

	if (currentText.trim()) {
		sections.push({
			text: currentText.trim(),
			metadata: { section_heading: currentHeading },
		});
	}

	return sections.length > 0 ? sections : [{ text, metadata: {} }];
}

export async function parseXlsx(buffer: Buffer): Promise<ParsedContent[]> {
	const XLSX = await import('xlsx');
	const workbook = XLSX.read(buffer, { type: 'buffer' });
	const results: ParsedContent[] = [];

	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		if (!sheet) continue;

		const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
		if (rows.length === 0) continue;

		// Convert rows to readable text
		const lines = rows
			.map((row: unknown[]) => row.filter((c) => c !== null && c !== undefined && c !== '').join(' | '))
			.filter((line: string) => line.trim());

		if (lines.length > 0) {
			results.push({
				text: `Sheet: ${sheetName}\n${lines.join('\n')}`,
				metadata: { section_heading: sheetName },
			});
		}
	}

	return results;
}

export function parseMarkdown(text: string): ParsedContent[] {
	const sections: ParsedContent[] = [];
	// Split on headings
	const parts = text.split(/^(#{1,6}\s+.+)$/m);

	let currentHeading: string | undefined;
	let currentText = '';

	for (const part of parts) {
		const headingMatch = part.match(/^#{1,6}\s+(.+)$/);
		if (headingMatch) {
			if (currentText.trim()) {
				sections.push({
					text: currentText.trim(),
					metadata: { section_heading: currentHeading },
				});
			}
			currentHeading = headingMatch[1].trim();
			currentText = part + '\n';
		} else {
			currentText += part;
		}
	}

	if (currentText.trim()) {
		sections.push({
			text: currentText.trim(),
			metadata: { section_heading: currentHeading },
		});
	}

	return sections.length > 0 ? sections : [{ text, metadata: {} }];
}

export function parseText(text: string): ParsedContent[] {
	if (!text.trim()) return [];
	return [{ text: text.trim(), metadata: {} }];
}

export async function parseFile(buffer: Buffer, fileType: string, fileName: string): Promise<ParsedContent[]> {
	const type = fileType.toLowerCase();

	if (type === 'application/pdf' || fileName.endsWith('.pdf')) {
		return parsePdf(buffer);
	}
	if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
		return parseDocx(buffer);
	}
	if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
		return parseXlsx(buffer);
	}
	if (type === 'text/markdown' || fileName.endsWith('.md')) {
		return parseMarkdown(buffer.toString('utf-8'));
	}
	if (type.startsWith('text/') || fileName.endsWith('.txt') || fileName.endsWith('.csv')) {
		return parseText(buffer.toString('utf-8'));
	}

	throw new Error(`Unsupported file type: ${fileType || fileName}`);
}

function extractHeading(text: string): string | undefined {
	const firstLine = text.split('\n')[0]?.trim();
	if (firstLine && firstLine.length < 200) return firstLine;
	return undefined;
}
