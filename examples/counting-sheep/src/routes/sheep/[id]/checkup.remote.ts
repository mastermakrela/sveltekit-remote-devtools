import * as v from 'valibot';
import { form, query } from '$app/server';

interface Checkup {
	at: Date;
	weightKg: number;
	vaccinated: boolean;
	notes: string;
}

// In-memory, like the flock
const checkups = new Map<string, Checkup[]>();

export const getCheckups = query(v.string(), async (sheep) => checkups.get(sheep) ?? []);

export const logCheckup = form(
	v.object({
		sheep: v.string(),
		weightKg: v.pipe(v.number('Weigh the sheep first'), v.minValue(20, 'Under 20 kg is a lamb, not a sheep'), v.maxValue(160)),
		vaccinated: v.optional(v.boolean(), false),
		notes: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(140)), '')
	}),
	async ({ sheep, ...checkup }) => {
		checkups.set(sheep, [{ at: new Date(), ...checkup }, ...(checkups.get(sheep) ?? [])]);
		void getCheckups(sheep).refresh();
		return { logged: true };
	}
);
