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

// Sets window.scrollY and fires the scroll event a browser would fire.
const scrollWindowTo = (value) => {
	Object.defineProperty(window, 'scrollY', {
		writable: true,
		configurable: true,
		value,
	});
	window.dispatchEvent(new Event('scroll'));
};

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

		it('should return false after destroy() stops a running loop', () => {
			const observer = new LineObserver();
			observer.nearInstances.add({});
			observer.startLoop();
			expect(observer.isActive()).toBe(true);

			observer.destroy();

			expect(observer.isActive()).toBe(false);
			expect(observer.rafId).toBeNull();
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
		scrollWindowTo(200);
		observer.lastScrollY = 200;
		scrollWindowTo(100);

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
		scrollWindowTo(200);
		observer.lastScrollY = 200;
		scrollWindowTo(100);

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
		scrollWindowTo(200);
		observer.lastScrollY = 200;
		scrollWindowTo(100);
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
		scrollWindowTo(200);
		observer.lastScrollY = 200;
		scrollWindowTo(100);
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
		// Simulate scrolling 150px down.
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

		// offset = triggerLine(500) - top(250) = 250
		expect(onScroll).toHaveBeenLastCalledWith(250, element, instance);
	});

	it('should set --scroll-offset CSS custom property during tick', () => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.register(element);

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

		expect(element.style.getPropertyValue('--scroll-offset')).toBe('250');
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
		onScroll.mockClear();

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
	it('should clamp offset to 0 when an element held active is below the line', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const onScroll = vi.fn();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.register(element, { activateFrom: 'below', onScroll });
		const instance = observer.instances.get(element);

		// Scrolling up drops the element below the line. 'below' keeps it
		// active.
		scrollWindowTo(200);
		observer.lastScrollY = 200;
		scrollWindowTo(100);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 520,
			bottom: 820,
		});

		observer.tick();

		expect(instance.state).toBe('active');
		expect(onScroll).toHaveBeenLastCalledWith(0, element, instance);
		expect(instance.progress).toBe(0);

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should clamp offset to the height when an element held active is past the line', () => {
		const observer = new LineObserver({ triggerLine: '50vh' });
		const onScroll = vi.fn();
		const element = document.createElement('div');
		document.body.appendChild(element);

		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 400,
			bottom: 700,
		});

		observer.register(element, { activateFrom: 'above', onScroll });
		const instance = observer.instances.get(element);

		// Scrolling down takes the element past the line. 'above' keeps it
		// active.
		scrollWindowTo(500);
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: -100,
			bottom: 200,
		});

		observer.tick();

		expect(instance.state).toBe('active');
		expect(onScroll).toHaveBeenLastCalledWith(300, element, instance);
		expect(instance.progress).toBe(1);

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

