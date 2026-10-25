<script lang="ts">
	import { page } from '$app/state';
	import { getFlock } from '../../sheep.remote';
	import { getCheckups, logCheckup } from './checkup.remote';

	const id = $derived(page.params.id!);
	const sheep = $derived((await getFlock()).find((s) => s.id === id));
</script>

<main>
	<a href="/">← The flock</a>
	<h1>{sheep?.name ?? 'Unknown sheep'}</h1>

	<form {...logCheckup}>
		<h2>Log a checkup</h2>
		<input {...logCheckup.fields.sheep.as('hidden', id)} />
		<label>
			Weight (kg)
			<input {...logCheckup.fields.weightKg.as('number')} />
		</label>
		<label class="check">
			<input {...logCheckup.fields.vaccinated.as('checkbox')} /> Vaccinated
		</label>
		<label>
			Notes
			<input {...logCheckup.fields.notes.as('text')} />
		</label>
		<button>Log checkup</button>
		{#each logCheckup.fields.allIssues() as issue (issue.message)}
			<p class="issue">{issue.message}</p>
		{/each}
	</form>

	<h2>Checkups</h2>
	<ul>
		{#each await getCheckups(id) as checkup (checkup.at)}
			<li>{checkup.at.toLocaleDateString()}: {checkup.weightKg} kg{checkup.vaccinated ? ', vaccinated' : ''}{checkup.notes ? `, ${checkup.notes}` : ''}</li>
		{:else}
			<li>No checkups yet.</li>
		{/each}
	</ul>
</main>

<style>
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 3rem 1.5rem 6rem;
	}
	a {
		color: #ffd27a;
	}
	h2 {
		font-size: 1rem;
		color: #a9a6c8;
		margin: 2rem 0 0.75rem;
	}
	form {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.75rem;
	}
	form h2 {
		flex-basis: 100%;
		margin-bottom: 0;
	}
	label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.875rem;
		color: #a9a6c8;
	}
	label.check {
		display: flex;
		align-items: center;
	}
	input:not([type='checkbox']) {
		font: inherit;
		color: inherit;
		background: #1b1e36;
		border: 1px solid #3a3f6b;
		border-radius: 10px;
		padding: 0.45rem 0.7rem;
	}
	button {
		font: inherit;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		border: 0;
		background: #ffd27a;
		color: #14172b;
		font-weight: 600;
		cursor: pointer;
	}
	.issue {
		flex-basis: 100%;
		margin: 0;
		color: #ff9a9a;
	}
	ul {
		padding-left: 1.2rem;
		color: #c9c6e0;
	}
</style>
