/**
 * LineObserver
 *
 * A performant scroll interaction observer that triggers handlers
 * when elements cross a configurable "trigger line" in the viewport.
 *
 * Features:
 * - Single shared RAF loop (only runs when instances are active)
 * - Batched DOM read/write operations
 * - Configurable trigger line per instance (px, %, vh, vw)
 * - Configurable scroll direction behavior
 * - Bidirectional scroll support with consistent offset values
 * - Default handler exposes --scroll-offset CSS custom property
 * - Support for custom scroll handlers
 *
 * @example
 * const observer = new LineObserver({ triggerLine: '50vh' });
 *
 * observer.register(element, {
 *   activeClass: 'is-active',
 *   onActivate: (el) => console.log('Activated!'),
 *   onDeactivate: (el) => console.log('Deactivated!'),
 *   onScroll: (offset, el, instance) => {
 *     const progress = offset / instance.elementHeight;
 *     // Do something with progress...
 *   }
 * });
 *
 * @license MIT
 */

class LineObserver {
	/**
	 * Create a new LineObserver instance
	 *
	 * @param {Object}        options                     - Global default options
	 * @param {string|number} [options.triggerLine]       - Position of trigger line (px, %, vh, vw)
	 * @param {string}        [options.activeClass]       - Class added when element is active
	 * @param {string}        [options.activateFrom]      - Which side the element crosses the trigger line from to activate:
	 *                                                    'below' (element rises from below the line, scrolling down),
	 *                                                    'above' (element drops from above the line, scrolling up),
	 *                                                    or 'both' (default)
	 * @param {number}        [options.nearMargin]        - IO band half-width in px (default: 100). Larger values
	 *                                                    detect elements earlier; smaller values are more efficient.
	 * @param {boolean}       [options.cssCustomProperty] - Set --scroll-offset on active elements (default: true)
	 * @param {Function}      [options.onActivate]        - Callback when element becomes active
	 * @param {Function}      [options.onDeactivate]      - Callback when element becomes inactive
	 * @param {Function}      [options.onScroll]          - Callback on each scroll frame while active
	 */
	constructor(options = {}) {
		this.defaults = {
			triggerLine: '50vh',
			activeClass: 'is-active',
			activateFrom: 'both',
			nearMargin: 100,
			cssCustomProperty: true,
			onActivate: null,
			onDeactivate: null,
			onScroll: null,
		};

		this.destroyed = false;

		this.defaults = { ...this.defaults, ...options };

		// Instance tracking
		this.instances = new Map();
		this.activeInstances = new Set();
		this.nearInstances = new Set();

		// RAF state
		this.isRunning = false;
		this.rafId = null;
		this.lastScrollY = window.scrollY;
		this.currentDirection = 'down';

		// Bind methods
		this.tick = this.tick.bind(this);
		this.handleResize = this.handleResize.bind(this);

		// Resize handling (debounced)
		this.resizeTimeout = null;
		window.addEventListener('resize', this.handleResize, { passive: true });

		// Cache viewport dimensions
		this.viewportHeight = window.innerHeight;
		this.viewportWidth = window.innerWidth;
	}

	/**
	 * Parse trigger line value to pixels
	 *
	 * @param {string|number} value - Trigger line value (px, %, vh, vw)
	 * @return {number}              Pixel value
	 */
	parseTriggerLine(value) {
		if (typeof value === 'number') {
			return value;
		}

		const match = String(value).match(/^([\d.]+)(px|%|vh|vw)$/);
		if (!match) {
			console.warn(
				`LineObserver: Invalid trigger line format "${value}", defaulting to 50vh`
			);
			return this.viewportHeight * 0.5;
		}

		const num = parseFloat(match[1]);
		const unit = match[2];

		const unitHandlers = {
			px: num,
			'%': (num / 100) * this.viewportHeight,
			vh: (num / 100) * this.viewportHeight,
			vw: (num / 100) * this.viewportWidth,
		};

		return unitHandlers[unit];
	}

	/**
	 * Determine element state based on position relative to trigger line
	 *
	 * @param {DOMRect} rect          - Element's bounding client rect
	 * @param {number}  triggerLinePx - Trigger line position in pixels
	 * @return {string}                'inactive', 'active', or 'passed'
	 * @private
	 */
	_determineState(rect, triggerLinePx) {
		const topAboveLine = rect.top <= triggerLinePx;
		const bottomAboveLine = rect.bottom <= triggerLinePx;

		if (!topAboveLine) {
			return 'inactive';
		} else if (!bottomAboveLine) {
			return 'active';
		}
		return 'passed';
	}

