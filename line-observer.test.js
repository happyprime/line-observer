import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LineObserver } from './line-observer.js';

// Mock IntersectionObserver
class MockIntersectionObserver {
	constructor(callback, options) {
		this.callback = callback;
		this.options = options;
		this.observedElements = [];
		MockIntersectionObserver.instances.push(this);
	}

	observe(element) {
		this.observedElements.push(element);
	}

	disconnect() {
		this.observedElements = [];
	}

	// Helper to trigger intersection
	trigger(entries) {
		this.callback(entries);
	}
}

MockIntersectionObserver.instances = [];

// Set up mocks before tests
beforeEach(() => {
	MockIntersectionObserver.instances = [];
	global.IntersectionObserver = MockIntersectionObserver;

	// Mock window properties
	Object.defineProperty(window, 'innerHeight', {
		writable: true,
		configurable: true,
		value: 1000,
	});

	Object.defineProperty(window, 'innerWidth', {
		writable: true,
		configurable: true,
		value: 1920,
	});

	Object.defineProperty(window, 'scrollY', {
		writable: true,
		configurable: true,
		value: 0,
	});

	// Mock requestAnimationFrame
	vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
		return setTimeout(cb, 16);
	});

	vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
		clearTimeout(id);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('LineObserver', () => {
	describe('constructor', () => {
		it('should create instance with default options', () => {
			const observer = new LineObserver();

			expect(observer.defaults.triggerLine).toBe('50vh');
			expect(observer.defaults.activeClass).toBe('is-active');
			expect(observer.defaults.activateFrom).toBe('both');
			expect(observer.defaults.onActivate).toBeNull();
			expect(observer.defaults.onDeactivate).toBeNull();
			expect(observer.defaults.onScroll).toBeNull();
		});

		it('should merge custom options with defaults', () => {
			const onActivate = vi.fn();
			const observer = new LineObserver({
				triggerLine: '30vh',
				activeClass: 'custom-active',
				onActivate,
			});

			expect(observer.defaults.triggerLine).toBe('30vh');
			expect(observer.defaults.activeClass).toBe('custom-active');
			expect(observer.defaults.onActivate).toBe(onActivate);
			// Default values should remain for unspecified options
			expect(observer.defaults.activateFrom).toBe('both');
		});

		it('should initialize state tracking properties', () => {
			const observer = new LineObserver();

			expect(observer.instances).toBeInstanceOf(Map);
			expect(observer.activeInstances).toBeInstanceOf(Set);
			expect(observer.isRunning).toBe(false);
			expect(observer.rafId).toBeNull();
			expect(observer.currentDirection).toBe('down');
		});

		it('should cache viewport dimensions', () => {
			const observer = new LineObserver();

			expect(observer.viewportHeight).toBe(1000);
			expect(observer.viewportWidth).toBe(1920);
		});
	});

	describe('parseTriggerLine', () => {
		let observer;

		beforeEach(() => {
			observer = new LineObserver();
		});

		it('should return number directly if input is number', () => {
			expect(observer.parseTriggerLine(500)).toBe(500);
			expect(observer.parseTriggerLine(0)).toBe(0);
			expect(observer.parseTriggerLine(123.5)).toBe(123.5);
		});

		it('should parse pixel values', () => {
			expect(observer.parseTriggerLine('100px')).toBe(100);
			expect(observer.parseTriggerLine('0px')).toBe(0);
			expect(observer.parseTriggerLine('250.5px')).toBe(250.5);
		});

		it('should parse vh values', () => {
			// viewportHeight is 1000
			expect(observer.parseTriggerLine('50vh')).toBe(500);
			expect(observer.parseTriggerLine('100vh')).toBe(1000);
			expect(observer.parseTriggerLine('25vh')).toBe(250);
		});

		it('should parse vw values', () => {
			// viewportWidth is 1920
			expect(observer.parseTriggerLine('50vw')).toBe(960);
			expect(observer.parseTriggerLine('100vw')).toBe(1920);
			expect(observer.parseTriggerLine('10vw')).toBe(192);
		});

		it('should parse percentage values', () => {
			// % is treated same as vh (based on viewportHeight)
			expect(observer.parseTriggerLine('50%')).toBe(500);
			expect(observer.parseTriggerLine('100%')).toBe(1000);
		});

		it('should warn and return default for invalid format', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const result = observer.parseTriggerLine('invalid');

			expect(warnSpy).toHaveBeenCalledWith(
				'LineObserver: Invalid trigger line format "invalid", defaulting to 50vh'
			);
			expect(result).toBe(500); // 50vh with viewportHeight 1000

			warnSpy.mockRestore();
		});

		it('should warn for units without numbers', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			observer.parseTriggerLine('px');

			expect(warnSpy).toHaveBeenCalled();

			warnSpy.mockRestore();
		});
	});

	describe('register', () => {
		let observer;
		let element;

		beforeEach(() => {
			observer = new LineObserver();
			element = document.createElement('div');
			element.style.height = '500px';
			document.body.appendChild(element);

			// Mock getBoundingClientRect
			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 600,
				bottom: 1100,
				height: 500,
				width: 100,
				left: 0,
				right: 100,
			});

			// Mock offsetHeight
			Object.defineProperty(element, 'offsetHeight', {
				value: 500,
				configurable: true,
			});
		});

		afterEach(() => {
			document.body.removeChild(element);
			observer.destroy();
		});

		it('should register element and return observer for chaining', () => {
			const result = observer.register(element);

			expect(result).toBe(observer);
			expect(observer.instances.has(element)).toBe(true);
		});

		it('should create instance with merged options', () => {
			const onActivate = vi.fn();
			observer.register(element, {
				triggerLine: '30vh',
				onActivate,
			});

			const instance = observer.instances.get(element);

			expect(instance.options.triggerLine).toBe('30vh');
			expect(instance.options.onActivate).toBe(onActivate);
			expect(instance.options.activeClass).toBe('is-active'); // default
		});

		it('should set initial state to inactive for element below trigger line', () => {
			observer.register(element);

			const instance = observer.instances.get(element);
			expect(instance.state).toBe('inactive');
		});

		it('should create IntersectionObserver for the element', () => {
			observer.register(element);

			expect(MockIntersectionObserver.instances.length).toBe(1);
			expect(MockIntersectionObserver.instances[0].observedElements).toContain(element);
		});

		it('should warn and return early if element is already registered', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			observer.register(element);
			observer.register(element);

			expect(warnSpy).toHaveBeenCalledWith('LineObserver: Element already registered');
			expect(observer.instances.size).toBe(1);

			warnSpy.mockRestore();
		});

		it('should calculate triggerLinePx from trigger line option', () => {
			observer.register(element, { triggerLine: '40vh' });

			const instance = observer.instances.get(element);
			expect(instance.triggerLinePx).toBe(400); // 40% of 1000
		});
	});

	describe('unregister', () => {
		let observer;
		let element;

		beforeEach(() => {
			observer = new LineObserver();
			element = document.createElement('div');
			document.body.appendChild(element);

			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 600,
				bottom: 1100,
				height: 500,
			});

			Object.defineProperty(element, 'offsetHeight', {
				value: 500,
				configurable: true,
			});
		});

		afterEach(() => {
			document.body.removeChild(element);
			observer.destroy();
		});

		it('should remove element from instances', () => {
			observer.register(element);
			expect(observer.instances.has(element)).toBe(true);

			observer.unregister(element);
			expect(observer.instances.has(element)).toBe(false);
		});

		it('should return observer for chaining', () => {
			observer.register(element);
			const result = observer.unregister(element);

			expect(result).toBe(observer);
		});

		it('should return observer even if element was not registered', () => {
			const result = observer.unregister(element);
			expect(result).toBe(observer);
		});

		it('should disconnect the IntersectionObserver', () => {
			observer.register(element);
			const mockObserver = MockIntersectionObserver.instances[0];
			const disconnectSpy = vi.spyOn(mockObserver, 'disconnect');

			observer.unregister(element);

			expect(disconnectSpy).toHaveBeenCalled();
		});

		it('should remove active class from element', () => {
			observer.register(element);
			element.classList.add('is-active');

			observer.unregister(element);

			expect(element.classList.contains('is-active')).toBe(false);
		});

		it('should remove --scroll-offset custom property', () => {
			observer.register(element);
			element.style.setProperty('--scroll-offset', '100');

			observer.unregister(element);

			expect(element.style.getPropertyValue('--scroll-offset')).toBe('');
		});

		it('should clean up active element on unregister', () => {
			observer.register(element);
			const instance = observer.instances.get(element);

			// Activate the element
			observer.transitionState(instance, 'active', 100);
			expect(observer.activeInstances.has(instance)).toBe(true);
			expect(element.classList.contains('is-active')).toBe(true);

			// Also add to nearInstances
			observer.nearInstances.add(instance);

			observer.unregister(element);

			expect(observer.activeInstances.has(instance)).toBe(false);
			expect(observer.nearInstances.has(instance)).toBe(false);
			expect(element.classList.contains('is-active')).toBe(false);
			expect(element.style.getPropertyValue('--scroll-offset')).toBe('');
		});
	});

	describe('getActiveCount', () => {
		it('should return number of active instances', () => {
			const observer = new LineObserver();

			expect(observer.getActiveCount()).toBe(0);

			// Manually add to activeInstances to test
			observer.activeInstances.add({ element: {} });
			expect(observer.getActiveCount()).toBe(1);

			observer.activeInstances.add({ element: {} });
			expect(observer.getActiveCount()).toBe(2);

			observer.destroy();
		});
	});

	describe('getTotalCount', () => {
		it('should return total number of registered instances', () => {
			const observer = new LineObserver();
			const element1 = document.createElement('div');
			const element2 = document.createElement('div');

			[element1, element2].forEach((el) => {
				document.body.appendChild(el);
				el.getBoundingClientRect = vi.fn().mockReturnValue({
					top: 1000,
					bottom: 1500,
				});
			});

			expect(observer.getTotalCount()).toBe(0);

			observer.register(element1);
			expect(observer.getTotalCount()).toBe(1);

			observer.register(element2);
			expect(observer.getTotalCount()).toBe(2);

			observer.unregister(element1);
			expect(observer.getTotalCount()).toBe(1);

			observer.destroy();
			[element1, element2].forEach((el) => document.body.removeChild(el));
		});
	});

	describe('isActive', () => {
		it('should return false when RAF loop is not running', () => {
			const observer = new LineObserver();
			expect(observer.isActive()).toBe(false);
			observer.destroy();
		});

		it('should return true when RAF loop is running', () => {
			const observer = new LineObserver();
			observer.isRunning = true;
			expect(observer.isActive()).toBe(true);
			observer.destroy();
		});
	});

	describe('getDirection', () => {
		it('should return current scroll direction', () => {
			const observer = new LineObserver();

			expect(observer.getDirection()).toBe('down'); // default

			observer.currentDirection = 'up';
			expect(observer.getDirection()).toBe('up');

			observer.destroy();
		});
	});

	describe('destroy', () => {
		let observer;
		let element;

		beforeEach(() => {
			observer = new LineObserver();
			element = document.createElement('div');
			document.body.appendChild(element);

			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 600,
				bottom: 1100,
			});

			Object.defineProperty(element, 'offsetHeight', {
				value: 500,
				configurable: true,
			});
		});

		afterEach(() => {
			document.body.removeChild(element);
		});

		it('should clear all instances', () => {
			observer.register(element);
			expect(observer.instances.size).toBe(1);

			observer.destroy();

			expect(observer.instances.size).toBe(0);
		});

		it('should clear active instances', () => {
			observer.activeInstances.add({ element: {} });
			expect(observer.activeInstances.size).toBe(1);

			observer.destroy();

			expect(observer.activeInstances.size).toBe(0);
		});

		it('should disconnect all IntersectionObservers', () => {
			observer.register(element);
			const mockObserver = MockIntersectionObserver.instances[0];
			const disconnectSpy = vi.spyOn(mockObserver, 'disconnect');

			observer.destroy();

			expect(disconnectSpy).toHaveBeenCalled();
		});

		it('should remove active class from all elements', () => {
			observer.register(element);
			element.classList.add('is-active');

			observer.destroy();

			expect(element.classList.contains('is-active')).toBe(false);
		});

		it('should remove resize event listener', () => {
			const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

			observer.destroy();

			expect(removeEventListenerSpy).toHaveBeenCalledWith(
				'resize',
				observer.handleResize
			);
		});

		it('should cancel animation frame if running', () => {
			observer.rafId = 123;

			observer.destroy();

			expect(window.cancelAnimationFrame).toHaveBeenCalledWith(123);
		});
	});

	describe('checkInitialState', () => {
		let observer;
		let element;

		beforeEach(() => {
			observer = new LineObserver({ triggerLine: '50vh' }); // 500px with 1000px viewport
			element = document.createElement('div');
			document.body.appendChild(element);

			Object.defineProperty(element, 'offsetHeight', {
				value: 300,
				configurable: true,
			});
		});

		afterEach(() => {
			document.body.removeChild(element);
			observer.destroy();
		});

		it('should set state to inactive for element completely below trigger line', () => {
			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 600, // below 500px trigger line
				bottom: 900,
			});

			observer.register(element);
			const instance = observer.instances.get(element);

			expect(instance.state).toBe('inactive');
		});

		it('should set state to active for element spanning trigger line', () => {
			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 400, // above trigger line
				bottom: 700, // below trigger line
			});

			observer.register(element);
			const instance = observer.instances.get(element);

			expect(instance.state).toBe('active');
			expect(element.classList.contains('is-active')).toBe(true);
		});

		it('should set state to passed for element completely above trigger line', () => {
			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 100,
				bottom: 400, // above 500px trigger line
			});

			observer.register(element);
			const instance = observer.instances.get(element);

			expect(instance.state).toBe('passed');
		});

		it('should call onActivate callback when element starts active', () => {
			const onActivate = vi.fn();

			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 400,
				bottom: 700,
			});

			observer.register(element, { onActivate });

			expect(onActivate).toHaveBeenCalledWith(element, expect.any(Object));
		});

		it('should handle elements at scroll position 0', () => {
			// Element spanning trigger line (500px) at scrollY=0
			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 100,
				bottom: 600,
			});

			Object.defineProperty(window, 'scrollY', {
				value: 0,
				configurable: true,
			});

			observer.register(element);
			const instance = observer.instances.get(element);

			// top(100) <= triggerLine(500) and bottom(600) > triggerLine(500) → active
			expect(instance.state).toBe('active');
		});

		it('should mark element as passed when fully above trigger line at scroll 0', () => {
			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: -100,
				bottom: 200,
			});

			Object.defineProperty(window, 'scrollY', {
				value: 0,
				configurable: true,
			});

			observer.register(element);
			const instance = observer.instances.get(element);

			// top(-100) <= triggerLine(500) and bottom(200) <= triggerLine(500) → passed
			expect(instance.state).toBe('passed');
		});
	});

	describe('transitionState', () => {
		let observer;
		let element;

		beforeEach(() => {
			observer = new LineObserver();
			element = document.createElement('div');
			document.body.appendChild(element);

			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 600,
				bottom: 1100,
			});

			Object.defineProperty(element, 'offsetHeight', {
				value: 500,
				configurable: true,
			});
		});

		afterEach(() => {
			document.body.removeChild(element);
			observer.destroy();
		});

		it('should add active class when transitioning to active', () => {
			observer.register(element);
			const instance = observer.instances.get(element);

			observer.transitionState(instance, 'active', 100);

			expect(element.classList.contains('is-active')).toBe(true);
		});

		it('should remove active class when transitioning from active', () => {
			observer.register(element);
			const instance = observer.instances.get(element);

			// First activate
			observer.transitionState(instance, 'active', 100);
			expect(element.classList.contains('is-active')).toBe(true);

			// Then deactivate
			observer.transitionState(instance, 'passed', 200);
			expect(element.classList.contains('is-active')).toBe(false);
		});

		it('should call onActivate when transitioning to active', () => {
			const onActivate = vi.fn();
			observer.register(element, { onActivate });
			const instance = observer.instances.get(element);

			observer.transitionState(instance, 'active', 100);

			expect(onActivate).toHaveBeenCalledWith(element, instance);
		});

		it('should call onDeactivate when transitioning from active', () => {
			const onDeactivate = vi.fn();
			observer.register(element, { onDeactivate });
			const instance = observer.instances.get(element);

			// First activate
			observer.transitionState(instance, 'active', 100);

			// Then deactivate
			observer.transitionState(instance, 'passed', 200);

			expect(onDeactivate).toHaveBeenCalledWith(element, instance);
		});

		it('should reset scroll offset when deactivating', () => {
			observer.register(element);
			const instance = observer.instances.get(element);

			// Activate and set offset
			observer.transitionState(instance, 'active', 100);
			element.style.setProperty('--scroll-offset', '500');

			// Deactivate
			observer.transitionState(instance, 'inactive', 200);

			expect(element.style.getPropertyValue('--scroll-offset')).toBe('0');
		});

		it('should add instance to activeInstances when activating', () => {
			observer.register(element);
			const instance = observer.instances.get(element);

			expect(observer.activeInstances.has(instance)).toBe(false);

			observer.transitionState(instance, 'active', 100);

			expect(observer.activeInstances.has(instance)).toBe(true);
		});

		it('should remove instance from activeInstances when deactivating', () => {
			observer.register(element);
			const instance = observer.instances.get(element);

			// Activate
			observer.transitionState(instance, 'active', 100);
			expect(observer.activeInstances.has(instance)).toBe(true);

			// Deactivate
			observer.transitionState(instance, 'passed', 200);
			expect(observer.activeInstances.has(instance)).toBe(false);
		});
	});

	describe('activateFrom filtering', () => {
		let observer;
		let element;

		beforeEach(() => {
			element = document.createElement('div');
			document.body.appendChild(element);

			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 600,
				bottom: 1100,
			});

			Object.defineProperty(element, 'offsetHeight', {
				value: 500,
				configurable: true,
			});
		});

		afterEach(() => {
			document.body.removeChild(element);
		});

		it('should allow activation in both directions when activateFrom is "both"', () => {
			observer = new LineObserver();
			observer.register(element, { activateFrom: 'both' });

			const instance = observer.instances.get(element);

			observer.currentDirection = 'down';
			observer.transitionState(instance, 'active', 100);
			expect(instance.state).toBe('active');

			observer.destroy();
		});

		it('should store the activateFrom option on the instance', () => {
			observer = new LineObserver();
			observer.register(element, { activateFrom: 'below' });

			const instance = observer.instances.get(element);
			expect(instance.options.activateFrom).toBe('below');

			observer.destroy();
		});
	});

	describe('handleResize', () => {
		let observer;

		beforeEach(() => {
			vi.useFakeTimers();
			observer = new LineObserver();
		});

		afterEach(() => {
			vi.useRealTimers();
			observer.destroy();
		});

		it('should update viewport dimensions after resize', () => {
			Object.defineProperty(window, 'innerHeight', {
				value: 800,
				configurable: true,
			});

			Object.defineProperty(window, 'innerWidth', {
				value: 1440,
				configurable: true,
			});

			observer.handleResize();
			vi.advanceTimersByTime(200); // Debounce delay is 150ms

			expect(observer.viewportHeight).toBe(800);
			expect(observer.viewportWidth).toBe(1440);
		});

		it('should debounce resize handling', () => {
			const originalHeight = observer.viewportHeight;

			Object.defineProperty(window, 'innerHeight', {
				value: 800,
				configurable: true,
			});

			observer.handleResize();
			vi.advanceTimersByTime(100); // Less than debounce delay

			// Should not have updated yet
			expect(observer.viewportHeight).toBe(originalHeight);

			vi.advanceTimersByTime(100); // Now past debounce delay

			expect(observer.viewportHeight).toBe(800);
		});

		it('should recreate observers for registered elements', () => {
			const element = document.createElement('div');
			document.body.appendChild(element);

			element.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 600,
				bottom: 1100,
			});

			observer.register(element);

			const initialObserverCount = MockIntersectionObserver.instances.length;

			observer.handleResize();
			vi.advanceTimersByTime(200);

			// A new observer should have been created
			expect(MockIntersectionObserver.instances.length).toBe(initialObserverCount + 1);

			document.body.removeChild(element);
		});
	});
});

