import { env } from '$env/dynamic/private';
import Groq from 'groq-sdk';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '../logger.js';
import { parseRepoUrl } from './github.js';

const log = createLogger('groq-changelog');
const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const CHANGELOG_PROMPT = `You are a concise changelog writer. You have access to tools that let you inspect a cloned Git repository.

Your task: create a 200–400 character changelog of what changed. The user will give you a repository URL and one or two dates.

- For ONE date: all commits before that date are the "previous version"; all commits on or after it are the "new, updated version."
- For TWO dates: the first date is the cutoff between previous and current. Ignore all commits after the second date.

Start your changelog with "This update adds (...)". Be specific about features, not file names. Return ONLY the changelog text — nothing else.

The repository is already cloned in the current working directory. Use the provided tools to inspect it.`;

const OVERVIEW_PROMPT = `You are a concise project analyst. You have access to tools that let you inspect a cloned Git repository.

Your task: produce a 200–500 character overview of what this project is — what it does, what technologies/frameworks it uses, and its current state (functional, WIP, proof-of-concept, etc.). The user will give you the project title, description, and repository URL.

Be specific about features and functionality, not file paths. Mention the primary language and key frameworks/libraries. Return ONLY the overview text — nothing else.

The repository is already cloned in the current working directory. Use the provided tools to inspect it.`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const GIT_TOOLS: Groq.Chat.ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: 'git_log',
			description:
				'List commits in the repository. Returns commit hash, date, and subject line.',
			parameters: {
				type: 'object',
				properties: {
					since: { type: 'string', description: 'Only commits after this date (ISO 8601)' },
					until: { type: 'string', description: 'Only commits before this date (ISO 8601)' },
					max_count: { type: 'number', description: 'Maximum number of commits to return (default 50)' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'git_diff_stat',
			description:
				'Get a summary of changes between two refs. Shows files changed and lines added/removed.',
			parameters: {
				type: 'object',
				properties: {
					from_ref: { type: 'string', description: 'Starting ref (commit hash, branch, tag)' },
					to_ref: { type: 'string', description: 'Ending ref (commit hash, branch, tag)' }
				},
				required: ['from_ref', 'to_ref']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'git_diff',
			description:
				'Get the actual diff (patch) between two refs. Can be filtered to specific files.',
			parameters: {
				type: 'object',
				properties: {
					from_ref: { type: 'string', description: 'Starting ref' },
					to_ref: { type: 'string', description: 'Ending ref' },
					paths: { type: 'array', items: { type: 'string' }, description: 'Optional file paths to limit the diff' },
					max_lines: { type: 'number', description: 'Truncate output to this many lines (default 300)' }
				},
				required: ['from_ref', 'to_ref']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'git_show',
			description: 'Show details of a specific commit: message, author, date, and diff stat.',
			parameters: {
				type: 'object',
				properties: {
					ref: { type: 'string', description: 'Commit hash or ref to inspect' }
				},
				required: ['ref']
			}
		}
	}
];

const FILE_TOOLS: Groq.Chat.ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: 'list_files',
			description: 'List files and directories at a given path in the repository. Returns names with "/" suffix for directories.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative path within the repo (default: root ".")' },
					recursive: { type: 'boolean', description: 'If true, list all files recursively (max 200 entries)' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read the contents of a file in the repository. Returns the first 300 lines.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Relative path to the file within the repo' },
					max_lines: { type: 'number', description: 'Maximum lines to return (default 300)' }
				},
				required: ['path']
			}
		}
	}
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function runGit(repoDir: string, args: string[]): Promise<string> {
	const cmd = `git ${args.join(' ')}`;
	log.trace('runGit executing', { command: cmd });
	try {
		const { stdout } = await exec('git', args, {
			cwd: repoDir,
			maxBuffer: 1024 * 1024,
			timeout: 15000
		});
		log.trace('runGit success', { command: cmd, outputLength: stdout.length });
		return stdout;
	} catch (e: unknown) {
		log.error('runGit failed', e, { command: cmd });
		const msg = e instanceof Error ? e.message : String(e);
		return `Error: ${msg}`;
	}
}