describe('offset precision', () => {
	it('should measure the offset from the rect in checkInitialState', () => {
		const observer = new LineObserver({ triggerLine: '50vh' }); // 500px
		const element = document.createElement('div');
		document.body.appendChild(element);

		// top=200 puts the trigger line (500) 300px into the element.
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
		expect(instance.offset).toBe(300);

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should measure the offset from the rect when activating while scrolling down', () => {
		const observer = new LineObserver({ triggerLine: '50vh' }); // 500px
		const element = document.createElement('div');
		document.body.appendChild(element);

		// Start inactive (below trigger)
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
		observer.nearInstances.add(instance);

		// A 200px scroll down leaves the line 20px into the element.
		observer.lastScrollY = 0;
		Object.defineProperty(window, 'scrollY', {
			value: 200,
			configurable: true,
		});
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 480,
			bottom: 780,
		});
		observer.tick();

		expect(instance.state).toBe('active');
		expect(instance.offset).toBe(20);
		expect(element.style.getPropertyValue('--scroll-offset')).toBe('20');

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should measure the offset from the rect when activating while scrolling up', () => {
		const observer = new LineObserver({ triggerLine: '50vh' }); // 500px
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
		observer.nearInstances.add(instance);

		// A 100px scroll up leaves the line 250px into the element.
		observer.lastScrollY = 600;
		Object.defineProperty(window, 'scrollY', {
			value: 500,
			configurable: true,
		});
		element.getBoundingClientRect = vi.fn().mockReturnValue({
			top: 250,
			bottom: 550,
		});
		observer.tick();

		expect(instance.state).toBe('active');
		expect(instance.offset).toBe(250);
		expect(element.style.getPropertyValue('--scroll-offset')).toBe('250');

		document.body.removeChild(element);
		observer.destroy();
	});

	it('should measure the offset from the rect on resize', () => {
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
		expect(instance.offset).toBe(200);
		expect(element.style.getPropertyValue('--scroll-offset')).toBe('200');

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
		onScroll.mockClear();

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
		// One onScroll, with the height it holds past the line. The
		// active-instances pass did not handle it again.
		expect(onScroll).toHaveBeenCalledTimes(1);
		expect(onScroll).toHaveBeenCalledWith(300, el, inst);

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
		onScroll.mockClear();

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

describe('a jump that ends at rest', () => {
	let observer;
	let first;
	let second;

	const place = (element, top, bottom) => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({ top, bottom });
	};

	const scrollTo = (value) => {
		Object.defineProperty(window, 'scrollY', {
			value,
			configurable: true,
		});
	};

	beforeEach(() => {
		observer = new LineObserver({ triggerLine: '50vh' });
		first = document.createElement('div');
		second = document.createElement('div');
		document.body.append(first, second);
	});

	afterEach(() => {
		first.remove();
		second.remove();
		observer.destroy();
	});

	it('should activate an element reported near after the tick that saw the jump', () => {
		const onActivate = vi.fn();

		// The line is at 500. The first element lies across it, the second
		// is far below.
		place(first, 400, 700);
		place(second, 1300, 1700);

		observer.register(first);
		observer.register(second, { onActivate });

		const firstInstance = observer.instances.get(first);
		const secondInstance = observer.instances.get(second);

		observer.handleIntersection([{ isIntersecting: true }], firstInstance);
		expect(observer.isActive()).toBe(true);

		// The page jumps 1000px in one move. The second element now lies
		// across the line and the first is well past it.
		scrollTo(1000);
		place(first, -600, -300);
		place(second, 300, 700);

		// This tick sees the jump, but IntersectionObserver has not yet
		// said the second element is near.
		observer.tick();
		expect(firstInstance.state).toBe('passed');
		expect(onActivate).not.toHaveBeenCalled();

		// Now it does, with the page at rest.
		observer.handleIntersection([{ isIntersecting: true }], secondInstance);
		observer.tick();

		expect(onActivate).toHaveBeenCalledWith(second, secondInstance);
		expect(secondInstance.state).toBe('active');
	});

	it('should still skip work when the page is at rest and nothing new is near', () => {
		place(first, 600, 900);
		observer.register(first);

		const instance = observer.instances.get(first);

		observer.handleIntersection([{ isIntersecting: true }], instance);
		observer.tick();

		first.getBoundingClientRect.mockClear();
		observer.tick();
		observer.tick();

		expect(first.getBoundingClientRect).not.toHaveBeenCalled();
	});

	it('should keep the direction of the jump for a pass made at rest', () => {
		const onActivate = vi.fn();

		place(first, 400, 700);
		place(second, 1300, 1700);

		observer.register(first);
		observer.register(second, { activateFrom: 'below', onActivate });

		observer.handleIntersection(
			[{ isIntersecting: true }],
			observer.instances.get(first)
		);

		scrollTo(1000);
		place(first, -600, -300);
		place(second, 300, 700);
		observer.tick();

		observer.handleIntersection(
			[{ isIntersecting: true }],
			observer.instances.get(second)
		);
		observer.tick();

		// The page moved down to get here, so an element that activates
		// only from below still does.
		expect(observer.getDirection()).toBe('down');
		expect(onActivate).toHaveBeenCalledTimes(1);
	});

	it('should record which way the page moved while the loop was stopped', () => {
		const onActivate = vi.fn();

		// Nothing is near, so the loop is not running. Its last direction
		// was up.
		place(first, 1300, 1700);
		observer.register(first, { activateFrom: 'below', onActivate });
		observer.currentDirection = 'up';
		expect(observer.isActive()).toBe(false);

		// The page jumps down and rests with the element across the line.
		scrollTo(1000);
		place(first, 300, 700);

		observer.handleIntersection(
			[{ isIntersecting: true }],
			observer.instances.get(first)
		);
		observer.tick();

		expect(observer.getDirection()).toBe('down');
		expect(onActivate).toHaveBeenCalledTimes(1);
	});
});

describe('activation after a jump', () => {
	let observer;
	let element;

	const place = (top, bottom) => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({ top, bottom });
	};

	const scrollTo = (value) => {
		Object.defineProperty(window, 'scrollY', {
			value,
			configurable: true,
		});
	};

	beforeEach(() => {
		// The line is at 500.
		observer = new LineObserver({ triggerLine: '50vh' });
		element = document.createElement('div');
		Object.defineProperty(element, 'offsetHeight', {
			value: 450,
			configurable: true,
		});
		document.body.append(element);
	});

	afterEach(() => {
		element.remove();
		observer.destroy();
	});

	it('should count the offset from the top edge after a jump down', () => {
		const onScroll = vi.fn();

		// The element sits just below the line, inside the IO band.
		place(550, 1000);
		observer.register(element, { onScroll });
		const instance = observer.instances.get(element);
		observer.handleIntersection([{ isIntersecting: true }], instance);
		observer.tick();

		// A 400px jump down leaves the line 350px into the element.
		scrollTo(400);
		place(150, 600);
		observer.tick();

		expect(instance.state).toBe('active');
		expect(instance.offset).toBe(350);
		expect(element.style.getPropertyValue('--scroll-offset')).toBe('350');
		expect(onScroll).toHaveBeenCalledTimes(1);
		expect(onScroll).toHaveBeenCalledWith(350, element, instance);
	});

	it('should count the offset from the top edge after a jump up', () => {
		const onScroll = vi.fn();

		// The element has passed the line.
		scrollTo(1000);
		place(50, 500);
		observer.register(element, { onScroll });
		const instance = observer.instances.get(element);
		expect(instance.state).toBe('passed');
		observer.handleIntersection([{ isIntersecting: true }], instance);
		observer.tick();

		// A 400px jump up leaves the line 50px into the element.
		scrollTo(600);
		place(450, 900);
		observer.tick();

		expect(instance.state).toBe('active');
		expect(instance.offset).toBe(50);
		expect(element.style.getPropertyValue('--scroll-offset')).toBe('50');
		expect(onScroll).toHaveBeenCalledTimes(1);
		expect(onScroll).toHaveBeenCalledWith(50, element, instance);
	});

	it('should write the offset in the pass that activates an element at rest', () => {
		const onScroll = vi.fn();

		// The element is far below the line, so the loop is not running.
		place(1300, 1750);
		observer.register(element, { onScroll });
		const instance = observer.instances.get(element);

		// The page jumps 1000px and rests. IO then reports the element.
		scrollTo(1000);
		place(300, 750);
		observer.handleIntersection([{ isIntersecting: true }], instance);
		observer.tick();

		expect(instance.state).toBe('active');
		expect(instance.offset).toBe(200);
		expect(element.style.getPropertyValue('--scroll-offset')).toBe('200');
		expect(onScroll).toHaveBeenCalledWith(200, element, instance);
	});
});