describe('element validation in register()', () => {
	let observer;

	beforeEach(() => {
		observer = new LineObserver();
	});

	afterEach(() => {
		observer.destroy();
	});

	it('should warn and return this when registering null', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = observer.register(null);

		expect(warnSpy).toHaveBeenCalledWith(
			'LineObserver: register() requires an Element'
		);
		expect(result).toBe(observer);
		expect(observer.instances.size).toBe(0);

		warnSpy.mockRestore();
	});

	it('should warn and return this when registering undefined', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = observer.register(undefined);

		expect(warnSpy).toHaveBeenCalledWith(
			'LineObserver: register() requires an Element'
		);
		expect(result).toBe(observer);

		warnSpy.mockRestore();
	});

	it('should warn and return this when registering a non-element', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = observer.register('not an element');

		expect(warnSpy).toHaveBeenCalledWith(
			'LineObserver: register() requires an Element'
		);
		expect(result).toBe(observer);

		warnSpy.mockRestore();
	});
});

describe('destroyed flag', () => {
	it('should prevent tick() from processing after destroy()', () => {
		const observer = new LineObserver();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});

		observer.register(element);

		// Force-activate to get into active state
		const instance = observer.instances.get(element);
		observer.transitionState(instance, 'active', 100);
		expect(observer.activeInstances.size).toBe(1);

		observer.destroy();

		// Simulate tick being called after destroy (e.g., from pending RAF)
		observer.isRunning = true;
		observer.activeInstances.add(instance);
		observer.tick();

		expect(observer.isRunning).toBe(false);

		document.body.removeChild(element);
	});

	it('should prevent handleIntersection() after destroy()', () => {
		const observer = new LineObserver();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 1100,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		observer.destroy();

		// Simulate intersection callback firing after destroy
		const transitionSpy = vi.spyOn(observer, 'transitionState');
		observer.handleIntersection(
			[{ boundingClientRect: { top: 400, bottom: 700 } }],
			instance
		);

		expect(transitionSpy).not.toHaveBeenCalled();

		document.body.removeChild(element);
	});

	it('should prevent resize handler from executing after destroy()', () => {
		vi.useFakeTimers();
		const observer = new LineObserver();

		observer.handleResize();
		observer.destroy();

		Object.defineProperty(window, 'innerHeight', {
			value: 800,
			configurable: true,
		});

		vi.advanceTimersByTime(200);

		// viewportHeight should not have been updated because destroyed was set
		expect(observer.viewportHeight).toBe(1000);

		vi.useRealTimers();
	});

	it('should prevent register() after destroy()', () => {
		const observer = new LineObserver();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		observer.destroy();

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = observer.register(element);

		expect(warnSpy).toHaveBeenCalledWith(
			'LineObserver: Cannot register after destroy()'
		);
		expect(result).toBe(observer);
		expect(observer.instances.size).toBe(0);

		warnSpy.mockRestore();
		document.body.removeChild(element);
	});
});