async function executeGitTool(repoDir: string, name: string, args: Record<string, unknown>): Promise<string> {
	switch (name) {
		case 'git_log': {
			const gitArgs = ['log', '--oneline', '--format=%H %ai %s'];
			if (args.since) gitArgs.push(`--since=${args.since}`);
			if (args.until) gitArgs.push(`--until=${args.until}`);
			gitArgs.push(`-n${(args.max_count as number) || 50}`);
			return runGit(repoDir, gitArgs);
		}
		case 'git_diff_stat':
			return runGit(repoDir, ['diff', '--stat', String(args.from_ref), String(args.to_ref)]);
		case 'git_diff': {
			const gitArgs = ['diff', String(args.from_ref), String(args.to_ref)];
			if (Array.isArray(args.paths) && args.paths.length > 0) gitArgs.push('--', ...args.paths.map(String));
			const result = await runGit(repoDir, gitArgs);
			const maxLines = (args.max_lines as number) || 300;
			const lines = result.split('\n');
			if (lines.length > maxLines) return lines.slice(0, maxLines).join('\n') + `\n... (truncated, ${lines.length - maxLines} more lines)`;
			return result;
		}
		case 'git_show':
			return runGit(repoDir, ['show', '--stat', String(args.ref)]);
		default:
			return `Unknown tool: ${name}`;
	}
}

async function executeFileTool(repoDir: string, name: string, args: Record<string, unknown>): Promise<string> {
	switch (name) {
		case 'list_files': {
			const target = join(repoDir, String(args.path || '.'));
			try {
				if (args.recursive) {
					const results: string[] = [];
					async function walk(dir: string) {
						if (results.length >= 200) return;
						const entries = await readdir(dir, { withFileTypes: true });
						for (const entry of entries) {
							if (results.length >= 200) break;
							if (entry.name === '.git') continue;
							const rel = relative(repoDir, join(dir, entry.name));
							if (entry.isDirectory()) {
								results.push(rel + '/');
								await walk(join(dir, entry.name));
							} else {
								results.push(rel);
							}
						}
					}
					await walk(target);
					return results.join('\n') || '(empty)';
				}
				const entries = await readdir(target, { withFileTypes: true });
				return entries
					.filter((e) => e.name !== '.git')
					.map((e) => e.isDirectory() ? e.name + '/' : e.name)
					.join('\n') || '(empty)';
			} catch {
				return 'Error: path not found';
			}
		}
		case 'read_file': {
			const filePath = join(repoDir, String(args.path));
			try {
				const s = await stat(filePath);
				if (s.size > 512 * 1024) return 'Error: file too large (>512KB)';
				const content = await readFile(filePath, 'utf-8');
				const maxLines = (args.max_lines as number) || 300;
				const lines = content.split('\n');
				if (lines.length > maxLines) return lines.slice(0, maxLines).join('\n') + `\n... (truncated, ${lines.length - maxLines} more lines)`;
				return content;
			} catch {
				return 'Error: file not found or unreadable';
			}
		}
		default:
			return `Unknown tool: ${name}`;
	}
}

function describeToolCall(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case 'git_log': {
			const parts = ['Listing commits'];
			if (args.since) parts.push(`since ${String(args.since).slice(0, 10)}`);
			if (args.until) parts.push(`until ${String(args.until).slice(0, 10)}`);
			return parts.join(' ');
		}
		case 'git_diff_stat':
			return `Comparing ${String(args.from_ref).slice(0, 7)}..${String(args.to_ref).slice(0, 7)}`;
		case 'git_diff': {
			const pathStr = Array.isArray(args.paths) && args.paths.length > 0 ? ` in ${args.paths.join(', ')}` : '';
			return `Reading diff ${String(args.from_ref).slice(0, 7)}..${String(args.to_ref).slice(0, 7)}${pathStr}`;
		}
		case 'git_show':
			return `Inspecting commit ${String(args.ref).slice(0, 7)}`;
		case 'list_files':
			return `Listing files${args.path && args.path !== '.' ? ` in ${args.path}` : ''}${args.recursive ? ' (recursive)' : ''}`;
		case 'read_file':
			return `Reading ${String(args.path)}`;
		default:
			return `Running ${name}`;
	}
}

