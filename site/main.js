const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

for (const button of document.querySelectorAll('[data-copy]')) {
	button.addEventListener('click', async () => {
		await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
		button.textContent = 'Copied';
		setTimeout(() => (button.textContent = 'Copy'), 1500);
	});
}

// Videos play only while on screen; with reduced motion they wait for the viewer
for (const video of document.querySelectorAll('video')) {
	if (reduce) continue;
	new IntersectionObserver(([entry]) => (entry.isIntersecting ? video.play().catch(() => {}) : video.pause()), {
		threshold: 0.2
	}).observe(video);
}

// The one moment on load: the decoded call resolves out of payload-like noise
if (!reduce) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
	const nodes = [];
	for (const el of document.querySelectorAll('[data-decode]')) {
		el.classList.add('scrambling');
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) nodes.push({ node: walker.currentNode, text: walker.currentNode.data });
	}
	const total = nodes.reduce((n, { text }) => n + text.length, 0);
	const noise = (text, keep) =>
		[...text].map((ch, i) => (i < keep || ch === ' ' ? ch : alphabet[(Math.random() * 64) | 0])).join('');
	const start = performance.now() + 500;
	const duration = 1300;
	const frame = (now) => {
		let revealed = Math.max(0, Math.round(((now - start) / duration) * total));
		for (const item of nodes) {
			item.node.data = noise(item.text, revealed);
			revealed -= item.text.length;
		}
		if (now < start + duration) requestAnimationFrame(frame);
		else {
			for (const item of nodes) item.node.data = item.text;
			for (const el of document.querySelectorAll('[data-decode]')) el.classList.remove('scrambling');
		}
	};
	requestAnimationFrame(frame);
}
