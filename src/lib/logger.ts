type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4
};

let currentLevel: LogLevel = 'trace';

export function setLogLevel(level: LogLevel) {
	currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
	return LEVELS[level] >= LEVELS[currentLevel];
}

export interface ClientLogger {
	trace(msg: string, ...args: unknown[]): void;
	debug(msg: string, ...args: unknown[]): void;
	info(msg: string, ...args: unknown[]): void;
	warn(msg: string, ...args: unknown[]): void;
	error(msg: string, ...args: unknown[]): void;
	time(label: string): { end(...args: unknown[]): number };
}

export function createLogger(module: string): ClientLogger {
	const prefix = `[${module}]`;

	return {
		trace: (msg, ...args) => {
			if (shouldLog('trace')) console.debug(`${prefix} ${msg}`, ...args);
		},
		debug: (msg, ...args) => {
			if (shouldLog('debug')) console.debug(`${prefix} ${msg}`, ...args);
		},
		info: (msg, ...args) => {
			if (shouldLog('info')) console.log(`${prefix} ${msg}`, ...args);
		},
		warn: (msg, ...args) => {
			if (shouldLog('warn')) console.warn(`${prefix} ${msg}`, ...args);
		},
		error: (msg, ...args) => {
			if (shouldLog('error')) console.error(`${prefix} ${msg}`, ...args);
		},
		time: (label) => {
			const start = performance.now();
			return {
				end: (...args) => {
					const ms = Math.round(performance.now() - start);
					if (shouldLog('debug')) console.debug(`${prefix} ${label} (${ms}ms)`, ...args);
					return ms;
				}
			};
		}
	};
}