// ---------------------------------------------------------------------------
// Shared streaming infrastructure
// ---------------------------------------------------------------------------

function extractThinkingExcerpt(content: string): string | null {
	const cleaned = content.replace(/<\/?think>/g, '').trim();
	if (cleaned.length < 20) return null;
	const sentences = cleaned.split(/(?<=[.!?])\s+/);
	const last = sentences[sentences.length - 1]?.trim();
	if (!last || last.length < 10) {
		if (sentences.length >= 2) return sentences[sentences.length - 2]?.trim() ?? null;
		return null;
	}
	if (last.length > 120) return last.slice(0, 117) + '...';
	return last;
}

export type ChangelogEvent =
	| { type: 'status'; message: string }
	| { type: 'thinking'; message: string }
	| { type: 'tool'; message: string }
	| { type: 'done'; changelog: string }
	| { type: 'error'; message: string };

// Project code URLs often point at a subpage (/tree/<branch>, /blob/...) that
// git cannot clone. Rebuild the bare repo URL for GitHub links and keep the
// branch as a checkout hint; non-GitHub URLs pass through untouched.
function resolveCloneTarget(repoUrl: string): { cloneUrl: string; branch: string | null } {
	const parsed = parseRepoUrl(repoUrl);
	if (!parsed) return { cloneUrl: repoUrl, branch: null };
	return { cloneUrl: `https://github.com/${parsed.owner}/${parsed.repo}.git`, branch: parsed.branch };
}

async function cloneWithProgress(
	repoUrl: string,
	repoDir: string,
	emit: (event: ChangelogEvent) => void,
	shallow?: boolean
): Promise<boolean> {
	const { cloneUrl, branch } = resolveCloneTarget(repoUrl);
	log.info('cloneWithProgress starting', { repoUrl, cloneUrl, branch, repoDir, shallow });
	const timer = log.time('cloneWithProgress');
	emit({ type: 'status', message: 'Cloning repository...' });

	const runClone = (withBranch: string | null) =>
		new Promise<void>((resolve, reject) => {
			const args = ['clone', '--progress'];
			if (shallow) args.push('--depth=200');
			if (withBranch) args.push('--branch', withBranch);
			args.push(cloneUrl, repoDir);
			const proc = spawn('git', args, { timeout: 120000 });
			let stderr = '';
			proc.stderr?.on('data', (data: Buffer) => {
				const text = data.toString();
				stderr += text;
				const match = text.match(/(?:Counting|Compressing|Receiving|Resolving) [^:]+:\s+(\d+)%/);
				if (match) {
					const phase = text.startsWith('Receiving') ? 'Downloading'
						: text.startsWith('Resolving') ? 'Resolving'
						: text.startsWith('Compressing') ? 'Compressing'
						: 'Counting';
					emit({ type: 'status', message: `Cloning — ${phase} ${match[1]}%` });
				}
			});
			proc.on('close', (code) => {
				if (code === 0) resolve();
				else reject(new Error(stderr.trim() || `git clone exited with code ${code}`));
			});
			proc.on('error', reject);
		});

	try {
		try {
			await runClone(branch);
		} catch (e) {
			// The branch is a best-effort parse of /tree/<x> — for slashed branch
			// names <x> is only the first segment, so retry on the default branch.
			if (!branch) throw e;
			log.warn('cloneWithProgress branch clone failed, retrying default branch', { cloneUrl, branch, error: e });
			await rm(repoDir, { recursive: true, force: true });
			await mkdir(repoDir, { recursive: true });
			await runClone(null);
		}
		timer.end({ repoUrl });
		log.info('cloneWithProgress succeeded', { repoUrl });
		return true;
	} catch (e: unknown) {
		timer.end({ repoUrl, error: true });
		log.error('cloneWithProgress failed', e, { repoUrl, shallow });
		emit({ type: 'error', message: `Clone failed: ${e instanceof Error ? e.message : String(e)}` });
		return false;
	}
}

