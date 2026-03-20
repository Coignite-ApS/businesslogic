export interface McpSnippetParams {
	toolName: string;
	mcpUrl: string;
	token: string;
}

export interface McpPlatformOutput {
	before: string;
	inner: string;
	after: string;
}

export interface McpPlatform {
	id: string;
	label: string;
	filePath: string;
	generate: (params: McpSnippetParams) => McpPlatformOutput;
}

const fmt = (obj: unknown) => JSON.stringify(obj, null, 2);

function splitAtServer(fullJson: string, depth: number): McpPlatformOutput {
	const lines = fullJson.split('\n');
	return {
		before: lines.slice(0, depth).join('\n'),
		inner: lines.slice(depth, lines.length - depth).join('\n'),
		after: lines.slice(lines.length - depth).join('\n'),
	};
}

export function dedent(text: string): string {
	const lines = text.split('\n');
	const nonEmpty = lines.filter((l) => l.trim());
	if (!nonEmpty.length) return text;
	const min = Math.min(...nonEmpty.map((l) => l.match(/^(\s*)/)![1].length));
	return lines.map((l) => l.slice(min)).join('\n');
}

export const mcpPlatforms: McpPlatform[] = [
	{
		id: 'claude_desktop',
		label: 'Claude Desktop',
		filePath: 'claude_desktop_config.json',
		generate: ({ toolName, mcpUrl, token }) =>
			splitAtServer(fmt({
				mcpServers: {
					[toolName]: { url: mcpUrl, headers: { 'X-Auth-Token': token } },
				},
			}), 2),
	},
	{
		id: 'cursor',
		label: 'Cursor',
		filePath: '.cursor/mcp.json',
		generate: ({ toolName, mcpUrl, token }) =>
			splitAtServer(fmt({
				mcpServers: {
					[toolName]: {
						command: 'npx',
						args: ['-y', 'mcp-remote', mcpUrl, '--header', `X-Auth-Token:${token}`],
					},
				},
			}), 2),
	},
	{
		id: 'vscode',
		label: 'VS Code',
		filePath: '.vscode/settings.json',
		generate: ({ toolName, mcpUrl, token }) =>
			splitAtServer(fmt({
				mcp: {
					servers: {
						[toolName]: {
							type: 'stdio',
							command: 'npx',
							args: ['-y', 'mcp-remote', mcpUrl, '--header', `X-Auth-Token:${token}`],
						},
					},
				},
			}), 3),
	},
	{
		id: 'windsurf',
		label: 'Windsurf',
		filePath: '~/.codeium/windsurf/mcp_config.json',
		generate: ({ toolName, mcpUrl, token }) =>
			splitAtServer(fmt({
				mcpServers: {
					[toolName]: {
						command: 'npx',
						args: ['-y', 'mcp-remote', mcpUrl, '--header', `X-Auth-Token:${token}`],
					},
				},
			}), 2),
	},
];
