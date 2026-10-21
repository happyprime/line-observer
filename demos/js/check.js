/**
 * Helpers for the demo pages that check themselves.
 *
 * A page passes its cases to `demoCheck.setUpChecks()`. Each case is
 * `{ name, run }`, where `run` returns `{ expected, actual }`. With `?check`
 * in the URL the cases run on load. Results go into `#check-results` and into
 * `window.__checkResults` for a headless browser to read.
 */
(() => {
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
	 * Returns an element's `--scroll-offset` as a number, or null if unset.
	 *
	 * @param {Element} element - The observed element.
	 * @return {number|null} The offset.
	 */
	const offsetOf = (element) => {
		const value = element.style.getPropertyValue('--scroll-offset');
		return value === '' ? null : Math.round(Number(value));
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

		window.__checkResults = {
			pass: results.every((result) => result.pass),
			cases: results,
		};

		return window.__checkResults;
	};

	/**
	 * Connects the "Run check" button, and runs the cases on load with `?check`.
	 *
	 * @param {Array} cases - The page's cases.
	 */
	const setUpChecks = (cases) => {
		document
			.getElementById('run-check')
			.addEventListener('click', () => runChecks(cases));

		if (new URLSearchParams(window.location.search).has('check')) {
			window.addEventListener('load', () => runChecks(cases));
		}
	};

	window.demoCheck = {
		waitFrames,
		jump,
		triggerLine,
		rectOf,
		lineInto,
		offsetOf,
		setUpChecks,
	};
})();