	/**
	 * Create IntersectionObserver for an instance
	 *
	 * @param {Object} instance - The observer instance containing element and trigger configuration.
	 * @return {IntersectionObserver}          The created IntersectionObserver.
	 * @private
	 */
	createObserver(instance) {
		// Create a wide band around the trigger line as a nearness detector.
		// IO only adds/removes elements from `nearInstances` — the RAF loop
		// handles precise state transitions using fresh getBoundingClientRect.
		//
		// The `nearMargin` option (default: 100px) controls the band width.
		// Larger values detect elements earlier but keep the RAF loop running
		// longer; smaller values are more efficient but may miss fast scrolls.
		// The active-instances pass in tick() acts as a safety net for elements
		// that skip the band entirely during very fast scrolling.
		//
		// Note: if nearMargin exceeds the trigger line's distance from a viewport
		// edge, the rootMargin becomes positive on that side, extending the band
		// beyond the viewport. This is harmless — tick() still does precise checks.
		//
		// Example: 50vh trigger on 1000px viewport, nearMargin = 100
		//   topMargin  = -500 + 100 = -400  (shrink viewport 400px from top)
		//   bottomMargin = -(1000 - 500 - 100) = -400  (shrink 400px from bottom)
		//   rootMargin = "-400px 0px -400px 0px" → 200px visible band centered on trigger
		const margin = instance.options.nearMargin;
		const topMargin = -Math.floor(instance.triggerLinePx) + margin;
		const bottomMargin = -Math.floor(
			this.viewportHeight - instance.triggerLinePx - margin
		);

		const observer = new IntersectionObserver(
			(entries) => this.handleIntersection(entries, instance),
			{
				rootMargin: `${topMargin}px 0px ${bottomMargin}px 0px`,
				threshold: [0],
			}
		);

		observer.observe(instance.element);
		return observer;
	}

	/**
	 * Handle intersection changes — nearness detection only.
	 *
	 * IO fires when an element enters or leaves the wide band around the
	 * trigger line. This method only manages the `nearInstances` set and
	 * starts the RAF loop. Actual state transitions happen in `tick()`.
	 *
	 * @param {IntersectionObserverEntry[]} entries  - Array of intersection observer entries.
	 * @param {Object}                      instance - The observer instance associated with the intersection.
	 * @private
	 */
	handleIntersection(entries, instance) {
		if (this.destroyed || !this.instances.has(instance.element)) {
			return;
		}

		const entry = entries[entries.length - 1];

		if (entry.isIntersecting) {
			this.nearInstances.add(instance);
			this.startLoop();
		} else {
			this.nearInstances.delete(instance);
		}
	}

	/**
	 * Transition instance to new state
	 *
	 * @param {Object} instance - The observer instance to transition.
	 * @param {string} newState - The new state ('inactive', 'active', or 'passed').
	 * @param {number} scrollY  - The current scroll Y position.
	 * @private
	 */
	transitionState(instance, newState, scrollY) {
		if (newState === instance.state) {
			return;
		}

		const oldState = instance.state;
		instance.state = newState;

		const { element, options } = instance;

		if (newState === 'active') {
			// Entering active state
			instance.elementHeight = element.offsetHeight;

			// Calculate activationScrollY so that offset (scrollY - activationScrollY)
			// starts at 0 and grows as the user scrolls through the element.
			//
			// When scrolling down (top crossed the line): activationScrollY = current scrollY.
			// When scrolling up (bottom crossed the line): we subtract elementHeight so the
			// offset reflects distance from the element's top, not its bottom.
			//
			// In checkInitialState, a different formula is used because we know the element's
			// exact position relative to the trigger line: scrollY - (triggerLinePx - rect.top).
			if (this.currentDirection === 'down') {
				instance.activationScrollY = scrollY;
			} else {
				instance.activationScrollY = scrollY - instance.elementHeight;
			}

			element.classList.add(options.activeClass);
			this.activeInstances.add(instance);
			this.startLoop();

			if (options.onActivate) {
				options.onActivate(element, instance);
			}
		} else if (oldState === 'active') {
			// Leaving active state
			element.classList.remove(options.activeClass);
			this.activeInstances.delete(instance);

			// Reset scroll offset
			if (options.cssCustomProperty) {
				element.style.setProperty('--scroll-offset', 0);
			}

			if (options.onDeactivate) {
				options.onDeactivate(element, instance);
			}
		}
	}