describe('read and write order', () => {
	let observer;
	let elements;
	let log;

	// Logs every rect and height read, and every class, style and
	// callback write, on one element.
	const watch = (element, rects, height) => {
		element.getBoundingClientRect = () => {
			log.push(`read rect ${element.id}`);
			return rects[element.id];
		};
		Object.defineProperty(element, 'offsetHeight', {
			configurable: true,
			get: () => {
				log.push(`read height ${element.id}`);
				return height;
			},
		});
		for (const method of ['add', 'remove']) {
			const original = element.classList[method].bind(element.classList);
			element.classList[method] = (...args) => {
				log.push(`write class ${element.id}`);
				return original(...args);
			};
		}
		const setProperty = element.style.setProperty.bind(element.style);
		element.style.setProperty = (...args) => {
			log.push(`write style ${element.id}`);
			return setProperty(...args);
		};
	};

	const callbacks = (element) => ({
		onActivate: () => log.push(`write onActivate ${element.id}`),
		onDeactivate: () => log.push(`write onDeactivate ${element.id}`),
		onScroll: () => log.push(`write onScroll ${element.id}`),
	});

	const readsAfterFirstWrite = () => {
		const first = log.findIndex((entry) => entry.startsWith('write'));
		return log.slice(first).filter((entry) => entry.startsWith('read'));
	};

	beforeEach(() => {
		observer = new LineObserver({ triggerLine: '50vh' }); // 500px
		log = [];
		elements = ['a', 'b', 'c', 'd'].map((id) => {
			const element = document.createElement('div');
			element.id = id;
			document.body.append(element);
			return element;
		});
	});

	afterEach(() => {
		elements.forEach((element) => element.remove());
		observer.destroy();
	});

	it('should read every rect and height before the first write in a tick', () => {
		const [a, b, c, d] = elements;
		const rects = {
			a: { top: 300, bottom: 900 }, // active, stays active, not near
			b: { top: 550, bottom: 850 }, // near, activates
			c: { top: 560, bottom: 860 }, // near, activates
			d: { top: 200, bottom: 600 }, // active and near, passes the line
		};

		for (const element of elements) {
			watch(element, rects, 300);
			observer.register(element, callbacks(element));
		}
		for (const element of [b, c, d]) {
			observer.nearInstances.add(observer.instances.get(element));
		}

		// Scroll 150px down.
		observer.lastScrollY = 0;
		Object.defineProperty(window, 'scrollY', {
			value: 150,
			configurable: true,
		});
		rects.a = { top: 150, bottom: 750 };
		rects.b = { top: 400, bottom: 700 };
		rects.c = { top: 410, bottom: 710 };
		rects.d = { top: 50, bottom: 450 };

		log = [];
		observer.tick();

		expect(observer.instances.get(a).state).toBe('active');
		expect(observer.instances.get(b).state).toBe('active');
		expect(observer.instances.get(c).state).toBe('active');
		expect(observer.instances.get(d).state).toBe('passed');
		expect(log).toContain('read rect c');
		expect(log).toContain('write onScroll a');
		expect(readsAfterFirstWrite()).toEqual([]);
	});

	it('should read every rect and height before the first write on resize', () => {
		vi.useFakeTimers();
		const [a, b] = elements;
		const rects = {
			a: { top: 600, bottom: 900 },
			b: { top: 650, bottom: 950 },
		};

		for (const element of [a, b]) {
			watch(element, rects, 300);
			observer.register(element, callbacks(element));
		}

		// A taller viewport moves the line across both elements.
		Object.defineProperty(window, 'innerHeight', {
			value: 1400,
			configurable: true,
		});

		log = [];
		observer.handleResize();
		vi.advanceTimersByTime(200);
		vi.useRealTimers();

		expect(observer.instances.get(a).state).toBe('active');
		expect(observer.instances.get(b).state).toBe('active');
		expect(readsAfterFirstWrite()).toEqual([]);
	});
});

