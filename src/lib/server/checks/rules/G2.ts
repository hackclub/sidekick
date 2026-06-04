import type { CheckDefinition } from '../types.js';

const TEMPLATE_SIGNATURES = [
	'bootstrapped with [Create React App]',
	'bootstrapped with [`create-next-app`]',
	'bootstrapped with [`create-next-app',
	'powered by [`create-svelte`]',
	'generated with [Angular CLI]',
	'generated using [Angular CLI]',
	'This template provides a minimal setup to get React working in Vite',
	'This template should help get you started developing with Vue',
	'This template should help get you started developing with Svelte',
	'# React + TypeScript + Vite',
	'# React + Vite',
	'# Vue 3 + TypeScript + Vite',
	'Welcome to your new Gatsby site',
	'Bootstrapped with Create React Native App',
	'This README was generated automatically',
	'This project was bootstrapped with Create React App',
	'This is a starter template for',
	'# Getting Started with Create React App',
	'# create-svelte',
	'## Developing\n\nOnce you\'ve created a project and installed dependencies',
	'To learn more about Next.js, take a look at the following resources',
	'## Getting Started\n\nFirst, run the development server',
	'This project uses [`next/font`]',
];

export const G2: CheckDefinition = {
	id: 'G2',
	family: 'github',
	description: 'README valid',
	severity: 'warn',
	async evaluate(ctx) {
		if (!ctx.github) {
			return {
				pass: true,
				summary: 'Skipped: no GitHub data available',
				details: { skipped: true }
			};
		}

		const content = ctx.github.readmeContent;

		if (!content || content.trim().length === 0) {
			return {
				pass: false,
				summary: 'Repository has no README or README is empty'
			};
		}

		const stripped = content.replace(/^#\s+.+\n*/m, '').trim();
		if (stripped.length < 30) {
			return {
				pass: false,
				summary: 'README contains only a title with no meaningful content',
				details: { strippedLength: stripped.length }
			};
		}

		for (const sig of TEMPLATE_SIGNATURES) {
			if (content.includes(sig)) {
				return {
					pass: false,
					summary: `README appears to be an auto-generated template`,
					details: { matchedSignature: sig.slice(0, 60) }
				};
			}
		}

		return {
			pass: true,
			summary: 'README is present and appears to be custom-written',
			details: { length: content.length }
		};
	}
};