async function runGroqLoop(
	groq: Groq,
	messages: Groq.Chat.ChatCompletionMessageParam[],
	tools: Groq.Chat.ChatCompletionTool[],
	executeFn: (name: string, args: Record<string, unknown>) => Promise<string>,
	emit: (event: ChangelogEvent) => void
): Promise<string | null> {
	log.debug('runGroqLoop starting', { maxRounds: 10, toolCount: tools.length });
	for (let round = 0; round < 10; round++) {
		log.trace('runGroqLoop round', { round });
		const roundTimer = log.time(`runGroqLoop.round.${round}`);
		const stream = await groq.chat.completions.create({
			model: 'openai/gpt-oss-120b',
			messages,
			tools,
			tool_choice: 'auto',
			max_tokens: 4096,
			stream: true
		});

		let fullContent = '';
		let lastExcerptLen = 0;
		const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta;
			if (!delta) continue;

			if (delta.content) {
				fullContent += delta.content;
				if (fullContent.length - lastExcerptLen > 60) {
					const excerpt = extractThinkingExcerpt(fullContent);
					if (excerpt) {
						emit({ type: 'thinking', message: excerpt });
						lastExcerptLen = fullContent.length;
					}
				}
			}

			if (delta.tool_calls) {
				for (const tc of delta.tool_calls) {
					if (tc.index !== undefined) {
						while (toolCalls.length <= tc.index) toolCalls.push({ id: '', name: '', arguments: '' });
						if (tc.id) toolCalls[tc.index].id = tc.id;
						if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
						if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
					}
				}
			}

		}

		if (toolCalls.length > 0) {
			messages.push({
				role: 'assistant',
				content: fullContent || null,
				tool_calls: toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: tc.arguments }
				}))
			});
		} else {
			messages.push({ role: 'assistant', content: fullContent || null });
		}

		if (toolCalls.length > 0) {
			log.debug('runGroqLoop executing tool calls', { round, toolCallCount: toolCalls.length, tools: toolCalls.map(tc => tc.name) });
			for (const call of toolCalls) {
				let toolArgs: Record<string, unknown> = {};
				try { toolArgs = JSON.parse(call.arguments); } catch { /* empty */ }
				emit({ type: 'tool', message: describeToolCall(call.name, toolArgs) });
				const toolTimer = log.time(`runGroqLoop.tool.${call.name}`);
				const result = await executeFn(call.name, toolArgs);
				toolTimer.end({ resultLength: result.length });
				messages.push({ role: 'tool', tool_call_id: call.id, content: result || '(empty output)' });
			}
			roundTimer.end({ round, toolCalls: toolCalls.length });
			continue;
		}

		const text = fullContent.replace(/<\/?think>/g, '').trim();
		roundTimer.end({ round, hasResult: !!text });
		log.debug('runGroqLoop completed', { round, resultLength: text?.length ?? 0 });
		return text || null;
	}
	log.warn('runGroqLoop exhausted all rounds without result');
	return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateChangelogStream(
	repoUrl: string,
	sinceDate: string,
	untilDate?: string
): Promise<ReadableStream<string>> {
	log.info('generateChangelogStream called', { repoUrl, sinceDate, untilDate });
	const groqKey = env.GROQ_API_KEY;
	if (!groqKey) throw new Error('GROQ_API_KEY not configured');
	const groq = new Groq({ apiKey: groqKey });

	return new ReadableStream<string>({
		async start(controller) {
			const emit = (event: ChangelogEvent) => { controller.enqueue(`data: ${JSON.stringify(event)}\n\n`); };
			const repoDir = await mkdtemp(join(tmpdir(), 'sidekick-changelog-'));
			const streamTimer = log.time('generateChangelogStream');

			try {
				if (!await cloneWithProgress(repoUrl, repoDir, emit, true)) return;

				const userMessage = untilDate
					? `Repository: ${repoUrl}\nPrevious/current cutoff date: ${sinceDate}\nIgnore commits after: ${untilDate}`
					: `Repository: ${repoUrl}\nCutoff date (before = previous, on/after = new): ${sinceDate}`;

				const messages: Groq.Chat.ChatCompletionMessageParam[] = [
					{ role: 'system', content: CHANGELOG_PROMPT },
					{ role: 'user', content: userMessage }
				];

				emit({ type: 'status', message: 'Analyzing changes...' });
				const result = await runGroqLoop(groq, messages, GIT_TOOLS,
					(name, args) => executeGitTool(repoDir, name, args), emit);

				if (result) {
					log.info('generateChangelogStream succeeded', { repoUrl, resultLength: result.length });
					emit({ type: 'done', changelog: result });
				} else {
					log.warn('generateChangelogStream empty response', { repoUrl });
					emit({ type: 'error', message: 'Model returned empty response' });
				}
			} catch (e) {
				log.error('generateChangelogStream failed', e, { repoUrl });
				emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
			} finally {
				streamTimer.end({ repoUrl });
				await rm(repoDir, { recursive: true, force: true }).catch(() => {});
				controller.close();
			}
		}
	});
}