describe('a pass at rest', () => {
	let observer;
	let active;
	let other;
	let onScroll;

	const place = (element, top, bottom) => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({ top, bottom });
	};

	const report = (element, isIntersecting) => {
		observer.handleIntersection(
			[{ isIntersecting }],
			observer.instances.get(element)
		);
	};

	beforeEach(() => {
		// The line is at 500. `active` lies across it and is near.
		observer = new LineObserver({ triggerLine: '50vh' });
		active = document.createElement('div');
		other = document.createElement('div');
		for (const element of [active, other]) {
			Object.defineProperty(element, 'offsetHeight', {
				value: 300,
				configurable: true,
			});
			document.body.append(element);
		}

		onScroll = vi.fn();
		place(active, 300, 600);
		observer.register(active, { onScroll });
		report(active, true);
		observer.tick();
		expect(observer.instances.get(active).state).toBe('active');

		vi.spyOn(active.style, 'setProperty');
		active.getBoundingClientRect.mockClear();
		onScroll.mockClear();
	});

	afterEach(() => {
		active.remove();
		other.remove();
		observer.destroy();
	});

	it('should leave an active element alone when another element is reported', () => {
		// `other` comes near below the line with the page at rest.
		place(other, 1300, 1600);
		observer.register(other);
		place(other, 550, 850);
		report(other, true);
		observer.tick();

		expect(other.getBoundingClientRect).toHaveBeenCalled();
		expect(observer.instances.get(other).state).toBe('inactive');
		expect(active.getBoundingClientRect).not.toHaveBeenCalled();
		expect(active.style.setProperty).not.toHaveBeenCalled();
		expect(onScroll).not.toHaveBeenCalled();
	});

	it('should activate a reported element without touching other active elements', () => {
		const otherScroll = vi.fn();

		// Content above `other` collapses and leaves it across the line,
		// 120px past its top edge.
		place(other, 1300, 1600);
		observer.register(other, { onScroll: otherScroll });
		place(other, 380, 680);
		report(other, true);
		observer.tick();

		const instance = observer.instances.get(other);
		expect(instance.state).toBe('active');
		expect(other.style.getPropertyValue('--scroll-offset')).toBe('120');
		expect(otherScroll).toHaveBeenCalledWith(120, other, instance);
		expect(active.getBoundingClientRect).not.toHaveBeenCalled();
		expect(active.style.setProperty).not.toHaveBeenCalled();
		expect(onScroll).not.toHaveBeenCalled();
	});

	it('should read only the reported elements', () => {
		const near = document.createElement('div');
		document.body.append(near);

		// `near` is in the band but was reported before the last pass.
		place(near, 560, 860);
		observer.register(near);
		report(near, true);
		observer.tick();
		near.getBoundingClientRect.mockClear();

		place(other, 1300, 1600);
		observer.register(other);
		place(other, 550, 850);
		report(other, true);
		observer.tick();

		expect(other.getBoundingClientRect).toHaveBeenCalledTimes(1);
		expect(near.getBoundingClientRect).not.toHaveBeenCalled();
		expect(active.getBoundingClientRect).not.toHaveBeenCalled();

		near.remove();
	});

	it('should deactivate an active element pushed below the line at rest', () => {
		const onDeactivate = vi.fn();
		observer.instances.get(active).options.onDeactivate = onDeactivate;

		// Content above grows by 800px and pushes the element out of the
		// band, below the line.
		place(active, 1100, 1400);
		report(active, false);
		observer.tick();

		expect(observer.instances.get(active).state).toBe('inactive');
		expect(active.classList.contains('is-active')).toBe(false);
		expect(active.style.getPropertyValue('--scroll-offset')).toBe('0');
		expect(onDeactivate).toHaveBeenCalledTimes(1);
		expect(onScroll).toHaveBeenCalledTimes(1);
		expect(onScroll).toHaveBeenCalledWith(0, active, observer.instances.get(active));
	});

	it('should deactivate an active element pulled above the line at rest', () => {
		const onDeactivate = vi.fn();
		observer.instances.get(active).options.onDeactivate = onDeactivate;

		// Content above shrinks by 800px and pulls the element out of the
		// band, above the line.
		place(active, -500, -200);
		report(active, false);
		observer.tick();

		expect(observer.instances.get(active).state).toBe('passed');
		expect(active.classList.contains('is-active')).toBe(false);
		expect(active.style.getPropertyValue('--scroll-offset')).toBe('300');
		expect(onDeactivate).toHaveBeenCalledTimes(1);
	});

	it('should forget a report when the loop stops', () => {
		const lone = new LineObserver({ triggerLine: '50vh' });
		const late = document.createElement('div');
		const lateScroll = vi.fn();
		document.body.append(late);

		// `other` comes near and leaves again before a tick runs, so the
		// loop stops with its report unread.
		place(other, 1300, 1600);
		lone.register(other);
		lone.handleIntersection([{ isIntersecting: true }], lone.instances.get(other));
		lone.handleIntersection([{ isIntersecting: false }], lone.instances.get(other));
		lone.tick();
		expect(lone.isActive()).toBe(false);

		// An element registered across the line starts the loop again.
		place(late, 400, 700);
		lone.register(late, { onScroll: lateScroll });
		late.getBoundingClientRect.mockClear();
		lateScroll.mockClear();
		lone.tick();

		expect(late.getBoundingClientRect).not.toHaveBeenCalled();
		expect(lateScroll).not.toHaveBeenCalled();

		late.remove();
		lone.destroy();
	});

	it('should forget the report of an unregistered element', () => {
		place(other, 1300, 1600);
		observer.register(other);
		place(other, 550, 850);
		report(other, true);
		observer.unregister(other);
		observer.tick();

		expect(active.getBoundingClientRect).not.toHaveBeenCalled();
		expect(onScroll).not.toHaveBeenCalled();
	});

	it('should forget every report on destroy', () => {
		place(other, 1300, 1600);
		observer.register(other);
		report(other, true);
		observer.destroy();

		expect(observer.reportedInstances.size).toBe(0);
	});
});

describe('direction while the loop is stopped', () => {
	let observer;
	let below;
	let above;

	const place = (element, top, bottom) => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({ top, bottom });
	};

	// Registers one element of each kind, both at the same place.
	const registerBoth = (top, bottom) => {
		place(below, top, bottom);
		place(above, top, bottom);
		observer.register(below, { activateFrom: 'below' });
		observer.register(above, { activateFrom: 'above' });
	};

	// Puts both elements across the line and lets IO report them.
	const landOnBoth = () => {
		place(below, 400, 700);
		place(above, 400, 700);
		for (const element of [below, above]) {
			observer.handleIntersection(
				[{ isIntersecting: true }],
				observer.instances.get(element)
			);
		}
		observer.tick();
	};

	const stateOf = (element) => observer.instances.get(element).state;

	beforeEach(() => {
		below = document.createElement('div');
		above = document.createElement('div');
		for (const element of [below, above]) {
			Object.defineProperty(element, 'offsetHeight', {
				value: 300,
				configurable: true,
			});
			document.body.append(element);
		}
	});

	afterEach(() => {
		below.remove();
		above.remove();
		observer.destroy();
	});

	it('should take the last move up, not the net move down since the loop stopped', () => {
		// The line is at 500. Both elements are far below it.
		observer = new LineObserver({ triggerLine: '50vh' });
		registerBoth(1300, 1600);
		expect(observer.isActive()).toBe(false);

		// The page jumps down past both, then up onto them. Nothing comes
		// near on the way, so the loop stays stopped.
		scrollWindowTo(3000);
		scrollWindowTo(1000);
		landOnBoth();

		expect(observer.getDirection()).toBe('up');
		expect(stateOf(above)).toBe('active');
		expect(stateOf(below)).toBe('inactive');
	});

	it('should take the last move down, not the net move up since the loop stopped', () => {
		// The page starts far down, with both elements far above the line.
		scrollWindowTo(3000);
		observer = new LineObserver({ triggerLine: '50vh' });
		registerBoth(-1300, -1000);
		expect(observer.isActive()).toBe(false);

		// The page jumps up past both, then down onto them.
		scrollWindowTo(0);
		scrollWindowTo(1000);
		landOnBoth();

		expect(observer.getDirection()).toBe('down');
		expect(stateOf(below)).toBe('active');
		expect(stateOf(above)).toBe('passed');
	});

	it('should take the direction of a move whose scroll event has not fired', () => {
		observer = new LineObserver({ triggerLine: '50vh' });
		scrollWindowTo(1000);

		// Both elements have just passed the line and are near.
		registerBoth(150, 450);
		for (const element of [below, above]) {
			observer.handleIntersection(
				[{ isIntersecting: true }],
				observer.instances.get(element)
			);
		}
		observer.tick();

		// An anchor jump moves the page up 100px. Chromium runs RAF
		// callbacks before the scroll event for it.
		Object.defineProperty(window, 'scrollY', {
			value: 900,
			configurable: true,
		});
		place(below, 250, 550);
		place(above, 250, 550);
		observer.tick();

		expect(observer.getDirection()).toBe('up');
		expect(stateOf(above)).toBe('active');
		expect(stateOf(below)).toBe('passed');
	});

	it('should remove the scroll listener on destroy', () => {
		observer = new LineObserver();
		const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

		observer.destroy();

		expect(removeEventListenerSpy).toHaveBeenCalledWith(
			'scroll',
			observer.trackDirection
		);
	});
});

