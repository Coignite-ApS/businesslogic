import JSZip from 'jszip';

/**
 * Create a zip from a file map and trigger browser download.
 * @param files - Record<filePath, content> (supports nested paths like "dir/file.json")
 * @param zipName - Filename for the downloaded zip (without .zip)
 */
export async function downloadZip(files: Record<string, string>, zipName: string): Promise<void> {
	const zip = new JSZip();

	for (const [path, content] of Object.entries(files)) {
		zip.file(path, content);
	}

	const blob = await zip.generateAsync({ type: 'blob' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${zipName}.zip`;
	a.click();
	URL.revokeObjectURL(url);
}
