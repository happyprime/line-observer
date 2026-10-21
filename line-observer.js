/**
 * LineObserver
 *
 * A performant scroll interaction observer that triggers handlers
 * when elements cross a configurable "trigger line" in the viewport.
 *
 * Features:
 * - Single shared RAF loop (stops when the page is still)
 * - Batched DOM read/write operations
 * - Configurable trigger line per instance (px, %, vh, vw)
 * - Configurable scroll direction behavior
 * - Bidirectional scroll support with consistent offset values
 * - Default handler exposes --scroll-offset and --scroll-progress CSS custom properties
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
 *     // instance.progress runs from 0 at the top edge to 1 at the bottom.
 *   }
 * });
 *
 * @license MIT
 */

// Ticks in a row with no move and no IO report before the loop stops. More
// than one, so a scroll that skips a frame does not stop and restart it.
const STILL_FRAMES = 2;

// How far above the viewport the edge observer's root reaches, in px. An
// element higher than this reads as below the line to that observer.
// Chromium clamps a larger margin to 33,554,432px.
const EDGE_REACH = 10000000;

class LineObserver {
	/**
	 * Create a new LineObserver instance
	 *
	 * @param {Object}        options                     - Global default options
	 * @param {string|number} [options.triggerLine]       - Position of trigger line (px, %, vh, vw)
	 * @param {string}        [options.activeClass]       - Class added when element is active
	 * @param {string}        [options.passedClass]       - Class present while element is past the line
	 * @param {boolean}       [options.once]              - Activate the element once, then stop observing it
	 *                                                    (default: false)
	 * @param {string}        [options.activateFrom]      - Which side the element crosses the trigger line from to activate:
	 *                                                    'below' (element rises from below the line, scrolling down),
	 *                                                    'above' (element drops from above the line, scrolling up),
	 *                                                    or 'both' (default)
	 * @param {number}        [options.nearMargin]        - IO band half-width in px (default: 100). Larger values
	 *                                                    detect elements earlier; smaller values are more efficient.
	 * @param {boolean}       [options.cssCustomProperty] - Set --scroll-offset and --scroll-progress (default: true)
	 * @param {Function}      [options.onActivate]        - Callback when element becomes active
	 * @param {Function}      [options.onDeactivate]      - Callback when element becomes inactive
	 * @param {Function}      [options.onScroll]          - Callback when an active element's offset changes, and
	 *                                                    once with the value it holds when it leaves
	 */
	constructor(options = {}) {
		this.defaults = {
			triggerLine: '50vh',
			activeClass: 'is-active',
			passedClass: 'is-passed',
			once: false,
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
		this.stillFrames = 0;

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

		// The loop stops when the page is still or nothing is near the
		// line, and the page can move several times before it starts
		// again. Each move sets the direction, not the net move since the
		// loop stopped.
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
		// that skip the band entirely during very fast scrolling, and the edge
		// observer reports elements that cross the line without entering it.
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
			// it out of the band with the page at rest and the loop
			// stopped. An element that is not active has nothing to do
			// when it leaves.
			if (instance.state === 'active') {
				this.reportedInstances.add(instance);
				this.startLoop();
			}
		}
	}

	/**
	 * Creates an IntersectionObserver that reports each time the element's top edge crosses the trigger line.
	 *
	 * The root reaches from `EDGE_REACH` above the viewport down to the
	 * trigger line, so the element intersects it while its top edge is above
	 * the line. A jump can take an element across the line without it
	 * entering the near band, and a layout change can move one across with
	 * the page at rest. This observer reports both.
	 *
	 * @param {Object} instance - The observer instance.
	 * @return {IntersectionObserver} The created IntersectionObserver.
	 * @private
	 */
	createEdgeObserver(instance) {
		const bottomMargin = -(this.viewportHeight - instance.triggerLinePx);

		const observer = new IntersectionObserver(
			(entries) => this.handleEdgeIntersection(entries, instance),
			{
				rootMargin: `${EDGE_REACH}px 0px ${bottomMargin}px 0px`,
				threshold: [0],
			}
		);

		observer.observe(instance.element);
		return observer;
	}

