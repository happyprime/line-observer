# LineObserver

A performant scroll interaction observer that triggers handlers when elements cross a configurable "trigger line" in the viewport.

- One `requestAnimationFrame` loop for every observer on the page, which stops when the page is still
- Batched DOM read/write operations via IntersectionObserver + RAF
- Configurable trigger line per instance (px, %, vh, vw)
- Bidirectional scroll support with consistent offset values
- Sets `--scroll-offset` and `--scroll-progress` CSS custom properties on observed elements by default

## Installation

### npm

```bash
npm install @happyprime/line-observer
```

```js
import LineObserver from '@happyprime/line-observer';
```

The package also exports the minified build, as `@happyprime/line-observer/build/line-observer.js`.

### Script tag

`build/line-observer.js` is a classic script that sets `window.LineObserver`. Load it before the script that uses it:

```html
<script src="path/to/build/line-observer.js"></script>
<script>
  const observer = new LineObserver();
</script>
```

`line-observer.js` is an ES module. Import it in a module script:

```html
<script type="module">
  import LineObserver from './path/to/line-observer.js';

  const observer = new LineObserver();
</script>
```

Don't load `line-observer.js` with `<script type="module" src="…">` and use it from a classic script. Module scripts are deferred, so the classic script runs first and throws `ReferenceError: LineObserver is not defined`.

### WordPress

Copy `build/line-observer.js` into the theme. Enqueue it, then a theme script that lists it as a dependency, both with `defer`:

```php
add_action(
	'wp_enqueue_scripts',
	function () {
		$version = wp_get_theme()->get( 'Version' );
		$args    = array(
			'strategy'  => 'defer',
			'in_footer' => true,
		);

		wp_enqueue_script( 'line-observer', get_theme_file_uri( 'js/line-observer.js' ), array(), $version, $args );
		wp_enqueue_script( 'theme-scroll', get_theme_file_uri( 'js/scroll.js' ), array( 'line-observer' ), $version, $args );
	}
);
```

```js
// js/scroll.js
const observer = new LineObserver();

document.querySelectorAll('.observed').forEach((element) => {
  observer.register(element);
});
```

Keep the setup in its own file. `wp_add_inline_script( 'line-observer', …, 'after' )` makes WordPress drop `defer` from `line-observer`.

A theme built with `@wordpress/scripts` can import the package instead and enqueue only its own bundle.

## Quick start

```html
<section class="observed">
  <div class="observed__inner">…</div>
</section>
```

```css
/* The start state. */
.observed__inner {
  opacity: 0.3;
}
```

```js
const observer = new LineObserver({
  triggerLine: '50vh',
  cssCustomProperty: false, // Callbacks only, so skip the custom properties.
});

document.querySelectorAll('.observed').forEach((el) => {
  const inner = el.querySelector('.observed__inner');

  observer.register(el, {
    onActivate: (element) => console.log('Activated', element),
    onDeactivate: (element) => console.log('Deactivated', element),
    onScroll: (offset) => {
      // 0.3 at the line, 1 from 200px past it.
      inner.style.opacity = 0.3 + 0.7 * Math.min(1, offset / 200);
    },
  });
});
```

`onScroll` runs when an element activates, in each frame it moves while active, and once more as it leaves, with the offset it holds: its height past the line, `0` below it. So the child ends at full opacity past the line, also when the page loads past it, and goes back to 0.3 below it.

A page can use several observers. They share one loop, which reads every element before it writes to any.

## Constructor options

Options passed to the constructor set defaults for all registered elements. Each option can be overridden per element in `register()`.

