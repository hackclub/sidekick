/**
 * Evaluates a plain arithmetic expression: `+`, `-`, `*`, `/`, parentheses,
 * unary minus, and standard operator precedence. Returns `null` when the input
 * isn't a well-formed expression or doesn't produce a finite number.
 */
export function evaluateArithmetic(input: string): number | null {
	return evaluate(input, false);
}

/**
 * Like {@link evaluateArithmetic}, but for an hours field: numbers may carry an
 * `h`/`m`/`s` unit (converted to hours), and adjacent durations add up, so
 * "50m", "1h 50m", "1h30m" and "2 * 45m" all work. Bare numbers are hours.
 */
export function evaluateHours(input: string): number | null {
	return evaluate(input, true);
}

function evaluate(input: string, units: boolean): number | null {
	const tokens = tokenize(input, units);
	if (!tokens)
		return null;

	let pos = 0;
	const peek = () => tokens[pos];
	const next = () => tokens[pos++];

	function parseExpression(): number | null {
		let left = parseTerm();
		while (left !== null && (peek() === '+' || peek() === '-')) {
			const op = next();
			const right = parseTerm();
			if (right === null)
				return null;
			left = op === '+' ? left + right : left - right;
		}
		return left;
	}

	function parseTerm(): number | null {
		let left = parseFactor();
		while (left !== null && (peek() === '*' || peek() === '/')) {
			const op = next();
			const right = parseFactor();
			if (right === null)
				return null;
			left = op === '*' ? left * right : left / right;
		}
		return left;
	}

	function parseFactor(): number | null {
		const token = next();
		if (token === undefined)
			return null;
		if (token === '-' || token === '+') {
			const value = parseFactor();
			return value === null ? null : token === '-' ? -value : value;
		}
		if (token === '(') {
			const value = parseExpression();
			if (value === null || next() !== ')')
				return null;
			return value;
		}
		if (typeof token === 'number')
			return token;
		return null;
	}

	const result = parseExpression();
	if (result === null || pos !== tokens.length || !Number.isFinite(result))
		return null;
	return result;
}

type Token = number | '+' | '-' | '*' | '/' | '(' | ')';

const UNIT_HOURS: Record<string, number> = { h: 1, m: 1 / 60, s: 1 / 3600 };

function tokenize(input: string, units = false): Token[] | null {
	const tokens: Token[] = [];
	const re = units
		? /\s*(?:(\d+(?:\.\d+)?|\.\d+)\s*([hms])?(?![a-z])|([-+*/()]))/iy
		: /\s*(?:(\d+(?:\.\d+)?|\.\d+)()|([-+*/()]))/y;
	let pos = 0;
	let lastWasDuration = false;
	while (pos < input.length) {
		re.lastIndex = pos;
		const match = re.exec(input);
		if (!match)
			return input.slice(pos).trim() === '' ? tokens : null;
		if (match[1] !== undefined) {
			const unit = match[2]?.toLowerCase();
			// "1h 50m" — consecutive durations are summed.
			if (unit && lastWasDuration)
				tokens.push('+');
			tokens.push(parseFloat(match[1]) * (unit ? UNIT_HOURS[unit] : 1));
			lastWasDuration = !!unit;
		}
		else {
			tokens.push(match[3] as Token);
			lastWasDuration = false;
		}
		pos = re.lastIndex;
	}
	return tokens;
}