	/**
	 * Asks for a pass when the element's top edge is on the other side of the line from where its state says.
	 *
	 * Each observer reports every element when it starts, and the state
	 * already agrees for most of them, so those reports ask for nothing.
	 *
	 * @param {IntersectionObserverEntry[]} entries  - Array of intersection observer entries.
	 * @param {Object}                      instance - The observer instance associated with the intersection.
	 * @private
	 */
	handleEdgeIntersection(entries, instance) {
		if (this.destroyed || !this._isRegistered(instance)) {
			return;
		}

		const topAboveLine = entries[entries.length - 1].isIntersecting;

		if (topAboveLine !== (instance.state !== 'inactive')) {
			this.reportedInstances.add(instance);
			this.startLoop();
		}
	}

	/**
	 * Sets the element's height, offset and progress from its rect.
	 *
	 * The offset is the distance from the element's top edge to the trigger
	 * line, from 0 to the element's height. It comes from the rect, not from
	 * `scrollY`, so it stays right when the page scrolls without the element
	 * moving, as with scroll anchoring or a scroll lock, and when the element
	 * moves without the page scrolling. The height comes from the same rect,
	 * so progress reaches 1 when the bottom edge meets the line.
	 *
	 * @param {Object}  instance - The observer instance.
	 * @param {DOMRect} rect     - The element's rect.
	 * @return {boolean} True if the offset or progress changed.
	 * @private
	 */
	_measure(instance, rect) {
		const { offset, progress } = instance;
		const height = rect.bottom - rect.top;

		instance.elementHeight = height;
		instance.offset = Math.min(
			height,
			Math.max(0, instance.triggerLinePx - rect.top)
		);
		instance.progress = height > 0 ? instance.offset / height : 0;

		return instance.offset !== offset || instance.progress !== progress;
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
	 * An instance that leaves 'active' holds the value it left with: its
	 * height and progress 1 past the line, or 0 below it. `onScroll` gets
	 * that value before `onDeactivate` runs. An instance that moves to
	 * 'active' gets its values from `_apply()`, after every transition in
	 * the pass.
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

		if (oldState === 'passed') {
			element.classList.remove(options.passedClass);
		} else if (newState === 'passed') {
			element.classList.add(options.passedClass);
		}

		if (newState === 'active') {
			element.classList.add(options.activeClass);
			this.activeInstances.add(instance);

			if (options.onActivate) {
				this._call(options.onActivate, element, instance);
			}
		} else if (oldState === 'active') {
			// Leaving active state
			element.classList.remove(options.activeClass);
			this.activeInstances.delete(instance);

			const passed = newState === 'passed';
			instance.offset = passed ? instance.elementHeight : 0;
			instance.progress = passed ? 1 : 0;
			this._writeValues(instance);

			// onScroll can unregister the element.
			if (options.onDeactivate && this._isRegistered(instance)) {
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
			offset: 0,
			progress: 0,
			elementHeight: 0,
			triggerLinePx: this.parseTriggerLine(mergedOptions.triggerLine),
			observer: null,
			edgeObserver: null,
		};

		// Create and attach observers
		instance.observer = this.createObserver(instance);
		instance.edgeObserver = this.createEdgeObserver(instance);
		this.instances.set(element, instance);

		// Check initial state (element might already be in view)
		this.checkInitialState(instance);

		return this;
	}

	/**
	 * Check if element is already in active zone on registration.
	 *
	 * Called once at registration time, regardless of `activateFrom`, as
	 * there is no scroll direction at registration time. An element that
	 * spans the trigger line activates and gets its values and `onScroll`.
	 * An element fully above the line, as on a page reloaded partway down,
	 * gets `onActivate`, `onScroll` and `onDeactivate`, and ends 'passed'.
	 * With `once`, it is revealed instead.
	 *
	 * This reads the element and then writes to it. Registering many
	 * elements that are already across the line can make the browser lay out
	 * the page once for each of them.
	 *
	 * @param {Object} instance - The observer instance to check.
	 * @private
	 */
	checkInitialState(instance) {
		const change = this._read(instance, false);

		if (change) {
			this._apply([change]);
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

		this._forget(instance);

		// Remove classes and custom properties
		element.classList.remove(
			instance.options.activeClass,
			instance.options.passedClass
		);
		if (instance.options.cssCustomProperty) {
			element.style.removeProperty('--scroll-offset');
			element.style.removeProperty('--scroll-progress');
		}

		return this;
	}

	/**
	 * Stops observing an element and drops every reference to it, leaving its classes and properties as they are.
	 *
	 * @param {Object} instance - The observer instance.
	 * @private
	 */
	_forget(instance) {
		instance.observer.disconnect();
		instance.edgeObserver.disconnect();

		this.activeInstances.delete(instance);
		this.nearInstances.delete(instance);
		this.reportedInstances.delete(instance);
		this.instances.delete(instance.element);
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
	 * Reads an element and returns the change a pass must apply to it, or null.
	 *
	 * Reads the element's rect, and measures it if it is active or becomes
	 * active. It writes nothing to the DOM.
	 *
	 * An element can go between 'inactive' and 'passed' with no pass in
	 * between: a fast scroll, a jump, a layout change, or registration on a
	 * page already scrolled past it. It then passes through 'active', if a
	 * crossing in that direction may activate it, so it gets `onActivate`,
	 * `onScroll` and `onDeactivate` in the same pass. An element with `once`
	 * stops at 'active'.
	 *
	 * @param {Object}  instance - The observer instance to read.
	 * @param {boolean} filter   - Whether `activateFrom` applies. It does not
	 *                           at registration or after a resize.
	 * @return {Object|null} `{ instance, from, to, through, changed }`, or null.
	 * @private
	 */
	_read(instance, filter) {
		const { element, options } = instance;
		const from = instance.state;
		let to = 'inactive';
		let through = false;
		let changed = false;

		const rect = element.isConnected
			? element.getBoundingClientRect()
			: null;

		// An element with no box, such as one with `display: none`, has a
		// rect of zeros, which reads as past the line. It counts as inactive.
		if (rect && (rect.width !== 0 || rect.height !== 0)) {
			to = this._determineState(rect, instance.triggerLinePx);

			if (to !== from) {
				const skipped = to !== 'active' && from !== 'active';
				const suppressed =
					filter &&
					this._shouldSuppressTransition(
						options.activateFrom,
						this.currentDirection,
						from,
						skipped ? 'active' : to
					);

				if (skipped) {
					through = !suppressed;
				} else if (suppressed) {
					to = from;
				}
			}

			if (through && options.once) {
				to = 'active';
				through = false;
			}

			// An element that leaves 'active' is measured too, so the height
			// it holds past the line is current.
			if (to === 'active' || from === 'active' || through) {
				changed = this._measure(instance, rect);
			}
		}

		if (to === from && !changed) {
			return null;
		}

		return { instance, from, to, through, changed };
	}

	/**
	 * Applies state changes, then writes values for each active element that moved or activated.
	 *
	 * A `once` element that activates gets its values, then LineObserver
	 * forgets it, so it keeps its class and values for good.
	 *
	 * @param {Object[]} changes - Results of `_read()`.
	 * @private
	 */
	_apply(changes) {
		for (const { instance, to, through } of changes) {
			if (through) {
				this.transitionState(instance, 'active');
			}
			this.transitionState(instance, to);
		}

		for (const { instance, from, changed } of changes) {
			if (instance.state === 'active' && (changed || from !== 'active')) {
				this._writeValues(instance);

				if (instance.options.once && this._isRegistered(instance)) {
					this._forget(instance);
				}
			}
		}

		// After the writes, so an element that only passed through 'active',
		// or that `once` released, does not start it.
		this.startLoop();
	}

	/**
	 * Writes the element's offset and progress to its custom properties and `onScroll`.
	 *
	 * @param {Object} instance - The observer instance.
	 * @private
	 */
	_writeValues(instance) {
		if (!this._isRegistered(instance)) {
			return;
		}

		const { element, options, offset, progress } = instance;

		if (options.cssCustomProperty) {
			element.style.setProperty('--scroll-offset', offset);
			element.style.setProperty('--scroll-progress', progress);
		}

		if (options.onScroll) {
			this._call(options.onScroll, offset, element, instance);
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
	 * pass can have changed state, so a pass at rest reads only those. With
	 * no move and no report, the loop stops after `STILL_FRAMES` ticks.
	 *
	 * @private
	 */
	tick() {
		if (this.destroyed || !this._hasWork()) {
			this.isRunning = false;
			return;
		}

		const scrollY = window.scrollY;
		const moved = scrollY !== this.lastScrollY;

		if (!moved && this.reportedInstances.size === 0) {
			// A scroll event, an IO report or an activation starts the
			// loop again.
			if (++this.stillFrames >= STILL_FRAMES) {
				this.isRunning = false;
				return;
			}
			this.rafId = requestAnimationFrame(this.tick);
			return;
		}

		this.stillFrames = 0;

		// After an anchor jump, Chromium runs this frame's RAF callbacks
		// before the scroll event, so the direction can be one move behind.
		this.trackDirection();

		// === READ PHASE ===
		const changes = [];
		const read = (instance) => {
			const change = this._read(instance, true);
			if (change) {
				changes.push(change);
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

			// The edge observer reports elements a jump took across the
			// line far from it, which are neither near nor active.
			for (const instance of this.reportedInstances) {
				if (
					!this.nearInstances.has(instance) &&
					!this.activeInstances.has(instance)
				) {
					read(instance);
				}
			}
		} else {
			this.reportedInstances.forEach(read);
		}

		this.reportedInstances.clear();

		// === WRITE PHASE ===
		this._apply(changes);

		// Update tracking
		this.lastScrollY = scrollY;

		// A callback can call destroy().
		if (!this.destroyed) {
			this.rafId = requestAnimationFrame(this.tick);
		}
	}

	/**
	 * Starts the RAF loop if anything is near, active or reported.
	 *
	 * `lastScrollY` keeps the position of the last pass. The loop can stop
	 * with elements active, and the first tick after a restart must see a
	 * move made while it was stopped.
	 *
	 * @private
	 */
	startLoop() {
		if (this.isRunning || !this._hasWork()) {
			return;
		}

		this.isRunning = true;
		this.stillFrames = 0;
		this.rafId = requestAnimationFrame(this.tick);
	}

	/**
	 * Returns whether any element is near, active or reported.
	 *
	 * @return {boolean} True if the loop has something to read.
	 * @private
	 */
	_hasWork() {
		return (
			this.activeInstances.size > 0 ||
			this.nearInstances.size > 0 ||
			this.reportedInstances.size > 0
		);
	}

	/**
	 * Records which way the page moved since the last call, and starts the loop.
	 *
	 * This is the passive scroll listener, so it only reads, compares and
	 * requests a frame. `tick()` also calls it, while the loop runs, so the
	 * start does nothing there.
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

		this.startLoop();
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

			const changes = [];

			// Recalculate trigger line, recreate observers, and re-check
			// states. The line can move, so an element that stays active
			// gets fresh values too.
			for (const instance of this.instances.values()) {
				if (!instance.element.isConnected) {
					continue;
				}
				instance.observer.disconnect();
				instance.edgeObserver.disconnect();
				instance.triggerLinePx = this.parseTriggerLine(
					instance.options.triggerLine
				);
				instance.observer = this.createObserver(instance);
				instance.edgeObserver = this.createEdgeObserver(instance);

				const change = this._read(instance, false);
				if (change) {
					changes.push(change);
				}
			}

			this._apply(changes);
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
			instance.observer.disconnect();
			instance.edgeObserver.disconnect();
			instance.element.classList.remove(
				instance.options.activeClass,
				instance.options.passedClass
			);
			if (instance.options.cssCustomProperty) {
				instance.element.style.removeProperty('--scroll-offset');
				instance.element.style.removeProperty('--scroll-progress');
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