```js
const observer = new LineObserver({
  triggerLine: '50vh',        // Position of the trigger line (default: '50vh')
  activeClass: 'is-active',  // Class added when element is active (default: 'is-active')
  passedClass: 'is-passed',  // Class present while element is past the line (default: 'is-passed')
  once: false,               // Activate once, then stop observing the element (default: false)
  activateFrom: 'both',      // Where activation triggers from: 'both', 'below', 'above' (default: 'both')
  nearMargin: 100,           // IO detection band half-width in px (default: 100)
  cssCustomProperty: true,   // Set --scroll-offset and --scroll-progress (default: true)
  onActivate: null,          // Callback when element becomes active (default: null)
  onDeactivate: null,        // Callback when element becomes inactive (default: null)
  onScroll: null,            // Callback when an active element's offset changes (default: null)
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `triggerLine` | `string \| number` | `'50vh'` | Where the trigger line sits in the viewport. Accepts px, %, vh, vw units or a raw number (treated as px). A string with no unit, such as `'200'`, is px too. |
| `activeClass` | `string` | `'is-active'` | CSS class added to the element while it is in the active zone. |
| `passedClass` | `string` | `'is-passed'` | CSS class present while the element is past the line: its state is `'passed'`. It gives CSS a stable end state. |
| `once` | `boolean` | `false` | When true, the element activates the first time it reaches the line, or is found past it, and then LineObserver stops observing it. It keeps `activeClass`, its values are written once, and `onDeactivate` never runs. See [Reveal once](#reveal-once). |
| `activateFrom` | `string` | `'both'` | Which side the element crosses the trigger line from to activate: `'below'` (scrolling down), `'above'` (scrolling up), or `'both'`. |
| `nearMargin` | `number \| string` | `100` | Half-width (in px) of the IntersectionObserver detection band around the trigger line. Larger values detect elements earlier but keep the animation loop running longer. A safety net in the loop handles elements that skip the band during very fast scrolling, and a second IntersectionObserver reports elements that cross the line without entering the band. Elements with the same trigger line and `nearMargin` share both IntersectionObservers. |
| `cssCustomProperty` | `boolean` | `true` | When true, sets `--scroll-offset` and `--scroll-progress` on each element when its values change. Both inherit, so the browser restyles every element inside, even if no CSS reads them. Set to `false` if you only use callbacks. |
| `onActivate` | `function \| null` | `null` | Called when an element crosses the trigger line and becomes active, or is found past it. Receives `(element, instance)`. |
| `onDeactivate` | `function \| null` | `null` | Called when an element leaves the active zone. Receives `(element, instance)`. |
| `onScroll` | `function \| null` | `null` | Called when the element activates, in each frame in which an active element's offset or progress changes, and once more with the value it holds when it leaves the active zone, before `onDeactivate`. Receives `(offset, element, instance)`. |

Options often come from data attributes, as strings, so a string of digits counts as a number: `nearMargin: '100'` is `100`. An option set to `undefined`, as from a missing attribute, keeps its default. An invalid value, such as a negative `nearMargin`, a `triggerLine` of `'1.2.3vh'` or an empty `activeClass`, logs one warning and falls back to the default: the constructor's for an option given to `register()`, or the built-in one for an option given to the constructor.

## Methods

### register(element, options?)

Register an element for observation. Options override the constructor defaults for this element. Returns the `LineObserver` instance for chaining.

```js
observer
  .register(el1, { triggerLine: '30vh' })
  .register(el2, { activateFrom: 'below' })
  .register(el3);
