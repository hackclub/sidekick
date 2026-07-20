/**
 * Evaluates a plain arithmetic expression: `+`, `-`, `*`, `/`, parentheses,
 * unary minus, and standard operator precedence. Returns `null` when the input
 * isn't a well-formed expression or doesn't produce a finite number.
 */
export function evaluateArithmetic(input: string): number | null {
	const tokens = tokenize(input);
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

function tokenize(input: string): Token[] | null {
	const tokens: Token[] = [];
	const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([-+*/()]))/y;
	let pos = 0;
	while (pos < input.length) {
		re.lastIndex = pos;
		const match = re.exec(input);
		if (!match)
			return input.slice(pos).trim() === '' ? tokens : null;
		tokens.push(match[1] !== undefined ? parseFloat(match[1]) : (match[2] as Token));
		pos = re.lastIndex;
	}
	return tokens;
}
