# Changelog

## 0.2.0

- The endpoint list now also opens as a full page at `/__remote-devtools/` on the dev server, with a file tree that finds each remote function by the module that declares it or the files that import it.
- Form playgrounds render real inputs from the form's schema and show the server's validation issues next to each field.
- Each endpoint lists the files that import it.
- The timeline and the Live tab show the values of `query.batch` and `query.live` calls instead of the resolver function and the iterator.
- The panel now needs Svelte 5.25 or later.

## 0.1.0

- First release: a dev-only panel with the Timeline, Live and Endpoints tabs for SvelteKit remote functions.
