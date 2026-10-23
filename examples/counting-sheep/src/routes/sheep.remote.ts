import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, form, prerender, query, requested } from '$app/server';
import { BREEDS, flock } from '#lib/server/flock.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const getBreeds = prerender(async () => BREEDS);

export const getFlock = query(async () => {
	await sleep(120);
	return flock.map(({ id, name, breed, bornAt }) => ({ id, name, breed, bornAt }));
});

// One request for every row's wool, however many rows ask
export const getWool = query.batch(v.string(), async (ids) => {
	await sleep(80);
	const kg = new Map(flock.filter((s) => ids.includes(s.id)).map((s) => [s.id, s.woolKg]));
	return (id) => kg.get(id) ?? 0;
});

export const addSheep = form(
	v.object({
		name: v.pipe(v.string(), v.trim(), v.nonEmpty('Every sheep needs a name'), v.maxLength(24)),
		breed: v.optional(v.picklist(BREEDS), 'Merino')
	}),
	async ({ name, breed }) => {
		const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${flock.length}`;
		flock.push({ id, name, breed, bornAt: new Date(), woolKg: 0.5 });
		// the server decides to refresh the list itself
		void getFlock().refresh();
		return { id };
	}
);

export const renameSheep = command(
	v.object({ id: v.string(), name: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(24)) }),
	async ({ id, name }) => {
		const sheep = flock.find((s) => s.id === id);
		if (!sheep) error(404, 'No such sheep');
		sheep.name = name;
		// accept the client's `.updates(getFlock())`
		await requested(getFlock, 1).refreshAll();
		return sheep;
	}
);

export const shearSheep = command(v.string(), async (id) => {
	const sheep = flock.find((s) => s.id === id);
	if (!sheep) error(404, 'No such sheep');
	const shorn = sheep.woolKg;
	sheep.woolKg = 0;
	// refresh whichever wool rows the client asked for
	await requested(getWool, 10).refreshAll();
	return { id, shornKg: shorn };
});

export const removeSheep = command(v.string(), async (id) => {
	const index = flock.findIndex((s) => s.id === id);
	if (index === -1) error(404, 'No such sheep');
	flock.splice(index, 1);
	void getFlock().refresh();
});

// Counting sheep: one jumps the fence every 1.5 s
export const countJumps = query.live(async function* () {
	let count = 0;
	while (true) {
		const sheep = flock[count % Math.max(flock.length, 1)];
		yield { count, last: sheep?.name ?? null, at: new Date() };
		count += 1;
		await sleep(1500);
	}
});