describe('a callback that throws', () => {
	let observer;
	let a;
	let b;
	const error = new Error('callback failed');
	const fail = () => {
		throw error;
	};

	const place = (element, top, bottom) => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({ top, bottom });
	};

	const report = (element) => {
		observer.handleIntersection(
			[{ isIntersecting: true }],
			observer.instances.get(element)
		);
	};

	beforeEach(() => {
		// The line is at 500.
		observer = new LineObserver({ triggerLine: '50vh' });
		a = document.createElement('div');
		b = document.createElement('div');
		for (const element of [a, b]) {
			Object.defineProperty(element, 'offsetHeight', {
				value: 300,
				configurable: true,
			});
			document.body.append(element);
		}
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		a.remove();
		b.remove();
		observer.destroy();
		delete window.reportError;
	});

	it('should keep the loop running and finish the pass when onScroll throws', () => {
		const onScroll = vi.fn();

		// `a` lies across the line. `b` is near, just below it.
		place(a, 400, 700);
		place(b, 550, 850);
		observer.register(a, { onScroll: fail });
		observer.register(b, { onScroll });
		report(a);
		report(b);
		observer.tick();

		// A 100px scroll moves the line 50px into `b`.
		scrollWindowTo(100);
		place(a, 300, 600);
		place(b, 450, 750);
		window.requestAnimationFrame.mockClear();

		expect(() => observer.tick()).not.toThrow();

		const instance = observer.instances.get(b);
		expect(instance.state).toBe('active');
		expect(b.style.getPropertyValue('--scroll-offset')).toBe('50');
		expect(onScroll).toHaveBeenCalledWith(50, b, instance);
		expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(observer.isActive()).toBe(true);
		expect(console.error).toHaveBeenCalledWith(error);
	});

	it('should finish the pass when onActivate throws', () => {
		const onActivate = vi.fn();
		const onScroll = vi.fn();

		// Both are near, just below the line.
		place(a, 550, 850);
		place(b, 560, 860);
		observer.register(a, { onActivate: fail });
		observer.register(b, { onActivate, onScroll });
		report(a);
		report(b);
		observer.tick();

		scrollWindowTo(100);
		place(a, 450, 750);
		place(b, 460, 760);
		window.requestAnimationFrame.mockClear();

		expect(() => observer.tick()).not.toThrow();

		expect(a.classList.contains('is-active')).toBe(true);
		expect(b.classList.contains('is-active')).toBe(true);
		expect(onActivate).toHaveBeenCalledTimes(1);
		expect(onScroll).toHaveBeenCalledWith(40, b, observer.instances.get(b));
		expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
	});

	it('should finish the pass when onDeactivate throws', () => {
		const onDeactivate = vi.fn();

		// Both lie across the line, near their bottom edges.
		place(a, 250, 550);
		place(b, 260, 560);
		observer.register(a, { onDeactivate: fail });
		observer.register(b, { onDeactivate });
		report(a);
		report(b);
		observer.tick();

		// Both pass the line.
		scrollWindowTo(100);
		place(a, 150, 450);
		place(b, 160, 460);

		expect(() => observer.tick()).not.toThrow();

		expect(observer.instances.get(a).state).toBe('passed');
		expect(b.classList.contains('is-active')).toBe(false);
		expect(onDeactivate).toHaveBeenCalledTimes(1);
		expect(observer.getActiveCount()).toBe(0);
	});

	it('should let a caller register every element when onActivate throws', () => {
		// Both lie across the line when registered.
		place(a, 400, 700);
		place(b, 450, 750);

		expect(() => {
			for (const element of [a, b]) {
				observer.register(element, { onActivate: fail });
			}
		}).not.toThrow();

		expect(observer.getTotalCount()).toBe(2);
		expect(b.classList.contains('is-active')).toBe(true);
		expect(console.error).toHaveBeenCalledTimes(2);
	});

	it('should finish the resize pass when onActivate throws', () => {
		vi.useFakeTimers();
		const onActivate = vi.fn();

		place(a, 600, 900);
		place(b, 650, 950);
		observer.register(a, { onActivate: fail });
		observer.register(b, { onActivate });

		// A taller viewport moves the line to 700, across both.
		Object.defineProperty(window, 'innerHeight', {
			value: 1400,
			configurable: true,
		});
		observer.handleResize();

		expect(() => vi.advanceTimersByTime(200)).not.toThrow();
		vi.useRealTimers();

		expect(observer.instances.get(a).state).toBe('active');
		expect(observer.instances.get(b).state).toBe('active');
		expect(onActivate).toHaveBeenCalledTimes(1);
	});

	it('should report the error with reportError() where it exists', () => {
		window.reportError = vi.fn();
		place(a, 400, 700);

		observer.register(a, { onActivate: fail });

		expect(window.reportError).toHaveBeenCalledWith(error);
		expect(console.error).not.toHaveBeenCalled();
	});
});