	/**
	 * Register an element for observation
	 *
	 * @param {Element} element   - Element to observe
	 * @param {Object}  [options] - Instance-specific options (overrides defaults)
	 * @return {LineObserver}       This instance for chaining
	 */
	register(element, options = {}) {
		if (this.destroyed) {
			console.warn('LineObserver: Cannot register after destroy()');
			return this;
		}

		if (!(element instanceof Element)) {
			console.warn('LineObserver: register() requires an Element');
			return this;
		}

		if (this.instances.has(element)) {
			console.warn('LineObserver: Element already registered');
			return this;
		}

		const mergedOptions = { ...this.defaults, ...options };

		const validActivateFrom = ['both', 'below', 'above'];
		if (!validActivateFrom.includes(mergedOptions.activateFrom)) {
			console.warn(
				`LineObserver: Unsupported activateFrom "${mergedOptions.activateFrom}"`
			);
			mergedOptions.activateFrom = 'both';
		}

		const instance = {
			element,
			options: mergedOptions,
			state: 'inactive',
			activationScrollY: 0,
			elementHeight: 0,
			triggerLinePx: this.parseTriggerLine(mergedOptions.triggerLine),
			observer: null,
		};

		// Create and attach observer
		instance.observer = this.createObserver(instance);
		this.instances.set(element, instance);

		// Check initial state (element might already be in view)
		this.checkInitialState(instance);

		return this;
	}

	/**
	 * Check if element is already in active zone on registration.
	 *
	 * Called once at registration time. If the element already spans the
	 * trigger line, it activates immediately regardless of `activateFrom`
	 * (there is no scroll direction at registration time). Elements fully
	 * above the trigger line are marked as 'passed'.
	 *
	 * @param {Object} instance - The observer instance to check.
	 * @private
	 */
	checkInitialState(instance) {
		const rect = instance.element.getBoundingClientRect();
		const scrollY = window.scrollY;

		const initialState = this._determineState(rect, instance.triggerLinePx);

		if (initialState === 'active') {
			// Override activationScrollY after transitionState sets it, because
			// we know the element's exact position. The generic formula in
			// transitionState assumes the edge just crossed the line; here
			// the element may already be mid-overlap, so we calculate precisely:
			// scrollY - (how far the trigger line is into the element).
			this.transitionState(instance, 'active', scrollY);
			const distanceIntoElement = instance.triggerLinePx - rect.top;
			instance.activationScrollY = scrollY - distanceIntoElement;
		} else if (initialState === 'passed') {
			instance.state = 'passed';
		}
	}

	/**
	 * Unregister an element
	 *
	 * @param {HTMLElement} element - Element to unregister
	 * @return {LineObserver}         This instance for chaining
	 */
	unregister(element) {
		const instance = this.instances.get(element);
		if (!instance) {
			return this;
		}

		// Clean up observer
		if (instance.observer) {
			instance.observer.disconnect();
		}

		// Remove from tracking sets
		this.activeInstances.delete(instance);
		this.nearInstances.delete(instance);

		// Remove class and custom property
		element.classList.remove(instance.options.activeClass);
		if (instance.options.cssCustomProperty) {
			element.style.removeProperty('--scroll-offset');
		}

		this.instances.delete(element);

		return this;
	}