describe('_determineState', () => {
	let observer;

	beforeEach(() => {
		observer = new LineObserver();
	});

	afterEach(() => {
		observer.destroy();
	});

	it('should return inactive when element is below trigger line', () => {
		const rect = { top: 600, bottom: 900 };
		expect(observer._determineState(rect, 500)).toBe('inactive');
	});

	it('should return active when element spans the trigger line', () => {
		const rect = { top: 400, bottom: 700 };
		expect(observer._determineState(rect, 500)).toBe('active');
	});

	it('should return passed when element is above trigger line', () => {
		const rect = { top: 100, bottom: 400 };
		expect(observer._determineState(rect, 500)).toBe('passed');
	});

	it('should return active when top is exactly at trigger line', () => {
		const rect = { top: 500, bottom: 800 };
		expect(observer._determineState(rect, 500)).toBe('active');
	});

	it('should return passed when bottom is exactly at trigger line', () => {
		const rect = { top: 200, bottom: 500 };
		expect(observer._determineState(rect, 500)).toBe('passed');
	});
});

describe('cssCustomProperty option', () => {
	let observer;
	let element;

	beforeEach(() => {
		element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 1100,
		});

		Object.defineProperty(element, 'offsetHeight', {
			value: 500,
			configurable: true,
		});
	});

	afterEach(() => {
		document.body.removeChild(element);
	});

	it('should not set --scroll-offset when cssCustomProperty is false', () => {
		observer = new LineObserver({ cssCustomProperty: false });

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		// Element is active via checkInitialState. Scroll to trigger tick's write phase.
		observer.lastScrollY = 0;
		Object.defineProperty(window, 'scrollY', {
			value: 50,
			configurable: true,
		});

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 350,
			bottom: 650,
		});

		const setPropertySpy = vi.spyOn(element.style, 'setProperty');
		observer.tick();

		expect(setPropertySpy).not.toHaveBeenCalledWith(
			'--scroll-offset',
			expect.anything()
		);

		observer.destroy();
	});

	it('should not reset --scroll-offset on deactivate when cssCustomProperty is false', () => {
		observer = new LineObserver({ cssCustomProperty: false });
		observer.register(element);
		const instance = observer.instances.get(element);

		// Activate then deactivate
		observer.transitionState(instance, 'active', 100);
		element.style.setProperty('--scroll-offset', '500');
		observer.transitionState(instance, 'inactive', 200);

		// Should still have the value since we didn't reset it
		expect(element.style.getPropertyValue('--scroll-offset')).toBe('500');

		observer.destroy();
	});

	it('should set --scroll-offset by default (cssCustomProperty true)', () => {
		observer = new LineObserver();
		observer.register(element);
		const instance = observer.instances.get(element);

		expect(instance.options.cssCustomProperty).toBe(true);

		observer.destroy();
	});
});

