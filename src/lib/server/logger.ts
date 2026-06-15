import 'dotenv/config';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'trace';

function shouldLog(level: LogLevel): boolean {
	return LEVELS[level] >= LEVELS[currentLevel];
}

function formatData(data?: Record<string, unknown>): string {
	if (!data || Object.keys(data).length === 0) return '';
	return (
		' ' +
		Object.entries(data)
			.map(([k, v]) => {
				if (v === undefined || v === null) return `${k}=null`;
				if (typeof v === 'string') return `${k}="${v}"`;
				if (typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
				return `${k}=${v}`;
			})
			.join(' ')
	);
}

function formatError(err: unknown): string {
	if (err instanceof Error) {
		return `${err.name}: ${err.message}`;
	}
	return String(err);
}

export interface Logger {
	trace(msg: string, data?: Record<string, unknown>): void;
	debug(msg: string, data?: Record<string, unknown>): void;
	info(msg: string, data?: Record<string, unknown>): void;
	warn(msg: string, data?: Record<string, unknown>): void;
	error(msg: string, err?: unknown, data?: Record<string, unknown>): void;
	time(label: string): { end(data?: Record<string, unknown>): number };
}

export function createLogger(module: string): Logger {
	function log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
		if (!shouldLog(level)) return;
		const ts = new Date().toISOString();
		const line = `${ts} ${level.toUpperCase().padEnd(5)} [${module}] ${msg}${formatData(data)}`;

		switch (level) {
			case 'error':
				console.error(line);
				break;
			case 'warn':
				console.warn(line);
				break;
			default:
				console.log(line);
				break;
		}
	}

	return {
		trace: (msg, data) => log('trace', msg, data),
		debug: (msg, data) => log('debug', msg, data),
		info: (msg, data) => log('info', msg, data),
		warn: (msg, data) => log('warn', msg, data),
		error: (msg, err, data) => {
			const errStr = err !== undefined ? ` — ${formatError(err)}` : '';
			log('error', `${msg}${errStr}`, data);
		},
		time: (label) => {
			const start = performance.now();
			return {
				end: (data) => {
					const ms = Math.round(performance.now() - start);
					log('debug', `${label}`, { ...data, durationMs: ms });
					return ms;
				}
			};
		}
	};
}
