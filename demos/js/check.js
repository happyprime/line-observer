/**
 * Helpers for the demo pages that check themselves.
 *
 * A page passes its cases to `demoCheck.setUpChecks()`. Each case is
 * `{ name, run }`, where `run` returns `{ expected, actual }`. With `?check`
 * in the URL the cases run on load. Results go into `#check-results` and into
 * `window.__checkResults` for a headless browser to read.
 *
 * Load this file after the page's content and before the library, so it
 * runs before the page registers anything.
 */
(() => {
	const checking = new URLSearchParams(window.location.search).has('check');

	// Anchor links in a case change the hash. The check puts this URL back
	// when it ends, so a reload loads the page as the check did.
	const loadedUrl = window.location.href;

	// A reload puts the page back where the last check left it, and the
	// page would then register every element there. With 'manual', Chromium
	// and Firefox also skip the scroll to the URL's hash on a reload, so
	// this does it. On a first load the browser does it.
	if (checking) {
		window.history.scrollRestoration = 'manual';

		const id = decodeURIComponent(window.location.hash.slice(1));
		const target = id && document.getElementById(id);
		const [navigation] = performance.getEntriesByType('navigation');

		if (!target) {
			window.scrollTo({ top: 0, behavior: 'instant' });
		} else if (navigation && navigation.type !== 'navigate') {
			target.scrollIntoView({ behavior: 'instant' });
		}
	}

	/**
	 * Waits for a number of animation frames.
	 *
	 * Six frames cover the scroll, the IntersectionObserver report that
	 * follows it, and the pass that report asks for.
	 *
	 * @param {number} count - Frames to wait.
	 * @return {Promise} Resolves after the last frame.
	 */
	const waitFrames = (count = 6) =>
		new Promise((resolve) => {
			const step = () => {
				if (count-- > 0) {
					window.requestAnimationFrame(step);
				} else {
					resolve();
				}
			};
			step();
		});

	/**
	 * Scrolls in one move, with no smooth scrolling, then waits.
	 *
	 * @param {number} top - The scroll position to go to.
	 * @return {Promise} Resolves once the page has settled.
	 */
	const jump = (top) => {
		window.scrollTo({ top, behavior: 'instant' });
		return waitFrames();
	};

	/**
	 * Returns the trigger line's distance from the top of the viewport.
	 *
	 * @return {number} The 50vh trigger line in pixels.
	 */
	const triggerLine = () => window.innerHeight * 0.5;

	/**
	 * Returns an element's rect without going through a page's wrapper.
	 *
	 * @param {Element} element - The element to measure.
	 * @return {DOMRect} The element's rect.
	 */
	const rectOf = (element) =>
		Element.prototype.getBoundingClientRect.call(element);

	/**
	 * Returns the scroll position that puts the trigger line `depth` pixels
	 * below an element's top edge.
	 *
	 * @param {Element} element - The element to place on the line.
	 * @param {number}  depth   - Pixels from the top edge to the line.
	 * @return {number} The scroll position.
	 */
	const lineInto = (element, depth) =>
		rectOf(element).top + window.scrollY + depth - triggerLine();

	/**
	 * Returns how far the trigger line is below an element's top edge, measured now.
	 *
	 * At an odd viewport height the line is at a half pixel, and the browser
	 * puts the page on a whole device pixel, so this can differ from the
	 * depth `lineInto()` asked for.
	 *
	 * @param {Element} element - The element.
	 * @return {number} The distance in pixels.
	 */
	const depthOf = (element) => triggerLine() - rectOf(element).top;

	/**
	 * Returns `target` if `value` is a number within `tolerance` of it, or `value` if not.
	 *
	 * A case that expects `target` then passes with a value close enough,
	 * and shows any other value as it is.
	 *
	 * @param {*}      value       - The value to check.
	 * @param {number} target      - The value it should be near.
	 * @param {number} [tolerance] - The largest difference that passes.
	 * @return {*} `target`, or `value`.
	 */
	const within = (value, target, tolerance = 0.5) =>
		typeof value === 'number' && Math.abs(value - target) <= tolerance
			? target
			: value;

	/**
	 * Returns an element's `--scroll-offset` as a number, or null if unset.
	 *
	 * @param {Element} element - The observed element.
	 * @return {number|null} The offset.
	 */
	const offsetOf = (element) => {
		const value = element.style.getPropertyValue('--scroll-offset');
		return value === '' ? null : Number(value);
	};

	/**
	 * Runs each case in turn and writes PASS or FAIL for each.
	 *
	 * @param {Array} cases - The page's cases.
	 * @return {Promise<Object>} The results.
	 */
	const runChecks = async (cases) => {
		const list = document.getElementById('check-results');
		const results = [];

		list.replaceChildren();
		window.__checkResults = undefined;

		for (const { name, run } of cases) {
			const { expected, actual } = await run();
			const pass = JSON.stringify(actual) === JSON.stringify(expected);
			const item = document.createElement('li');

			item.className = pass ? 'pass' : 'fail';
			item.textContent = pass
				? `PASS ${name}`
				: `FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
			list.append(item);
			results.push({ name, pass, expected, actual });
		}

		window.history.replaceState(null, '', loadedUrl);

		window.__checkResults = {
			pass: results.every((result) => result.pass),
			cases: results,
		};

		return window.__checkResults;
	};

	/**
	 * Makes the "Run check" button load the page with `?check`, and runs the cases on load with `?check`.
	 *
	 * The button loads the page again rather than run the cases in place, so
	 * a check never starts on a page scrolled by hand, with elements already
	 * revealed and logs already written.
	 *
	 * @param {Array} cases - The page's cases.
	 */
	const setUpChecks = (cases) => {
		document.getElementById('run-check').addEventListener('click', () => {
			window.location.assign(`${window.location.pathname}?check`);
		});

		if (checking) {
			window.addEventListener('load', () => runChecks(cases));
		}
	};

	window.demoCheck = {
		waitFrames,
		jump,
		triggerLine,
		rectOf,
		lineInto,
		depthOf,
		within,
		offsetOf,
		setUpChecks,
	};
})();