describe('detached element cleanup', () => {
	let observer;
	let element;

	beforeEach(() => {
		observer = new LineObserver();
		element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});
	});

	afterEach(() => {
		observer.destroy();
	});

	it('should auto-deactivate elements removed from DOM during tick', () => {
		observer.register(element);
		const instance = observer.instances.get(element);

		// Activate the element
		observer.transitionState(instance, 'active', 100);
		expect(observer.activeInstances.has(instance)).toBe(true);

		// Remove element from DOM
		document.body.removeChild(element);

		// Simulate a scroll so tick() doesn't skip work
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});

		// Run tick - should auto-deactivate the detached element
		observer.tick();

		expect(instance.state).toBe('inactive');
		expect(observer.activeInstances.has(instance)).toBe(false);
	});
});

describe('activateFrom filtering in tick()', () => {
	let observer;
	let element;

	beforeEach(() => {
		observer = new LineObserver({ triggerLine: '50vh' });
		element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});
	});

	afterEach(() => {
		document.body.removeChild(element);
		observer.destroy();
	});

	it('"below" should activate when element crosses from below (scrollY increasing)', () => {
		observer.register(element, { activateFrom: 'below' });
		const instance = observer.instances.get(element);

		observer.nearInstances.add(instance);

		// Element crosses trigger line from below (scrollY increasing)
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});

		observer.tick();

		expect(instance.state).toBe('active');
	});

	it('"below" should NOT activate when element crosses from above (scrollY decreasing)', () => {
		observer.register(element, { activateFrom: 'below' });
		const instance = observer.instances.get(element);

		observer.nearInstances.add(instance);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		observer.lastScrollY = 200;
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});

		observer.tick();

		expect(instance.state).toBe('inactive');
	});

	it('"above" should activate when element crosses from above (scrollY decreasing)', () => {
		observer.register(element, { activateFrom: 'above' });
		const instance = observer.instances.get(element);

		observer.nearInstances.add(instance);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		observer.lastScrollY = 200;
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});

		observer.tick();

		expect(instance.state).toBe('active');
	});

	it('"above" should NOT activate when element crosses from below (scrollY increasing)', () => {
		observer.register(element, { activateFrom: 'above' });
		const instance = observer.instances.get(element);

		observer.nearInstances.add(instance);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});

		observer.tick();

		expect(instance.state).toBe('inactive');
	});

	it('"above" should suppress deactivation to passed when scrolling wrong direction', () => {
		observer.register(element, { activateFrom: 'above' });
		const instance = observer.instances.get(element);

		// Activate (scrollY decreasing = element crossing from above)
		observer.nearInstances.add(instance);
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		observer.lastScrollY = 200;
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});
		observer.tick();
		expect(instance.state).toBe('active');

		// Scroll wrong direction (scrollY increasing): element passes above trigger
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 100,
			bottom: 400,
		});
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});
		observer.tick();

		// Deactivation to 'passed' suppressed — wrong direction for 'above'
		expect(instance.state).toBe('active');
	});

	it('"below" should suppress deactivation to inactive when scrolling wrong direction', () => {
		observer.register(element, { activateFrom: 'below' });
		const instance = observer.instances.get(element);

		// Activate (scrollY increasing = element crossing from below)
		observer.nearInstances.add(instance);
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});
		observer.tick();
		expect(instance.state).toBe('active');

		// Scroll wrong direction (scrollY decreasing): element drops below trigger
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});
		observer.lastScrollY = 200;
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});
		observer.tick();

		// Deactivation to 'inactive' suppressed — wrong direction for 'below'
		expect(instance.state).toBe('active');
	});

	it('should deactivate via active-instances path with "both"', () => {
		observer.register(element, { activateFrom: 'both' });
		const instance = observer.instances.get(element);

		observer.transitionState(instance, 'active', 100);
		expect(instance.state).toBe('active');

		// Remove from nearInstances — deactivation goes through active-instances path
		observer.nearInstances.delete(instance);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 100,
			bottom: 400,
		});
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 300,
			configurable: true,
		});
		observer.tick();

		expect(instance.state).toBe('passed');
	});

	it('should suppress active-instances deactivation when activateFrom blocks it', () => {
		// activateFrom 'above' + scrollY increasing (currentDirection 'down')
		// → deactivation to 'passed' is suppressed
		observer.register(element, { activateFrom: 'above' });
		const instance = observer.instances.get(element);

		observer.transitionState(instance, 'active', 100);
		observer.nearInstances.delete(instance);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 100,
			bottom: 400,
		});
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 300,
			configurable: true,
		});
		observer.tick();

		expect(instance.state).toBe('active');
	});

	it('should allow active-instances deactivation when activateFrom permits it', () => {
		// activateFrom 'below' + scrollY increasing (currentDirection 'down')
		// → deactivation to 'passed' is allowed
		observer.register(element, { activateFrom: 'below' });
		const instance = observer.instances.get(element);

		observer.transitionState(instance, 'active', 100);
		observer.nearInstances.delete(instance);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 100,
			bottom: 400,
		});
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 300,
			configurable: true,
		});
		observer.tick();

		expect(instance.state).toBe('passed');
	});

	it('should stop RAF loop when all instances leave', () => {
		observer.register(element);
		const instance = observer.instances.get(element);

		// Start the loop with a near instance
		observer.nearInstances.add(instance);
		observer.startLoop();
		expect(observer.isRunning).toBe(true);

		// Remove from both sets
		observer.nearInstances.delete(instance);
		observer.activeInstances.delete(instance);

		// Clear call history from startLoop and earlier operations
		window.requestAnimationFrame.mockClear();

		// Tick should stop the loop and NOT schedule another RAF
		observer.tick();
		expect(observer.isRunning).toBe(false);
		expect(window.requestAnimationFrame).not.toHaveBeenCalled();
	});

	it('should not double-process element in both nearInstances and activeInstances', () => {
		const onScroll = vi.fn();
		observer.register(element, { activateFrom: 'both', onScroll });
		const instance = observer.instances.get(element);

		// Activate element — it will be in both nearInstances and activeInstances
		observer.nearInstances.add(instance);
		observer.transitionState(instance, 'active', 100);
		expect(observer.nearInstances.has(instance)).toBe(true);
		expect(observer.activeInstances.has(instance)).toBe(true);

		// Make element fully above trigger (should transition to 'passed')
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 100,
			bottom: 400,
		});
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 300,
			configurable: true,
		});

		const transitionSpy = vi.spyOn(observer, 'transitionState');
		observer.tick();

		// transitionState called once (from near-instances pass), not twice
		expect(transitionSpy).toHaveBeenCalledTimes(1);
		expect(instance.state).toBe('passed');
	});
});