```

### unregister(element)

Stop observing an element. Removes the active and passed classes, `--scroll-offset` and `--scroll-progress`. Returns the instance for chaining.

A `once` element that has been revealed is no longer observed, so `unregister()` leaves it alone.

```js
observer.unregister(el1);
```

### destroy()

Tear down the observer: takes it out of the RAF loop, disconnects its IntersectionObservers, and removes classes and custom properties from its elements. Revealed `once` elements keep theirs. Other observers keep working; the last one destroyed removes the shared resize and scroll listeners.

```js
observer.destroy();
```

### getActiveCount()

Returns the number of elements currently in the active zone.

```js
observer.getActiveCount(); // 3
```

### getTotalCount()

Returns the number of elements being observed. A `once` element leaves the count when it is revealed.

```js
observer.getTotalCount(); // 10
```

### isActive()

Returns `true` while this observer takes part in the shared RAF loop. The loop stops two frames after the page comes to rest, even with elements active, and starts again on the next scroll while an element is near the line or active, or when an IntersectionObserver reports an element. Returns `false` after `destroy()`.

```js
observer.isActive(); // true
```

### getDirection()

Returns the direction of the last scroll: `'up'` or `'down'`. A passive `scroll` listener records it, so it stays current while the animation loop is stopped.

```js
observer.getDirection(); // 'down'
```

## Instance data in callbacks

The `instance` object passed to `onActivate`, `onDeactivate`, and `onScroll` callbacks contains:

| Property | Type | Description |
| --- | --- | --- |
| `element` | `HTMLElement` | The observed DOM element. |
| `options` | `object` | Merged options (constructor defaults + per-element overrides). |
| `state` | `string` | Current state: `'inactive'`, `'active'`, or `'passed'`. |
| `offset` | `number` | The distance in pixels from the element's top edge to the trigger line, from `0` to `elementHeight`. Past the line it holds `elementHeight`, and below it `0`. |
| `progress` | `number` | `offset / elementHeight`, from `0` to `1`. Past the line it holds `1`, and below it `0`. |
| `elementHeight` | `number` | The element's height, read from the same `getBoundingClientRect()` as `offset`. |
| `triggerLinePx` | `number` | The trigger line position in pixels (computed from the `triggerLine` option). |

```js
observer.register(el, {
  onScroll: (offset, element, instance) => {
    // instance.progress is offset / instance.elementHeight.
    element.querySelector('.meter').value = instance.progress;
  },
  onActivate: (element, instance) => {
    console.log('State:', instance.state);             // 'active'
    console.log('Trigger at:', instance.triggerLinePx); // e.g. 400
    console.log('Height:', instance.elementHeight);     // e.g. 800
  },
});
```

## Errors in callbacks

If `onActivate`, `onDeactivate` or `onScroll` throws, LineObserver reports the error with `reportError()`, or `console.error()` where `reportError()` does not exist, and carries on. Other elements still update in that frame, the loop keeps running, and `register()` returns as usual.

A callback can call `unregister()` or `destroy()`. An element removed that way gets no more classes, styles or callbacks, even if it was due to change state in the same frame.

## How the trigger line works

The trigger line is an invisible horizontal line across the viewport. An element becomes active when its top edge scrolls above the line and remains active until its bottom edge also scrolls above it.

Each registered element can be in one of three states:

- `'inactive'` -- element is entirely below the trigger line.
- `'active'` -- element spans the trigger line (top above, bottom below).
- `'passed'` -- element is entirely above the trigger line.

An element can go from `'inactive'` to `'passed'` with no frame that sees it on the line: it is past the line when it is registered, as on a page reloaded partway down; a fast scroll or a jump takes it across; or content added or removed above it moves it across. It still activates on the way, so its callbacks stay balanced: `onActivate`, then `onScroll` with the value it holds, then `onDeactivate`, all in one frame. Going straight back from `'passed'` to `'inactive'`, as on a jump to the top of the page, does the same. `activateFrom` filters these by the direction of the last scroll, as it filters any crossing. `register()` ignores `activateFrom`.

While an element is `'passed'` it has the `passedClass`, `is-passed` by default. Use it to hold an end state in CSS:

```css
.observed.is-passed .observed__inner {
  opacity: 1;
}
```

An element with no box, such as one with `display: none`, counts as `'inactive'`.

### Supported units

| Value | Meaning |
| --- | --- |
| `'50vh'` | 50% of viewport height (default -- middle of screen) |
| `'100px'` | 100 pixels from top of viewport |
| `'25%'` | 25% of viewport height (equivalent to `'25vh'`) |
| `'50vw'` | 50% of viewport width |
| `200` | Raw number, treated as 200px |
| `'200'` | String with no unit, treated as 200px |

`vh` and `%` lines are measured from `window.innerHeight`, not from the CSS `vh` unit. On a phone, `innerHeight` changes when the browser's toolbar shows or hides, so the line moves with it, and an element whose edge sits between the two positions changes state. A `px` line stays put.

```js
// Trigger near the top of the viewport
new LineObserver({ triggerLine: '10vh' });

// Trigger at a fixed pixel position
new LineObserver({ triggerLine: '200px' });

// Override per element
observer.register(el, { triggerLine: '75vh' });
```

## Activation filtering

The `activateFrom` option controls which direction the element must cross the trigger line from to activate.

```js
// Only activate when element crosses trigger line from below
observer.register(el, { activateFrom: 'below' });

// Only activate when element crosses trigger line from above
observer.register(el, { activateFrom: 'above' });