describe('a callback that unregisters or destroys', () => {
	let observer;
	let a;
	let b;

	const place = (element, top, bottom) => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({ top, bottom });
	};

	// Puts `a`, then `b`, in the band just below the line, then scrolls
	// 100px so both cross it in the same pass.
	const crossTogether = () => {
		place(a, 550, 850);
		place(b, 560, 860);
		for (const element of [a, b]) {
			observer.handleIntersection(
				[{ isIntersecting: true }],
				observer.instances.get(element)
			);
		}
		observer.tick();

		scrollWindowTo(100);
		place(a, 450, 750);
		place(b, 460, 760);
		observer.tick();
	};

	beforeEach(() => {
		// The line is at 500. Both elements start far below it.
		observer = new LineObserver({ triggerLine: '50vh' });
		a = document.createElement('div');
		b = document.createElement('div');
		for (const element of [a, b]) {
			Object.defineProperty(element, 'offsetHeight', {
				value: 300,
				configurable: true,
			});
			place(element, 1300, 1600);
			document.body.append(element);
		}
	});

	afterEach(() => {
		a.remove();
		b.remove();
		observer.destroy();
	});

	it('should leave an element alone once onActivate unregisters it', () => {
		const bActivate = vi.fn();
		const bScroll = vi.fn();

		observer.register(a, { onActivate: () => observer.unregister(b) });
		observer.register(b, { onActivate: bActivate, onScroll: bScroll });
		const bInstance = observer.instances.get(b);

		crossTogether();

		expect(observer.instances.get(a).state).toBe('active');
		expect(b.classList.contains('is-active')).toBe(false);
		expect(b.style.getPropertyValue('--scroll-offset')).toBe('');
		expect(observer.activeInstances.has(bInstance)).toBe(false);
		expect(bActivate).not.toHaveBeenCalled();
		expect(bScroll).not.toHaveBeenCalled();

		observer.destroy();

		expect(b.classList.contains('is-active')).toBe(false);
		expect(b.style.getPropertyValue('--scroll-offset')).toBe('');
	});

	it('should make no further writes once onActivate calls destroy()', () => {
		const bActivate = vi.fn();

		observer.register(a, { onActivate: () => observer.destroy() });
		observer.register(b, { onActivate: bActivate });
		window.requestAnimationFrame.mockClear();

		crossTogether();

		expect(bActivate).not.toHaveBeenCalled();
		expect(b.classList.contains('is-active')).toBe(false);
		expect(b.style.getPropertyValue('--scroll-offset')).toBe('');
		expect(observer.isActive()).toBe(false);

		// The first report starts the loop, and the first tick requests the
		// second. The tick in which destroy() runs requests no frame.
		expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
	});
});