describe('tick() offset and onScroll', () => {
	let observer;
	let element;

	beforeEach(() => {
		observer = new LineObserver({ triggerLine: '50vh' });
		element = document.createElement('div');
		document.body.appendChild(element);

		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});
	});

	afterEach(() => {
		document.body.removeChild(element);
		observer.destroy();
	});

	it('should call onScroll with correct offset during tick', () => {
		const onScroll = vi.fn();

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.register(element, { onScroll });
		const instance = observer.instances.get(element);

		// Element starts active (checkInitialState activates it).
		// Set activationScrollY explicitly for predictable offset math.
		instance.activationScrollY = 100;

		// Simulate scrolling to position 250
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 250,
			configurable: true,
		});

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 250,
			bottom: 550,
		});

		observer.tick();

		// offset = scrollY(250) - activationScrollY(100) = 150
		expect(onScroll).toHaveBeenCalledWith(150, element, instance);
	});

	it('should set --scroll-offset CSS custom property during tick', () => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		// Element starts active (checkInitialState activates it).
		// Set activationScrollY explicitly for predictable offset math.
		instance.activationScrollY = 100;

		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 250,
			configurable: true,
		});

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 250,
			bottom: 550,
		});

		observer.tick();

		expect(element.style.getPropertyValue('--scroll-offset')).toBe('150');
	});

	it('should skip work when scroll position unchanged', () => {
		const onScroll = vi.fn();

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.register(element, { onScroll });
		const instance = observer.instances.get(element);

		observer.transitionState(instance, 'active', 100);

		// Set scrollY to match lastScrollY
		observer.lastScrollY = 100;
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});

		observer.tick();

		// onScroll should not be called when scroll hasn't changed
		expect(onScroll).not.toHaveBeenCalled();
	});
});

