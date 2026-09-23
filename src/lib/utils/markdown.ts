import { Marked, type Tokens } from 'marked';

// Markdown from a program's blocks and system events. Programs often pass
// participant-written text through, so this renderer never emits raw HTML:
// HTML in the source is escaped, and only http(s)/mailto links and http(s)
// images survive. Anything else renders as its plain text.

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^https?:/i;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const md = new Marked({ gfm: true, breaks: true });
md.use({
	renderer: {
		html({ text }: Tokens.HTML | Tokens.Tag) {
			return escapeHtml(text);
		},
		link({ href, tokens }: Tokens.Link) {
			const inner = this.parser.parseInline(tokens);
			if (!SAFE_LINK.test(href)) return inner;
			return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
		},
		image({ href, text }: Tokens.Image) {
			if (!SAFE_IMAGE.test(href)) return escapeHtml(text);
			return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" loading="lazy">`;
		}
	}
});

export function renderSafeMarkdown(text: string): string {
	return md.parse(text ?? '', { async: false });
}

export function isSafeImageUrl(url: string | undefined | null): url is string {
	return !!url && SAFE_IMAGE.test(url);
}

export function isSafeLinkUrl(url: string | undefined | null): url is string {
	return !!url && SAFE_LINK.test(url);
}
