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

		// The scroll position trackDirection() last saw.
		this.directionScrollY = window.scrollY;

		// Instances IO has reported since the last pass. IO reports in the
		// frame after the page moves, so after a jump that ends at rest,
		// these elements still need a pass.
		this.reportedInstances = new Set();

		// Bind methods
		this.tick = this.tick.bind(this);
		this.handleResize = this.handleResize.bind(this);
		this.trackDirection = this.trackDirection.bind(this);

		// Resize handling (debounced)
		this.resizeTimeout = null;
		window.addEventListener('resize', this.handleResize, { passive: true });

		// The loop stops when nothing is near the line, but the page can
		// move several times before it starts again. Each move sets the
		// direction, not the net move since the loop stopped.
		window.addEventListener('scroll', this.trackDirection, {
			passive: true,
		});

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
	 * trigger line. This method only manages the `nearInstances` and
	 * `reportedInstances` sets and starts the RAF loop. Actual state
	 * transitions happen in `tick()`.
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
			this.reportedInstances.add(instance);
			this.startLoop();
		} else {
			this.nearInstances.delete(instance);

			// Content above an active element can change height and move
			// it out of the band with the page at rest. An element that is
			// not active has nothing to do when it leaves. The loop runs
			// while any element is active, so it needs no start here.
			if (instance.state === 'active') {
				this.reportedInstances.add(instance);
			}
		}
	}

	/**
	 * Records the element's height and the scroll position at which its top
	 * edge meets the trigger line.
	 *
	 * The offset is `scrollY - activationScrollY`: the distance from the
	 * element's top edge to the trigger line. After a jump, the element can be
	 * far across the line when it activates, so the offset does not start at 0.
	 *
	 * @param {Object}  instance - The observer instance about to activate.
	 * @param {DOMRect} rect     - The element's rect, read at `scrollY`.
	 * @param {number}  scrollY  - The scroll position when `rect` was read.
	 * @private
	 */
	_measure(instance, rect, scrollY) {
		instance.elementHeight = instance.element.offsetHeight;
		instance.activationScrollY =
			scrollY - (instance.triggerLinePx - rect.top);
	}

	/**
	 * Calls a user callback and reports an error it throws.
	 *
	 * An uncaught error would leave `tick()` before it requests the next
	 * frame. `isRunning` stays true, so `startLoop()` never requests one
	 * again. The error would also skip the rest of the pass, the rest of a
	 * resize pass, and the rest of a caller's loop over `register()`.
	 * `reportError()` fires the window `error` event, as an uncaught error
	 * does, so error trackers still see it.
	 *
	 * @param {Function} callback - The user callback.
	 * @param {...*}     args     - Arguments for the callback.
	 * @private
	 */
	_call(callback, ...args) {
		try {
			callback(...args);
		} catch (error) {
			if (typeof window.reportError === 'function') {
				window.reportError(error);
			} else {
				console.error(error);
			}
		}
	}

	/**
	 * Returns whether the instance is still registered.
	 *
	 * A callback can unregister an element, or destroy the observer, while a
	 * pass still holds the instance in its list of writes. `destroy()` clears
	 * `instances`, so this is false for every instance after it.
	 *
	 * @param {Object} instance - The observer instance.
	 * @return {boolean} True if the instance is registered.
	 * @private
	 */
	_isRegistered(instance) {
		return this.instances.get(instance.element) === instance;
	}

	/**
	 * Transition instance to new state
	 *
	 * An instance that moves to 'active' must be measured with `_measure()`
	 * first.
	 *
	 * @param {Object} instance - The observer instance to transition.
	 * @param {string} newState - The new state ('inactive', 'active', or 'passed').
	 * @private
	 */
	transitionState(instance, newState) {
		if (newState === instance.state || !this._isRegistered(instance)) {
			return;
		}

		const oldState = instance.state;
		instance.state = newState;

		const { element, options } = instance;

		if (newState === 'active') {
			element.classList.add(options.activeClass);
			this.activeInstances.add(instance);
			this.startLoop();

			if (options.onActivate) {
				this._call(options.onActivate, element, instance);
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
				this._call(options.onDeactivate, element, instance);
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
			this._measure(instance, rect, scrollY);
			this.transitionState(instance, 'active');
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
		this.reportedInstances.delete(instance);

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
	 * Returns the state an element moves to, or null if it stays where it is.
	 *
	 * Reads the element's rect, and its height if it activates. It writes
	 * nothing to the DOM.
	 *
	 * @param {Object} instance - The observer instance to check.
	 * @param {number} scrollY  - The current scroll Y position.
	 * @return {string|null}      The new state, or null.
	 * @private
	 */
	_readState(instance, scrollY) {
		if (!instance.element.isConnected) {
			return instance.state === 'inactive' ? null : 'inactive';
		}

		const rect = instance.element.getBoundingClientRect();
		const newState = this._determineState(rect, instance.triggerLinePx);

		if (
			newState === instance.state ||
			this._shouldSuppressTransition(
				instance.options.activateFrom,
				this.currentDirection,
				instance.state,
				newState
			)
		) {
			return null;
		}

		if (newState === 'active') {
			this._measure(instance, rect, scrollY);
		}

		return newState;
	}

	/**
	 * Writes the element's offset to `--scroll-offset` and passes it to `onScroll`.
	 *
	 * @param {Object} instance - An active observer instance.
	 * @param {number} scrollY  - The current scroll Y position.
	 * @private
	 */
	_writeOffset(instance, scrollY) {
		if (!this._isRegistered(instance)) {
			return;
		}

		const offset = Math.max(0, scrollY - instance.activationScrollY);

		if (instance.options.cssCustomProperty) {
			instance.element.style.setProperty('--scroll-offset', offset);
		}

		if (instance.options.onScroll) {
			this._call(
				instance.options.onScroll,
				offset,
				instance.element,
				instance
			);
		}
	}

	/**
	 * Main RAF loop
	 *
	 * Each pass reads every rect and height it needs, then writes classes,
	 * styles and callbacks. A read that follows a write in the same frame
	 * makes the browser lay out the page again.
	 *
	 * With the page at rest, only an element IO has reported since the last
	 * pass can have changed state, so a pass at rest reads only those.
	 *
	 * @private
	 */
	tick() {
		if (
			this.destroyed ||
			(this.activeInstances.size === 0 && this.nearInstances.size === 0)
		) {
			this.isRunning = false;
			this.reportedInstances.clear();
			return;
		}

		const scrollY = window.scrollY;
		const moved = scrollY !== this.lastScrollY;

		if (!moved && this.reportedInstances.size === 0) {
			this.rafId = requestAnimationFrame(this.tick);
			return;
		}

		// After an anchor jump, Chromium runs this frame's RAF callbacks
		// before the scroll event, so the direction can be one move behind.
		this.trackDirection();

		// === READ PHASE ===
		const transitions = [];
		const read = (instance) => {
			const newState = this._readState(instance, scrollY);
			if (newState) {
				transitions.push({ instance, newState });
			}
		};

		if (moved) {
			this.nearInstances.forEach(read);

			// A fast scroll can move an active element past the whole IO
			// band between two frames, so active elements are read even
			// when not near.
			for (const instance of this.activeInstances) {
				if (!this.nearInstances.has(instance)) {
					read(instance);
				}
			}
		} else {
			this.reportedInstances.forEach(read);
		}

		this.reportedInstances.clear();

		// === WRITE PHASE ===
		for (const { instance, newState } of transitions) {
			this.transitionState(instance, newState);
		}

		// At rest, an element that was already active keeps the offset it
		// has, so only elements that activated in this pass get one.
		if (moved) {
			for (const instance of this.activeInstances) {
				this._writeOffset(instance, scrollY);
			}
		} else {
			for (const { instance, newState } of transitions) {
				if (newState === 'active') {
					this._writeOffset(instance, scrollY);
				}
			}
		}

		// Update tracking
		this.lastScrollY = scrollY;

		// A callback can call destroy().
		if (!this.destroyed) {
			this.rafId = requestAnimationFrame(this.tick);
		}
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
	 * Records which way the page moved since the last call.
	 *
	 * This is the passive scroll listener, so it only reads and compares.
	 *
	 * @private
	 */
	trackDirection() {
		const scrollY = window.scrollY;

		if (scrollY !== this.directionScrollY) {
			this.currentDirection =
				scrollY > this.directionScrollY ? 'down' : 'up';
			this.directionScrollY = scrollY;
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

			const scrollY = window.scrollY;
			const transitions = [];

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
				if (newState !== instance.state) {
					if (newState === 'active') {
						this._measure(instance, rect, scrollY);
					}
					transitions.push({ instance, newState });
				}
			}

			for (const { instance, newState } of transitions) {
				this.transitionState(instance, newState);
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
		this.isRunning = false;
		this.rafId = null;

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
		this.reportedInstances.clear();

		window.removeEventListener('resize', this.handleResize);
		window.removeEventListener('scroll', this.trackDirection);
	}
}

// Export for different module systems
if (typeof window !== 'undefined') {
	window.LineObserver = LineObserver;
}

export { LineObserver };
export default LineObserver;