describe('activateFrom validation', () => {
	let observer;
	let element;

	beforeEach(() => {
		observer = new LineObserver();
		element = document.createElement('div');
		document.body.appendChild(element);
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});
	});

	afterEach(() => {
		document.body.removeChild(element);
		observer.destroy();
	});

	it('should warn for unsupported activateFrom values', () => {
		const warnSpy = vi.spyOn(console, 'warn');
		observer.register(element, { activateFrom: 'left' });

		expect(warnSpy).toHaveBeenCalledWith(
			'LineObserver: Unsupported activateFrom "left"'
		);
		warnSpy.mockRestore();
	});

	it('should fall back to "both" for unsupported activateFrom', () => {
		observer.register(element, { activateFrom: 'left' });
		const instance = observer.instances.get(element);

		expect(instance.options.activateFrom).toBe('both');
	});

	it('should accept valid activateFrom values without warning', () => {
		const warnSpy = vi.spyOn(console, 'warn');

		const el1 = document.createElement('div');
		const el2 = document.createElement('div');
		const el3 = document.createElement('div');
		[el1, el2, el3].forEach((el) => {
			document.body.appendChild(el);
			el.getBoundingClientRect = vi.fn().mockReturnValue({
				top: 600,
				bottom: 900,
			});
		});

		observer.register(el1, { activateFrom: 'both' });
		observer.register(el2, { activateFrom: 'below' });
		observer.register(el3, { activateFrom: 'above' });

		expect(warnSpy).not.toHaveBeenCalled();

		[el1, el2, el3].forEach((el) => document.body.removeChild(el));
		warnSpy.mockRestore();
	});
});

describe('resize state re-evaluation', () => {
	let observer;
	let element;

	beforeEach(() => {
		vi.useFakeTimers();
		observer = new LineObserver({ triggerLine: '50vh' });
		element = document.createElement('div');
		document.body.appendChild(element);

		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});
	});

	afterEach(() => {
		document.body.removeChild(element);
		observer.destroy();
		vi.useRealTimers();
	});

	it('should re-evaluate state after resize', () => {
		// Start with element below trigger line
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		observer.register(element);
		const instance = observer.instances.get(element);
		expect(instance.state).toBe('inactive');

		// After resize, element now spans trigger line
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		// Trigger resize handler
		observer.handleResize();
		vi.advanceTimersByTime(200);

		expect(instance.state).toBe('active');
	});
});

describe('Integration scenarios', () => {
	describe('multiple elements', () => {
		let observer;
		let elements;

		beforeEach(() => {
			observer = new LineObserver();
			elements = [];

			for (let i = 0; i < 3; i++) {
				const el = document.createElement('div');
				document.body.appendChild(el);
				el.getBoundingClientRect = vi.fn().mockReturnValue({
					top: 600 + i * 500,
					bottom: 1100 + i * 500,
				});
				Object.defineProperty(el, 'offsetHeight', {
					value: 500,
					configurable: true,
				});
				elements.push(el);
			}
		});

		afterEach(() => {
			elements.forEach((el) => document.body.removeChild(el));
			observer.destroy();
		});

		it('should track multiple registered elements independently', () => {
			elements.forEach((el, i) => {
				observer.register(el, { triggerLine: `${30 + i * 10}vh` });
			});

			expect(observer.getTotalCount()).toBe(3);

			// Each should have its own trigger line
			elements.forEach((el, i) => {
				const instance = observer.instances.get(el);
				const expectedPx = (30 + i * 10) * 10; // vh to px with 1000px viewport
				expect(instance.triggerLinePx).toBe(expectedPx);
			});
		});

		it('should allow different callbacks per element', () => {
			const callbacks = elements.map(() => vi.fn());

			elements.forEach((el, i) => {
				observer.register(el, { onActivate: callbacks[i] });
			});

			// Manually trigger activation for first element
			const instance = observer.instances.get(elements[0]);
			observer.transitionState(instance, 'active', 100);

			expect(callbacks[0]).toHaveBeenCalled();
			expect(callbacks[1]).not.toHaveBeenCalled();
			expect(callbacks[2]).not.toHaveBeenCalled();
		});
	});
});

describe('active-instances deactivation (upward fast scroll)', () => {
	let observer;
	let element;

	beforeEach(() => {
		observer = new LineObserver({ triggerLine: '50vh' });
		element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});
	});

	afterEach(() => {
		document.body.removeChild(element);
		observer.destroy();
	});

	it('should deactivate to inactive when scrolling up past trigger line', () => {
		observer.register(element);
		const instance = observer.instances.get(element);

		// Activate element
		observer.transitionState(instance, 'active', 200);

		// Remove from nearInstances — simulate element leaving IO band
		observer.nearInstances.delete(instance);

		// Scroll up (scrollY decreasing): element top drops below trigger line
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});
		observer.lastScrollY = 200;
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});
		observer.tick();

		expect(instance.state).toBe('inactive');
	});
});

describe('checkInitialState with activateFrom', () => {
	it('should activate regardless of activateFrom when element spans trigger at registration', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});

		// Register with activateFrom: 'below' — should still activate at initial state
		observer.register(element, { activateFrom: 'below' });
		const instance = observer.instances.get(element);

		expect(instance.state).toBe('active');

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should set passed state regardless of activateFrom when element is above trigger', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 100,
			bottom: 400,
		});

		observer.register(element, { activateFrom: 'above' });
		const instance = observer.instances.get(element);

		expect(instance.state).toBe('passed');

		document.body.removeChild(element);
		observer.destroy();
	});
});

describe('resize with activateFrom', () => {
	it('should activate on resize regardless of activateFrom', () => {
		vi.useFakeTimers();
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});
		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});

		observer.register(element, { activateFrom: 'below' });
		const instance = observer.instances.get(element);
		expect(instance.state).toBe('inactive');

		// After resize, element spans trigger line
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.handleResize();
		vi.advanceTimersByTime(200);

		// Should activate despite activateFrom filtering (resize has no scroll direction)
		expect(instance.state).toBe('active');

		document.body.removeChild(element);
		observer.destroy();
		vi.useRealTimers();
	});
});

describe('handleIntersection', () => {
	it('should remove from nearInstances when isIntersecting is false', () => {
		const observer = new LineObserver();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		// Simulate IO adding to nearInstances
		observer.handleIntersection([{ isIntersecting: true }], instance);
		expect(observer.nearInstances.has(instance)).toBe(true);

		// Simulate IO removing from nearInstances
		observer.handleIntersection([{ isIntersecting: false }], instance);
		expect(observer.nearInstances.has(instance)).toBe(false);

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should use only the last entry when multiple entries arrive', () => {
		const observer = new LineObserver();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		// Pass multiple entries — only last should matter
		observer.handleIntersection(
			[{ isIntersecting: true }, { isIntersecting: false }],
			instance
		);

		// Last entry has isIntersecting: false, so should NOT be in nearInstances
		expect(observer.nearInstances.has(instance)).toBe(false);

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should ignore unregistered instances (race condition guard)', () => {
		const observer = new LineObserver();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		// Unregister the element
		observer.unregister(element);

		// Simulate a stale IO callback firing after unregister
		observer.handleIntersection([{ isIntersecting: true }], instance);

		// Should NOT be added back to nearInstances
		expect(observer.nearInstances.has(instance)).toBe(false);

		document.body.removeChild(element);
		observer.destroy();
	});
});