// Activate from either direction (default)
observer.register(el, { activateFrom: 'both' });
```

When `activateFrom` is `'below'`:
- Elements activate only when they first touch the trigger line from below (user scrolling down).
- Elements will not activate when crossing from above.
- Once active, deactivation by scrolling back up (element returning below the trigger line) is suppressed.

When `activateFrom` is `'above'`:
- Elements activate only when they first touch the trigger line from above (user scrolling up).
- Elements will not activate when crossing from below.
- Once active, deactivation by scrolling back down (element passing above the trigger line) is suppressed.

A resize that moves the line across an element, such as a phone's toolbar showing or hiding, is filtered the same way, with the direction of the last scroll. An element held active stays held.

Known limit: with `'below'` or `'above'`, a layout change at rest, such as content above the element growing, is filtered with the direction of the last scroll. That direction has nothing to do with the layout change, so the element can miss an activation or stay active past the line.

## Reveal once

For a reveal that runs once, register with `once: true` and put a CSS transition on `.is-active`. LineObserver adds the class the first time the element reaches the line, or finds it past the line, and then stops observing it. The class stays, so scrolling back up does not hide the content again.

```html
<section class="reveal">
  <div class="reveal__inner">…</div>
</section>
```

```css
.reveal__inner {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.4s, transform 0.4s;
}

.reveal.is-active .reveal__inner {
  opacity: 1;
  transform: none;
}
```

```js
document.querySelectorAll('.reveal').forEach((element) => {
  observer.register(element, { once: true });
});
```

Elements above the line when the page loads, or put above it by a jump or by content added above them, are revealed too. An element you add to the page needs its own `register()` call.

Transition a child, not the observed element. LineObserver measures the element's box, which a transform moves.

A revealed element is no longer observed. `getTotalCount()` does not count it, `unregister()` and `destroy()` leave its class and values alone, and LineObserver keeps no reference to it.

## The --scroll-offset CSS custom property

When `cssCustomProperty` is `true` (the default), LineObserver sets `--scroll-offset` on each element when it activates, and in each frame in which it moves while active. The value is the distance in pixels from the element's top edge to the trigger line, so an element that activates after a jump starts at the distance already crossed, not at 0.

The offset comes from the element's position, not from `window.scrollY`. Scroll anchoring that moves the page when content above it changes, or a scroll lock that sets `scrollY` to `0`, leaves it alone.

The value is a number with no unit. Multiply it to get a length: `calc(var(--scroll-offset, 0) * 1px)`. A bare `translateX(var(--scroll-offset))` is invalid, so the transform computes to `none`.

Style a child of the observed element, and give the base rule the start state. With the quick start's markup:

```css
/* At the line: 0.3 opacity, in place. From 200px past it: full opacity, 60px up. */
.observed__inner {
  opacity: clamp(0.3, var(--scroll-offset, 0) / 200, 1);
  transform: translateY(calc(min(var(--scroll-offset, 0), 200) * -0.3px));
}
```

Don't transform the observed element itself, from `--scroll-offset` or from `.is-active`. LineObserver measures it with `getBoundingClientRect()`, which includes transforms, so moving it moves the box being measured, and its state can flip back and forth near the line.

When the element leaves the active zone, the property holds the value it left with: the element's height once its bottom edge passes the line, or `0` once its top edge drops back below it. So the child above stays at full opacity and 60px up past the line, also when the page loads past it, and returns to its start state below the line. The property is removed when the element is unregistered or the observer is destroyed.

### --scroll-progress

LineObserver also sets `--scroll-progress`: `0` when the line meets the element's top edge, `1` when it meets the bottom edge. It is `--scroll-offset` divided by the element's height, and the height is read with the offset, so it stays right when the element grows. Like the offset, it holds `1` past the line and `0` below it.

Style a child of the observed element with it:

```html
<section class="observed">
  <div class="observed__bar"></div>
</section>
```

```css
/* Fills from left to right as the line crosses the section. */
.observed__bar {
  height: 4px;
  background: currentColor;
  transform: scaleX(var(--scroll-progress, 0));
  transform-origin: left;
}
```

### What the properties cost

`--scroll-offset` and `--scroll-progress` inherit, and change on each active element in every frame it moves, so the browser restyles everything inside an observed element, whether or not CSS reads them. In Chromium 156, scrolling through 10 elements with 200 descendants each took 49ms of style recalculation, and none with `cssCustomProperty: false`. Observe elements with few descendants, or turn the properties off and use `onScroll`:

```js
observer.register(el, {
  cssCustomProperty: false,
  onScroll: (offset) => {
    // handle offset in JS instead
  },
});
```

## License

MIT License. See [LICENSE](./LICENSE) for details.