export async function generateOverviewStream(
	repoUrl: string,
	projectTitle: string,
	projectDescription: string
): Promise<ReadableStream<string>> {
	log.info('generateOverviewStream called', { repoUrl, projectTitle });
	const groqKey = env.GROQ_API_KEY;
	if (!groqKey) throw new Error('GROQ_API_KEY not configured');
	const groq = new Groq({ apiKey: groqKey });

	const allTools = [...GIT_TOOLS, ...FILE_TOOLS];

	return new ReadableStream<string>({
		async start(controller) {
			const emit = (event: ChangelogEvent) => { controller.enqueue(`data: ${JSON.stringify(event)}\n\n`); };
			const repoDir = await mkdtemp(join(tmpdir(), 'sidekick-overview-'));
			const streamTimer = log.time('generateOverviewStream');

			try {
				if (!await cloneWithProgress(repoUrl, repoDir, emit)) return;

				const userMessage = `Project title: ${projectTitle}\nAuthor's description: ${projectDescription}\nRepository: ${repoUrl}`;

				const messages: Groq.Chat.ChatCompletionMessageParam[] = [
					{ role: 'system', content: OVERVIEW_PROMPT },
					{ role: 'user', content: userMessage }
				];

				emit({ type: 'status', message: 'Analyzing project...' });
				const executeFn = (name: string, args: Record<string, unknown>) => {
					if (name === 'list_files' || name === 'read_file') return executeFileTool(repoDir, name, args);
					return executeGitTool(repoDir, name, args);
				};

				const result = await runGroqLoop(groq, messages, allTools, executeFn, emit);

				if (result) {
					log.info('generateOverviewStream succeeded', { repoUrl, resultLength: result.length });
					emit({ type: 'done', changelog: result });
				} else {
					log.warn('generateOverviewStream empty response', { repoUrl });
					emit({ type: 'error', message: 'Model returned empty response' });
				}
			} catch (e) {
				log.error('generateOverviewStream failed', e, { repoUrl });
				emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
			} finally {
				streamTimer.end({ repoUrl });
				await rm(repoDir, { recursive: true, force: true }).catch(() => {});
				controller.close();
			}
		}
	});
}