describe('detached element in near-instances pass', () => {
	it('should auto-deactivate detached elements found in nearInstances', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});
		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		// Add to nearInstances and set a non-inactive state
		observer.nearInstances.add(instance);
		instance.state = 'active';
		observer.activeInstances.add(instance);

		// Remove element from DOM
		document.body.removeChild(element);

		// Simulate scroll so tick() doesn't skip
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});
		observer.lastScrollY = 100;

		observer.tick();

		expect(instance.state).toBe('inactive');
		expect(observer.activeInstances.has(instance)).toBe(false);

		// Re-add for cleanup
		document.body.appendChild(element);
		document.body.removeChild(element);
		observer.destroy();
	});
});

describe('transitionState edge cases', () => {
	it('should not call onDeactivate when transitioning between non-active states', () => {
		const observer = new LineObserver();
		const onDeactivate = vi.fn();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});
		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});

		observer.register(element, { onDeactivate });
		const instance = observer.instances.get(element);

		// Transition from inactive to passed (skipping active)
		observer.transitionState(instance, 'passed', 100);

		expect(onDeactivate).not.toHaveBeenCalled();
		expect(instance.state).toBe('passed');

		document.body.removeChild(element);
		observer.destroy();
	});
});

describe('offset clamping', () => {
	it('should clamp offset to 0 when scrollY is less than activationScrollY', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const onScroll = vi.fn();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});

		observer.register(element, { onScroll });
		const instance = observer.instances.get(element);

		// Element starts active (checkInitialState activates it).
		// Set activationScrollY explicitly to test clamping.
		instance.activationScrollY = 200;
		observer.nearInstances.delete(instance);

		// Scroll to position BELOW activationScrollY
		observer.lastScrollY = 200;
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 500,
			bottom: 800,
		});

		observer.tick();

		// offset = Math.max(0, 100 - 200) = 0
		expect(onScroll).toHaveBeenCalledWith(0, element, instance);

		document.body.removeChild(element);
		observer.destroy();
	});
});

describe('resize debounce behavior', () => {
	it('should only apply the final viewport size when multiple resizes fire', () => {
		vi.useFakeTimers();
		const observer = new LineObserver();

		// First resize
		Object.defineProperty(window, 'innerHeight', {
			value: 800,
			configurable: true,
		});
		observer.handleResize();

		// Second resize before debounce fires
		vi.advanceTimersByTime(100);
		Object.defineProperty(window, 'innerHeight', {
			value: 600,
			configurable: true,
		});
		observer.handleResize();

		// Third resize before debounce fires
		vi.advanceTimersByTime(100);
		Object.defineProperty(window, 'innerHeight', {
			value: 1200,
			configurable: true,
		});
		observer.handleResize();

		// Let debounce fire
		vi.advanceTimersByTime(200);

		// Should use the final value (1200), not intermediate ones
		expect(observer.viewportHeight).toBe(1200);

		observer.destroy();
		vi.useRealTimers();
	});
});

describe('activationScrollY precision', () => {
	it('should set precise activationScrollY in checkInitialState', () => {
		const observer = new LineObserver({ triggerLine: '50vh' }); // 500px
		const element = document.createElement('div');
		document.body.appendChild(element);

		// Element at scroll position 300, top=200 means trigger line (500)
		// is 300px into the element: distanceIntoElement = 500 - 200 = 300
		// activationScrollY = 300 - 300 = 0
		Object.defineProperty(window, 'scrollY', {
			value: 300,
			configurable: true,
		});

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 200,
			bottom: 800,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		expect(instance.state).toBe('active');
		expect(instance.activationScrollY).toBe(0); // 300 - (500 - 200)

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should set activationScrollY = scrollY when activating while scrolling down', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		// Start inactive (below trigger)
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		observer.register(element);
		const instance = observer.instances.get(element);
		expect(instance.state).toBe('inactive');

		// Scroll down — element crosses trigger
		observer.currentDirection = 'down';
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});
		observer.transitionState(instance, 'active', 200);

		expect(instance.activationScrollY).toBe(200);

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should set activationScrollY = scrollY - elementHeight when activating while scrolling up', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		// Start as passed (above trigger)
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: -100,
			bottom: -10,
		});
		Object.defineProperty(element, 'offsetHeight', {
			value: 300,
			configurable: true,
		});

		observer.register(element);
		const instance = observer.instances.get(element);
		expect(instance.state).toBe('passed');

		// Scroll up — element drops back to span trigger
		observer.currentDirection = 'up';
		Object.defineProperty(window, 'scrollY', {
			value: 500,
			configurable: true,
		});
		observer.transitionState(instance, 'active', 500);

		// scrollY(500) - elementHeight(300) = 200
		expect(instance.activationScrollY).toBe(200);

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should override activationScrollY with precise formula on resize', () => {
		vi.useFakeTimers();
		const observer = new LineObserver({ triggerLine: '50vh' }); // 500px
		const element = document.createElement('div');
		document.body.appendChild(element);

		// Start inactive
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		observer.register(element);
		const instance = observer.instances.get(element);
		expect(instance.state).toBe('inactive');

		// After resize, element now spans trigger line
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 300,
			bottom: 700,
		});

		observer.handleResize();
		vi.advanceTimersByTime(200);

		expect(instance.state).toBe('active');
		// distanceIntoElement = 500 - 300 = 200
		// activationScrollY = 100 - 200 = -100
		expect(instance.activationScrollY).toBe(-100);

		document.body.removeChild(element);
		observer.destroy();
		vi.useRealTimers();
	});
});

describe('nearMargin IO rootMargin', () => {
	it('should use nearMargin to compute IO rootMargin', () => {
		const observer = new LineObserver({ triggerLine: '50vh' }); // 500px trigger
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 800,
			bottom: 1100,
		});

		observer.register(element, { nearMargin: 200 });
		const instance = observer.instances.get(element);

		// topMargin = -500 + 200 = -300
		// bottomMargin = -(1000 - 500 - 200) = -300
		expect(instance.observer.options.rootMargin).toBe(
			'-300px 0px -300px 0px'
		);

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should use default nearMargin of 100', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 800,
			bottom: 1100,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		// topMargin = -500 + 100 = -400
		// bottomMargin = -(1000 - 500 - 100) = -400
		expect(instance.observer.options.rootMargin).toBe(
			'-400px 0px -400px 0px'
		);

		document.body.removeChild(element);
		observer.destroy();
	});
});

