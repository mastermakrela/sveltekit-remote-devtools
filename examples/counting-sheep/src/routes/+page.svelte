<script lang="ts">
	import {
		addSheep,
		countJumps,
		getBreeds,
		getFlock,
		getWool,
		removeSheep,
		renameSheep,
		shearSheep
	} from './sheep.remote';

	const jumps = countJumps();
	const born = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' });
</script>

<main>
	<header>
		<h1>Counting sheep</h1>
		<p class="fence" aria-live="polite">
			{#if jumps.current}
				<span class="count">{jumps.current.count}</span>
				{jumps.current.count === 1 ? 'sheep has' : 'sheep have'} jumped the fence.
				{#if jumps.current.last}Last over: {jumps.current.last}.{/if}
			{:else}
				Waiting for the first sheep…
			{/if}
		</p>
	</header>

	<section aria-labelledby="flock">
		<h2 id="flock">The flock</h2>
		<ul>
			{#each await getFlock() as sheep (sheep.id)}
				<li>
					<span class="icon" aria-hidden="true">🐑</span>
					<input
						class="name"
						aria-label="Name of {sheep.name}"
						value={sheep.name}
						onchange={(e) =>
							renameSheep({ id: sheep.id, name: e.currentTarget.value }).updates(getFlock())}
					/>
					<span class="meta">{sheep.breed}, born {born.format(sheep.bornAt)}</span>
					<span class="wool">{(await getWool(sheep.id)).toFixed(1)} kg wool</span>
					<button onclick={() => shearSheep(sheep.id).updates(getWool(sheep.id))}>Shear</button>
					<button class="quiet" onclick={() => removeSheep(sheep.id)}>
						Remove
					</button>
				</li>
			{:else}
				<li class="empty">The meadow is empty. Add a sheep below.</li>
			{/each}
		</ul>
	</section>

	<form {...addSheep}>
		<h2>Add a sheep</h2>
		<label>
			Name
			<input {...addSheep.fields.name.as('text')} placeholder="Dolly" />
		</label>
		<label>
			Breed
			<select {...addSheep.fields.breed.as('select')}>
				{#each await getBreeds() as breed (breed)}
					<option>{breed}</option>
				{/each}
			</select>
		</label>
		<button>Add sheep</button>
		{#each addSheep.fields.allIssues() as issue (issue.message)}
			<p class="issue">{issue.message}</p>
		{/each}
	</form>
</main>

<style>
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 3rem 1.5rem 6rem;
	}
	h1 {
		font-size: 2.5rem;
		margin: 0 0 0.5rem;
		letter-spacing: -0.02em;
	}
	h2 {
		font-size: 1rem;
		color: #a9a6c8;
		font-weight: 600;
		margin: 2.5rem 0 0.75rem;
	}
	.fence {
		margin: 0;
		padding: 1rem 1.25rem;
		border-radius: 14px;
		background: #1f2340;
		color: #c9c6e0;
	}
	.count {
		font-size: 1.5rem;
		font-weight: 700;
		color: #ffd27a;
		font-variant-numeric: tabular-nums;
		margin-right: 0.25rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	li {
		display: grid;
		grid-template-columns: auto 9rem 1fr auto auto auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.9rem;
		border-radius: 12px;
		background: #1b1e36;
	}
	li.empty {
		display: block;
		color: #a9a6c8;
	}
	.icon {
		font-size: 1.4rem;
	}
	.name {
		font: inherit;
		font-weight: 600;
		color: inherit;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 0.2rem 0.4rem;
		min-width: 0;
	}
	.name:hover,
	.name:focus {
		border-color: #3a3f6b;
	}
	.meta,
	.wool {
		color: #a9a6c8;
		font-size: 0.875rem;
	}
	.wool {
		font-variant-numeric: tabular-nums;
	}
	button {
		font: inherit;
		font-size: 0.875rem;
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		border: 0;
		background: #ffd27a;
		color: #14172b;
		font-weight: 600;
		cursor: pointer;
	}
	button.quiet {
		background: transparent;
		color: #a9a6c8;
		box-shadow: inset 0 0 0 1px #3a3f6b;
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid #ffd27a;
		outline-offset: 2px;
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
	form input,
	select {
		font: inherit;
		color: inherit;
		background: #1b1e36;
		border: 1px solid #3a3f6b;
		border-radius: 10px;
		padding: 0.45rem 0.7rem;
	}
	form button {
		padding: 0.55rem 1rem;
	}
	.issue {
		flex-basis: 100%;
		margin: 0;
		color: #ff9b8a;
	}
	@media (max-width: 640px) {
		li {
			grid-template-columns: auto 1fr auto;
		}
		.meta {
			grid-column: 2 / -1;
		}
	}
</style>
