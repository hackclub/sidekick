import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { getMembership, trackAccess } from '$lib/server/rbac.js';
import { getEndpointFeatures } from '$lib/server/protocol/capabilities.js';
import { PROTOCOL_FEATURES } from '$lib/server/protocol/types.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ params, parent }) => {
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');

	const program = await db.program.findUnique({
		where: { id: params.programId }
	});

	if (!program || !program.isActive) {
		throw error(404, 'Program not found');
	}

	const membership = user.isSuperAdmin ? null : await getMembership(user.id, program.id);
	if (!user.isSuperAdmin && !membership) {
		throw error(403, 'You do not have access to this program.');
	}

	trackAccess(user.id, program.id);

	// Optional capabilities advertised by this program's endpoint. Used to
	// conditionally surface features (e.g. the Projects tab) that only some
	// endpoints support. A probe failure degrades to "no optional features".
	const features = await getEndpointFeatures(program.masterEndpoint, program.secretKey);

	return {
		program: {
			id: program.id,
			name: program.name,
			iconUrl: program.iconUrl,
			description: program.description
		},
		permissions: {
			canViewReviews: user.isSuperAdmin || !!membership?.canViewReviews,
			canViewFulfillments: user.isSuperAdmin || !!membership?.canViewFulfillments
		},
		features: {
			projects: features.includes(PROTOCOL_FEATURES.PROJECTS)
		}
	};
};