describe('multiple elements in a single tick', () => {
	it('should process multiple nearInstances and apply transitioned dedup', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });

		const el1 = document.createElement('div');
		const el2 = document.createElement('div');
		document.body.appendChild(el1);
		document.body.appendChild(el2);

		// Both start inactive (below trigger)
		el1.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});
		el2.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 700,
			bottom: 1000,
		});

		const onActivate1 = vi.fn();
		const onActivate2 = vi.fn();

		observer.register(el1, { onActivate: onActivate1 });
		observer.register(el2, { onActivate: onActivate2 });

		const inst1 = observer.instances.get(el1);
		const inst2 = observer.instances.get(el2);

		// Add both to nearInstances
		observer.nearInstances.add(inst1);
		observer.nearInstances.add(inst2);

		// Scroll down — both now span trigger
		observer.lastScrollY = 0;
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});

		el1.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});
		el2.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 500,
			bottom: 800,
		});

		observer.tick();

		expect(inst1.state).toBe('active');
		expect(onActivate1).toHaveBeenCalled();

		// el2 top=500 equals trigger=500, so top <= trigger && bottom > trigger → active
		expect(inst2.state).toBe('active');
		expect(onActivate2).toHaveBeenCalled();

		document.body.removeChild(el1);
		document.body.removeChild(el2);
		observer.destroy();
	});

	it('should skip nearInstances-handled elements in active-instances pass', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });

		const el = document.createElement('div');
		document.body.appendChild(el);

		el.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		const onScroll = vi.fn();
		observer.register(el, { onScroll });

		const inst = observer.instances.get(el);
		// Element is active (from checkInitialState) and in nearInstances
		observer.nearInstances.add(inst);

		// Scroll — element moves to passed
		observer.lastScrollY = 0;
		Object.defineProperty(window, 'scrollY', {
			value: 500,
			configurable: true,
		});

		el.getBoundingClientRect = vi.fn().mockReturnValue({
			top: -100,
			bottom: 200,
		});

		observer.tick();

		// Should have been deactivated in near pass
		expect(inst.state).toBe('passed');
		// onScroll should NOT have been called — element was handled in near pass
		expect(onScroll).not.toHaveBeenCalled();

		document.body.removeChild(el);
		observer.destroy();
	});
});

describe('destroy during pending RAF', () => {
	it('should not process elements when tick fires after destroy', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		const onScroll = vi.fn();
		observer.register(element, { onScroll });

		// Element is active. Start the loop.
		observer.startLoop();

		// Simulate scrollY change so tick would do work
		observer.lastScrollY = 0;
		Object.defineProperty(window, 'scrollY', {
			value: 100,
			configurable: true,
		});

		// Destroy while RAF is pending
		observer.destroy();

		// Manually invoke tick as if the queued RAF fired
		observer.tick();

		// Should not have called onScroll — destroyed flag prevents work
		expect(onScroll).not.toHaveBeenCalled();

		document.body.removeChild(element);
	});
});

describe('unregister element in nearInstances only', () => {
	it('should clean up element that is near but not active', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		// Start inactive (below trigger)
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 600,
			bottom: 900,
		});

		observer.register(element);
		const instance = observer.instances.get(element);

		// Simulate IO adding to nearInstances without activating
		observer.nearInstances.add(instance);
		expect(observer.nearInstances.has(instance)).toBe(true);
		expect(observer.activeInstances.has(instance)).toBe(false);

		observer.unregister(element);

		expect(observer.nearInstances.has(instance)).toBe(false);
		expect(observer.instances.has(element)).toBe(false);

		document.body.removeChild(element);
		observer.destroy();
	});
});

describe('transitionState same-state guard', () => {
	it('should not re-fire onActivate when already active', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const element = document.createElement('div');
		document.body.appendChild(element);

		const onActivate = vi.fn();
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.register(element, { onActivate });
		const instance = observer.instances.get(element);

		// checkInitialState activated it — onActivate called once
		expect(onActivate).toHaveBeenCalledTimes(1);

		// Try to transition to active again
		observer.transitionState(instance, 'active', 100);

		// Should still be 1 — guard prevented duplicate
		expect(onActivate).toHaveBeenCalledTimes(1);

		document.body.removeChild(element);
		observer.destroy();
	});
});

describe('_shouldSuppressTransition direct tests', () => {
	let observer;

	beforeEach(() => {
		observer = new LineObserver();
	});

	afterEach(() => {
		observer.destroy();
	});

	it('should never suppress when activateFrom is both', () => {
		expect(
			observer._shouldSuppressTransition(
				'both',
				'down',
				'inactive',
				'active'
			)
		).toBe(false);
		expect(
			observer._shouldSuppressTransition(
				'both',
				'up',
				'active',
				'inactive'
			)
		).toBe(false);
		expect(
			observer._shouldSuppressTransition(
				'both',
				'down',
				'active',
				'passed'
			)
		).toBe(false);
		expect(
			observer._shouldSuppressTransition(
				'both',
				'up',
				'passed',
				'active'
			)
		).toBe(false);
	});

	it('should allow below activation in correct direction and suppress wrong direction', () => {
		// below + down + inactive→active = allowed
		expect(
			observer._shouldSuppressTransition(
				'below',
				'down',
				'inactive',
				'active'
			)
		).toBe(false);
		// below + up + inactive→active = suppressed
		expect(
			observer._shouldSuppressTransition(
				'below',
				'up',
				'inactive',
				'active'
			)
		).toBe(true);
		// below + down + passed→active = allowed
		expect(
			observer._shouldSuppressTransition(
				'below',
				'down',
				'passed',
				'active'
			)
		).toBe(false);
		// below + up + passed→active = suppressed
		expect(
			observer._shouldSuppressTransition(
				'below',
				'up',
				'passed',
				'active'
			)
		).toBe(true);
	});

	it('should allow below natural exit and suppress snap-back', () => {
		// below + down + active→passed = natural exit, allowed
		expect(
			observer._shouldSuppressTransition(
				'below',
				'down',
				'active',
				'passed'
			)
		).toBe(false);
		// below + up + active→inactive = snap-back, suppressed
		expect(
			observer._shouldSuppressTransition(
				'below',
				'up',
				'active',
				'inactive'
			)
		).toBe(true);
	});

	it('should allow above activation in correct direction and suppress wrong direction', () => {
		// above + up + inactive→active = allowed
		expect(
			observer._shouldSuppressTransition(
				'above',
				'up',
				'inactive',
				'active'
			)
		).toBe(false);
		// above + down + inactive→active = suppressed
		expect(
			observer._shouldSuppressTransition(
				'above',
				'down',
				'inactive',
				'active'
			)
		).toBe(true);
		// above + up + passed→active = allowed
		expect(
			observer._shouldSuppressTransition(
				'above',
				'up',
				'passed',
				'active'
			)
		).toBe(false);
		// above + down + passed→active = suppressed
		expect(
			observer._shouldSuppressTransition(
				'above',
				'down',
				'passed',
				'active'
			)
		).toBe(true);
	});

	it('should allow above natural exit and suppress snap-back', () => {
		// above + up + active→inactive = natural exit, allowed
		expect(
			observer._shouldSuppressTransition(
				'above',
				'up',
				'active',
				'inactive'
			)
		).toBe(false);
		// above + down + active→passed = snap-back, suppressed
		expect(
			observer._shouldSuppressTransition(
				'above',
				'down',
				'active',
				'passed'
			)
		).toBe(true);
	});
});