describe('the loop at rest', () => {
	let observer;
	let a;
	let b;
	let pending;
	let nextId;

	// Runs the RAF callbacks requested before this frame.
	const frame = () => {
		const callbacks = [...pending.values()];
		pending.clear();
		callbacks.forEach((callback) => callback());
	};

	// Runs frames until the loop stops, and returns how many it took.
	const rest = () => {
		let frames = 0;
		while (observer.isActive() && frames < 10) {
			frame();
			frames++;
		}
		return frames;
	};

	const place = (element, top, bottom) => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({ top, bottom });
	};

	const report = (element, isIntersecting) => {
		observer.handleIntersection(
			[{ isIntersecting }],
			observer.instances.get(element)
		);
	};

	const stateOf = (element) => observer.instances.get(element).state;

	beforeEach(() => {
		pending = new Map();
		nextId = 1;
		window.requestAnimationFrame.mockImplementation((callback) => {
			pending.set(nextId, callback);
			return nextId++;
		});
		window.cancelAnimationFrame.mockImplementation((id) => {
			pending.delete(id);
		});

		// The line is at 500.
		observer = new LineObserver({ triggerLine: '50vh' });
		a = document.createElement('div');
		b = document.createElement('div');
		for (const element of [a, b]) {
			Object.defineProperty(element, 'offsetHeight', {
				value: 300,
				configurable: true,
			});
			document.body.append(element);
		}
	});

	afterEach(() => {
		a.remove();
		b.remove();
		observer.destroy();
	});

	it('should stop after two ticks with no move and no report', () => {
		// `a` lies across the line, so register() starts the loop.
		place(a, 400, 700);
		observer.register(a);
		expect(observer.isActive()).toBe(true);

		frame();
		expect(observer.isActive()).toBe(true);

		frame();
		expect(observer.isActive()).toBe(false);
		expect(pending.size).toBe(0);
		expect(observer.getActiveCount()).toBe(1);
	});

	it('should count only still ticks in a row', () => {
		place(a, 400, 700);
		observer.register(a);

		frame();
		scrollWindowTo(10);
		place(a, 390, 690);
		frame();
		frame();
		expect(observer.isActive()).toBe(true);

		frame();
		expect(observer.isActive()).toBe(false);
	});

	it('should re-read an active element after an anchor jump made while stopped', () => {
		const onScroll = vi.fn();

		// The line is 100px into `a`.
		place(a, 400, 700);
		observer.register(a, { onScroll });
		rest();
		expect(observer.isActive()).toBe(false);

		// An anchor jump moves the page 150px. Chromium runs the frame
		// before the scroll event, and nothing is waiting for that frame.
		Object.defineProperty(window, 'scrollY', {
			value: 150,
			configurable: true,
		});
		place(a, 250, 550);
		frame();

		window.dispatchEvent(new Event('scroll'));
		expect(observer.isActive()).toBe(true);
		frame();

		expect(stateOf(a)).toBe('active');
		expect(a.style.getPropertyValue('--scroll-offset')).toBe('250');
		expect(onScroll).toHaveBeenCalledWith(250, a, observer.instances.get(a));
	});

	it('should re-read the state of an active element a scroll moved while stopped', () => {
		const onDeactivate = vi.fn();

		place(a, 400, 700);
		observer.register(a, { onDeactivate });
		rest();
		expect(observer.isActive()).toBe(false);

		// A 450px jump takes `a` past the line, and past the IO band.
		scrollWindowTo(450);
		place(a, -50, 250);
		frame();

		expect(stateOf(a)).toBe('passed');
		expect(a.classList.contains('is-active')).toBe(false);
		expect(a.style.getPropertyValue('--scroll-offset')).toBe('300');
		expect(onDeactivate).toHaveBeenCalledTimes(1);
	});

	it('should start again when IO reports an element coming near', () => {
		const onActivate = vi.fn();

		place(a, 400, 700);
		place(b, 1300, 1600);
		observer.register(a);
		observer.register(b, { onActivate });
		rest();
		expect(observer.isActive()).toBe(false);

		// Content above `b` collapses at rest and leaves it across the line.
		place(b, 450, 750);
		report(b, true);
		expect(observer.isActive()).toBe(true);
		frame();

		expect(stateOf(b)).toBe('active');
		expect(onActivate).toHaveBeenCalledTimes(1);
	});

	it('should start again when IO reports an active element leaving', () => {
		const onDeactivate = vi.fn();

		place(a, 400, 700);
		observer.register(a, { onDeactivate });
		rest();
		expect(observer.isActive()).toBe(false);

		// Content above grows 800px at rest and pushes `a` out of the
		// band, below the line.
		place(a, 1200, 1500);
		report(a, false);
		expect(observer.isActive()).toBe(true);
		frame();

		expect(stateOf(a)).toBe('inactive');
		expect(onDeactivate).toHaveBeenCalledTimes(1);
	});

	it('should start again when a resize pass activates an element', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		place(a, 400, 800);
		place(b, 600, 900);
		observer.register(a);
		observer.register(b);
		rest();
		expect(observer.isActive()).toBe(false);

		// A taller viewport moves the line to 700, across `b`.
		Object.defineProperty(window, 'innerHeight', {
			value: 1400,
			configurable: true,
		});
		observer.handleResize();
		vi.advanceTimersByTime(200);
		vi.useRealTimers();

		expect(stateOf(b)).toBe('active');
		expect(observer.isActive()).toBe(true);
	});

	it('should start again when register() activates an element', () => {
		place(a, 400, 700);
		observer.register(a);
		rest();
		expect(observer.isActive()).toBe(false);

		place(b, 450, 750);
		observer.register(b);

		expect(observer.isActive()).toBe(true);
	});

	it('should not start on a scroll when nothing is near or active', () => {
		place(a, 1300, 1600);
		observer.register(a);

		scrollWindowTo(100);

		expect(observer.isActive()).toBe(false);
		expect(pending.size).toBe(0);
	});
});