	/**
	 * Check if a state transition should be suppressed by activateFrom filtering.
	 *
	 * Truth table (suppress = true):
	 *
	 *   activateFrom | direction | transition         | suppress?
	 *   -------------|-----------|--------------------|---------
	 *   'both'       | any       | any                | no
	 *   'below'      | 'down'    | inactive → active  | no  (correct direction)
	 *   'below'      | 'up'      | inactive → active  | YES (wrong direction)
	 *   'below'      | 'up'      | active → inactive  | YES (suppress snap-back)
	 *   'below'      | 'down'    | passed → active    | no  (correct direction)
	 *   'below'      | 'up'      | passed → active    | YES (wrong direction)
	 *   'below'      | 'down'    | active → passed    | no  (natural exit)
	 *   'above'      | 'up'      | passed → active    | no  (correct direction)
	 *   'above'      | 'up'      | inactive → active  | no  (correct direction)
	 *   'above'      | 'down'    | inactive → active  | YES (wrong direction)
	 *   'above'      | 'down'    | passed → active    | YES (wrong direction)
	 *   'above'      | 'down'    | active → passed    | YES (suppress snap-back)
	 *   'above'      | 'up'      | active → inactive  | no  (natural exit)
	 *
	 * @param {string} activateFrom     - The instance's activateFrom option ('both', 'below', 'above').
	 * @param {string} currentDirection - Current scroll direction ('up' or 'down').
	 * @param {string} oldState         - The instance's current state.
	 * @param {string} newState         - The proposed new state.
	 * @return {boolean}                 True if the transition should be suppressed.
	 * @private
	 */
	_shouldSuppressTransition(
		activateFrom,
		currentDirection,
		oldState,
		newState
	) {
		if (activateFrom === 'both') {
			return false;
		}

		const wasActive = oldState === 'active';
		const willBeActive = newState === 'active';

		// 'below' = activate when element crosses trigger from below (scrollY increasing, currentDirection 'down')
		// Suppress transitions when scrolling the wrong way (currentDirection 'up')
		if (activateFrom === 'below' && currentDirection === 'up') {
			if (!wasActive && willBeActive) {
				return true;
			}
			if (wasActive && newState === 'inactive') {
				return true;
			}
		}

		// 'above' = activate when element crosses trigger from above (scrollY decreasing, currentDirection 'up')
		// Suppress transitions when scrolling the wrong way (currentDirection 'down')
		if (activateFrom === 'above' && currentDirection === 'down') {
			if (!wasActive && willBeActive) {
				return true;
			}
			if (wasActive && newState === 'passed') {
				return true;
			}
		}

		return false;
	}

	/**
	 * Main RAF loop
	 *
	 * Elements can be deactivated through two paths:
	 *
	 * 1. Near-instances pass (below): handles elements the IO band reports as
	 *    near the trigger line. These get fresh getBoundingClientRect checks
	 *    and precise state transitions every frame.
	 *
	 * 2. Active-instances pass (further below): handles elements that are active
	 *    but have left the IO band (e.g., fast scrolling moved them far from the
	 *    trigger line). These are caught by checking if the element has scrolled
	 *    fully past the trigger line.
	 *
	 * Both paths apply activateFrom filtering via _shouldSuppressTransition().
	 * The `transitioned` Set prevents double-processing when an element appears
	 * in both nearInstances and activeInstances.
	 *
	 * @private
	 */
	tick() {
		if (
			this.destroyed ||
			(this.activeInstances.size === 0 && this.nearInstances.size === 0)
		) {
			this.isRunning = false;
			return;
		}

		const scrollY = window.scrollY;

		// Skip all work if scroll position hasn't changed
		if (scrollY === this.lastScrollY) {
			this.rafId = requestAnimationFrame(this.tick);
			return;
		}

		// Update direction tracking
		this.currentDirection = scrollY > this.lastScrollY ? 'down' : 'up';

		// === STATE TRANSITIONS FOR NEAR ELEMENTS ===
		// IO only tells us an element is near the trigger line. The RAF
		// loop does the precise state determination every frame.
		const transitions = [];

		for (const instance of this.nearInstances) {
			if (!instance.element.isConnected) {
				transitions.push({ instance, newState: 'inactive' });
				continue;
			}

			const rect = instance.element.getBoundingClientRect();
			const newState = this._determineState(rect, instance.triggerLinePx);

			if (newState !== instance.state) {
				if (
					this._shouldSuppressTransition(
						instance.options.activateFrom,
						this.currentDirection,
						instance.state,
						newState
					)
				) {
					continue;
				}

				transitions.push({ instance, newState });
			}
		}

		// Track instances handled here to skip them in the active-instances pass
		const transitioned = new Set();
		for (const { instance, newState } of transitions) {
			this.transitionState(instance, newState, scrollY);
			transitioned.add(instance);
		}

		// === BATCH READ PHASE FOR ACTIVE ELEMENTS ===
		const updates = [];
		const deactivations = [];

		for (const instance of this.activeInstances) {
			// Skip instances already handled in the near-instances pass
			if (transitioned.has(instance)) {
				continue;
			}
			// Auto-deactivate elements that have been removed from the DOM
			if (!instance.element.isConnected) {
				deactivations.push({
					instance,
					newState: 'inactive',
				});
				continue;
			}

			const offset = Math.max(0, scrollY - instance.activationScrollY);
			const rect = instance.element.getBoundingClientRect();

			// Use the same geometric check as the near-instances pass
			const newState = this._determineState(rect, instance.triggerLinePx);

			if (newState !== 'active') {
				if (
					!this._shouldSuppressTransition(
						instance.options.activateFrom,
						this.currentDirection,
						'active',
						newState
					)
				) {
					deactivations.push({
						instance,
						newState,
					});
					continue;
				}
			}

			updates.push({ instance, offset });
		}

		// === BATCH WRITE PHASE ===

		// Process deactivations
		for (const { instance, newState } of deactivations) {
			this.transitionState(instance, newState, scrollY);
		}

		// Process offset updates
		for (const { instance, offset } of updates) {
			// Set CSS custom property
			if (instance.options.cssCustomProperty) {
				instance.element.style.setProperty('--scroll-offset', offset);
			}

			// Call custom scroll handler if provided
			if (instance.options.onScroll) {
				instance.options.onScroll(offset, instance.element, instance);
			}
		}

		// Update tracking
		this.lastScrollY = scrollY;

		// Continue loop
		this.rafId = requestAnimationFrame(this.tick);
	}

