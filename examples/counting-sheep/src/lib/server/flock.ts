// In-memory flock: resets when the dev server restarts.
export const BREEDS = ['Merino', 'Suffolk', 'Jacob', 'Herdwick', 'Valais Blacknose'] as const;
export type Breed = (typeof BREEDS)[number];

export interface Sheep {
	id: string;
	name: string;
	breed: Breed;
	bornAt: Date;
	woolKg: number;
}

export const flock: Sheep[] = [
	{ id: 'dolly', name: 'Dolly', breed: 'Merino', bornAt: new Date('2023-04-02'), woolKg: 4.2 },
	{ id: 'shaun', name: 'Shaun', breed: 'Suffolk', bornAt: new Date('2022-03-18'), woolKg: 3.1 },
	{ id: 'timmy', name: 'Timmy', breed: 'Valais Blacknose', bornAt: new Date('2025-05-09'), woolKg: 1.4 },
	{ id: 'larry', name: 'Larry', breed: 'Herdwick', bornAt: new Date('2021-02-27'), woolKg: 2.8 }
];