describe('offset and progress from the position', () => {
	let observer;
	let element;
	let onScroll;
	let log;

	const place = (top, bottom) => {
		element.getBoundingClientRect = vi.fn().mockReturnValue({ top, bottom });
	};

	const report = () => {
		observer.handleIntersection(
			[{ isIntersecting: true }],
			observer.instances.get(element)
		);
	};

	const values = () => ({
		offset: element.style.getPropertyValue('--scroll-offset'),
		progress: element.style.getPropertyValue('--scroll-progress'),
	});

	beforeEach(() => {
		// The line is at 500.
		observer = new LineObserver({ triggerLine: '50vh' });
		element = document.createElement('div');
		document.body.append(element);
		log = [];
		onScroll = vi.fn((offset, el, instance) =>
			log.push(`onScroll ${offset} ${instance.progress}`)
		);
	});

	afterEach(() => {
		element.remove();
		observer.destroy();
	});

	describe('the offset', () => {
		it('should stay put when content inserted above moves the page and not the element', () => {
			// The line is 340px into a 600px element.
			scrollWindowTo(1000);
			place(160, 760);
			observer.register(element, { onScroll });
			report();
			observer.tick();
			onScroll.mockClear();
			vi.spyOn(element.style, 'setProperty');

			// 300px of content goes in above. Scroll anchoring adds 300 to
			// scrollY and leaves the element where it was.
			scrollWindowTo(1300);
			observer.tick();

			const instance = observer.instances.get(element);
			expect(instance.state).toBe('active');
			expect(instance.offset).toBe(340);
			expect(values().offset).toBe('340');
			expect(onScroll).not.toHaveBeenCalled();
			expect(element.style.setProperty).not.toHaveBeenCalled();
		});

		it('should stay put when a scroll lock sets scrollY to 0', () => {
			scrollWindowTo(1000);
			place(160, 760);
			observer.register(element, { onScroll });
			report();
			observer.tick();
			onScroll.mockClear();

			// A modal sets `position: fixed` on the body and offsets it, so
			// scrollY is 0 and nothing on the page moves.
			scrollWindowTo(0);
			observer.tick();

			expect(observer.instances.get(element).offset).toBe(340);
			expect(values().offset).toBe('340');
			expect(onScroll).not.toHaveBeenCalled();
		});

		it('should follow the element, not the page, when both move', () => {
			place(160, 760);
			observer.register(element, { onScroll });
			report();
			observer.tick();

			// The page scrolls 100px down while content above the element
			// shrinks 50px, so the element moves 150px up.
			scrollWindowTo(100);
			place(10, 610);
			observer.tick();

			expect(observer.instances.get(element).offset).toBe(490);
			expect(onScroll).toHaveBeenLastCalledWith(
				490,
				element,
				observer.instances.get(element)
			);
		});
	});

	describe('progress', () => {
		it('should follow the offset across the element, down and up', () => {
			// 400px tall, just below the line.
			place(520, 920);
			observer.register(element, { onScroll });
			report();
			observer.tick();
			const instance = observer.instances.get(element);

			scrollWindowTo(120);
			place(400, 800);
			observer.tick();
			expect(instance.progress).toBe(0.25);
			expect(values()).toEqual({ offset: '100', progress: '0.25' });

			scrollWindowTo(320);
			place(200, 600);
			observer.tick();
			expect(values()).toEqual({ offset: '300', progress: '0.75' });

			scrollWindowTo(170);
			place(350, 750);
			observer.tick();
			expect(values()).toEqual({ offset: '150', progress: '0.375' });

			expect(log).toEqual([
				'onScroll 100 0.25',
				'onScroll 300 0.75',
				'onScroll 150 0.375',
			]);
		});

		it('should read the height every pass, so an element that grows keeps it right', () => {
			// The line is 300px into a 600px element.
			place(200, 800);
			observer.register(element, { onScroll });
			report();
			observer.tick();
			const instance = observer.instances.get(element);
			expect(instance.progress).toBe(0.5);

			// The element grows to 1000px, then the page scrolls 100px.
			scrollWindowTo(100);
			place(100, 1100);
			observer.tick();

			expect(instance.elementHeight).toBe(1000);
			expect(instance.offset).toBe(400);
			expect(instance.progress).toBe(0.4);
			expect(values()).toEqual({ offset: '400', progress: '0.4' });

			// Progress stays under 1 until the bottom edge reaches the line.
			scrollWindowTo(699);
			place(-499, 501);
			observer.tick();
			expect(instance.state).toBe('active');
			expect(instance.progress).toBeLessThan(1);
		});
	});

	describe('the value an element holds when it leaves', () => {
		it('should hold its height and progress 1 when it passes the line', () => {
			place(200, 800);
			observer.register(element, { onScroll });
			report();
			observer.tick();

			scrollWindowTo(400);
			place(-200, 400);
			observer.tick();

			const instance = observer.instances.get(element);
			expect(instance.state).toBe('passed');
			expect(instance.offset).toBe(600);
			expect(instance.progress).toBe(1);
			expect(values()).toEqual({ offset: '600', progress: '1' });
		});

		it('should hold 0 when it goes back below the line', () => {
			place(200, 800);
			observer.register(element, { onScroll });
			report();
			observer.tick();

			scrollWindowTo(400);
			place(-200, 400);
			observer.tick();

			// Back up onto the element, then on until it is below the line.
			scrollWindowTo(0);
			place(200, 800);
			observer.tick();
			expect(values()).toEqual({ offset: '300', progress: '0.5' });

			scrollWindowTo(-400);
			place(600, 1200);
			observer.tick();

			const instance = observer.instances.get(element);
			expect(instance.state).toBe('inactive');
			expect(instance.offset).toBe(0);
			expect(instance.progress).toBe(0);
			expect(values()).toEqual({ offset: '0', progress: '0' });
		});

		it('should call onScroll with the held value before onDeactivate', () => {
			const onDeactivate = vi.fn(() => log.push('onDeactivate'));

			place(200, 800);
			observer.register(element, { onScroll, onDeactivate });
			report();
			observer.tick();
			log = [];

			// Down past the line.
			scrollWindowTo(400);
			place(-200, 400);
			observer.tick();
			expect(log).toEqual(['onScroll 600 1', 'onDeactivate']);

			// Up onto it, then back below it.
			scrollWindowTo(100);
			place(100, 700);
			observer.tick();
			log = [];
			scrollWindowTo(-300);
			place(500.5, 1100.5);
			observer.tick();
			expect(log).toEqual(['onScroll 0 0', 'onDeactivate']);
		});

		it('should remove both properties on unregister and on destroy', () => {
			const other = document.createElement('div');
			document.body.append(other);
			other.getBoundingClientRect = vi
				.fn()
				.mockReturnValue({ top: 300, bottom: 700 });

			place(200, 800);
			observer.register(element);
			observer.register(other);
			expect(values()).toEqual({ offset: '300', progress: '0.5' });
			expect(other.style.getPropertyValue('--scroll-progress')).toBe('0.5');

			observer.unregister(element);
			expect(values()).toEqual({ offset: '', progress: '' });

			observer.destroy();
			expect(other.style.getPropertyValue('--scroll-offset')).toBe('');
			expect(other.style.getPropertyValue('--scroll-progress')).toBe('');
			other.remove();
		});
	});

	describe('first values', () => {
		it('should write values and call onScroll when register() activates an element', () => {
			const onActivate = vi.fn(() => log.push('onActivate'));

			place(300, 700);
			observer.register(element, { onActivate, onScroll });

			expect(values()).toEqual({ offset: '200', progress: '0.5' });
			expect(log).toEqual(['onActivate', 'onScroll 200 0.5']);
		});

		it('should write fresh values after a resize moves the line across an active element', () => {
			vi.useFakeTimers();

			place(300, 700);
			observer.register(element, { onScroll });
			log = [];

			// A taller viewport moves the line from 500 to 600.
			Object.defineProperty(window, 'innerHeight', {
				value: 1200,
				configurable: true,
			});
			observer.handleResize();
			vi.advanceTimersByTime(200);
			vi.useRealTimers();

			expect(observer.instances.get(element).state).toBe('active');
			expect(values()).toEqual({ offset: '300', progress: '0.75' });
			expect(log).toEqual(['onScroll 300 0.75']);
		});
	});
});