	/**
	 * Start the RAF loop
	 *
	 * @private
	 */
	startLoop() {
		if (!this.isRunning) {
			this.isRunning = true;
			this.lastScrollY = window.scrollY;
			this.rafId = requestAnimationFrame(this.tick);
		}
	}

	/**
	 * Handle window resize
	 *
	 * @private
	 */
	handleResize() {
		clearTimeout(this.resizeTimeout);
		this.resizeTimeout = setTimeout(() => {
			if (this.destroyed) {
				return;
			}

			this.viewportHeight = window.innerHeight;
			this.viewportWidth = window.innerWidth;

			// Recalculate trigger line, recreate observers, and re-check states
			for (const instance of this.instances.values()) {
				if (!instance.element.isConnected) {
					continue;
				}
				if (instance.observer) {
					instance.observer.disconnect();
				}
				instance.triggerLinePx = this.parseTriggerLine(
					instance.options.triggerLine
				);
				instance.observer = this.createObserver(instance);

				// Re-evaluate state in case trigger line moved across element
				const rect = instance.element.getBoundingClientRect();
				const newState = this._determineState(
					rect,
					instance.triggerLinePx
				);
				const scrollY = window.scrollY;
				if (newState !== instance.state) {
					this.transitionState(instance, newState, scrollY);

					// Override activationScrollY with precise formula based on
					// actual element position, same as checkInitialState.
					if (newState === 'active') {
						const distanceIntoElement =
							instance.triggerLinePx - rect.top;
						instance.activationScrollY =
							scrollY - distanceIntoElement;
					}
				}
			}
		}, 150);
	}

	/**
	 * Get number of active instances
	 *
	 * @return {number} Count of active instances
	 */
	getActiveCount() {
		return this.activeInstances.size;
	}

	/**
	 * Get total number of registered instances
	 *
	 * @return {number} Count of all registered instances
	 */
	getTotalCount() {
		return this.instances.size;
	}

	/**
	 * Check if RAF loop is running
	 *
	 * @return {boolean} True if loop is active
	 */
	isActive() {
		return this.isRunning;
	}

	/**
	 * Get current scroll direction
	 *
	 * @return {string} 'up' or 'down'
	 */
	getDirection() {
		return this.currentDirection;
	}

	/**
	 * Clean up everything
	 */
	destroy() {
		this.destroyed = true;

		// Stop RAF
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
		}

		// Clear any pending resize timeout
		if (this.resizeTimeout) {
			clearTimeout(this.resizeTimeout);
		}

		// Disconnect all observers
		for (const instance of this.instances.values()) {
			if (instance.observer) {
				instance.observer.disconnect();
			}
			instance.element.classList.remove(instance.options.activeClass);
			if (instance.options.cssCustomProperty) {
				instance.element.style.removeProperty('--scroll-offset');
			}
		}

		this.instances.clear();
		this.activeInstances.clear();
		this.nearInstances.clear();

		window.removeEventListener('resize', this.handleResize);
	}
}

// Export for different module systems
if (typeof window !== 'undefined') {
	window.LineObserver = LineObserver;
}

export { LineObserver };
export default LineObserver;
