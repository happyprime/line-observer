# LineObserver

LineObserver adds a class and calls your functions when an element crosses a line across the viewport. Every observer on the page shares one `requestAnimationFrame` loop, which reads every element before it writes to any, and stops when the page is still.

## Native CSS first

LineObserver complements CSS scroll-driven animations. It does not replace them.

**Use native CSS** for an effect scrubbed to the scroll position, such as parallax or a progress bar. `animation-timeline: view()` or `scroll()`, with `animation-range`, needs no JavaScript, and the browser can run it off the main thread.

**Use LineObserver** when something should happen as an element crosses a line:

- add a class, or call a function;
- reveal an element once and leave it shown, where a `view()` animation would play backwards as the page scrolls back up;
- send an analytics event, or start and stop a video, which CSS can't do;
- act on the scroll direction, with `activateFrom` or `getDirection()`;
- fall back where `animation-timeline` is missing. See [Parallax, native first](#parallax-native-first).

`animation-timeline` is supported in:

- Chrome and Edge 115, July 2023.
- Safari 26.0, September 2025.
- Firefox 159, due 27 October 2026. Firefox 110 to 158 have it behind the `layout.css.scroll-driven-animations.enabled` pref, off by default. MDN's compatibility data says 159; caniuse lists 161.

Scroll-triggered animations (`animation-trigger`), which start a timed animation at a scroll position, are only in Chrome and Edge 146 and later. A transition on `.is-active` does the same in every browser.

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
.observed__inner {
  border-left: 4px solid transparent;
  transition: border-color 0.3s;
}

/* On while the section spans the line, which sits at 50vh by default. */
.observed.is-active .observed__inner {
  border-color: currentColor;
}
```

```js
const observer = new LineObserver();

document.querySelectorAll('.observed').forEach((element) => {
  observer.register(element, {
    onActivate: () => console.log('Active', element),
    onDeactivate: () => console.log('Inactive', element),
  });
});
```

`is-active` is on while the section spans the line, and `is-passed` once its bottom edge is above it. `onActivate` and `onDeactivate` run as `is-active` goes on and off. A section that a jump or a fast scroll takes straight across the line, or that is past it when the page loads, gets both, one after the other.

For a card that fades in, see [Reveal once](#reveal-once). A page can use several observers; they share one loop.

## Recipes

The recipes style a child of the observed element, never the element itself. LineObserver measures the element with `getBoundingClientRect()`, which includes transforms, so moving it moves the box being measured, and its state can flip back and forth near the line.

The recipes share one observer, and a class on `<html>` that turns on their hidden start states. [No-JS fallback](#no-js-fallback) says why the script adds it.

```js
const observer = new LineObserver();

document.documentElement.classList.add('has-line-observer');
```

### Reveal once

```html
<section class="reveal">
  <div class="reveal__inner">…</div>
</section>
```

```css
.has-line-observer .reveal__inner {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.4s, transform 0.4s;
}

.has-line-observer .reveal.is-active .reveal__inner {
  opacity: 1;
  transform: none;
}
```

```js
document.querySelectorAll('.reveal').forEach((element) => {
  observer.register(element, { once: true });
});
```

`once: true` adds `is-active` the first time the element reaches the line, then stops observing it, so the class stays when the page scrolls back up. An element already past the line, when the page loads or after a jump, is revealed at once. An element added to the page later needs its own `register()`.

Without `once`, `is-active` comes off when the element's bottom edge passes the line. Style `is-passed` too, to keep the content shown past the line. Scrolled back below the line, it hides again.

```css
.has-line-observer .reveal.is-passed .reveal__inner {
  opacity: 1;
  transform: none;
}
```

### Progress

`--scroll-progress` is 0 when the line meets the element's top edge and 1 when it meets the bottom edge. It holds 1 past the line and 0 below it. Here it fills a bar that sticks to the top of the viewport while the article scrolls by:

```html
<article class="story">
  <div class="story__bar"></div>
  …
</article>
```

```css
.story__bar {
  position: sticky;
  top: 0;
  height: 4px;
  background: currentColor;
  transform: scaleX(var(--scroll-progress, 0));
  transform-origin: left;
}
```

```js
document.querySelectorAll('.story').forEach((element) => {
  observer.register(element);
});
```

Where `animation-timeline` is supported, CSS can fill the same bar with no JavaScript. [Parallax, native first](#parallax-native-first) shows how to use both.

### Stagger

Observe the list, not each card, so the cards start together and a delay sets their order:

```html
<ul class="cards">
  <li class="card">…</li>
  <li class="card">…</li>
  <li class="card">…</li>
</ul>
```

```css
.has-line-observer .card {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.4s, transform 0.4s;
  transition-delay: calc(var(--i, 0) * 100ms);
}

.has-line-observer .cards.is-active .card {
  opacity: 1;
  transform: none;
}
```

```js
document.querySelectorAll('.cards').forEach((element) => {
  observer.register(element, {
    once: true,
    onActivate: () => {
      element.querySelectorAll('.card').forEach((card, index) => {
        card.style.setProperty('--i', index);
      });
    },
  });
});
```

`onActivate` runs right after LineObserver adds `is-active`, before the browser starts the transitions, so each card starts with its delay. To set the order in the markup instead, give each card its index, as in `style="--i: 2"`.

### Parallax, native first

Where `animation-timeline` is supported, CSS moves the image and LineObserver isn't used. Elsewhere, `--scroll-progress` moves it the same distance at each scroll position.

```html
<section class="parallax">
  <img class="parallax__media" src="…" alt="">
</section>
```

```css
@keyframes parallax {
  from {
    transform: translateY(-40px);
  }

  to {
    transform: translateY(40px);
  }
}

@supports (animation-timeline: view()) {
  .parallax {
    view-timeline: --parallax;
    view-timeline-inset: 50%;
  }

  .parallax__media {
    animation: parallax linear both;
    animation-timeline: --parallax;
  }
}

@supports not (animation-timeline: view()) {
  .parallax__media {
    transform: translateY(calc(var(--scroll-progress, 0) * 80px - 40px));
  }
}
```

```js
if (!CSS.supports('animation-timeline', 'view()')) {
  document.querySelectorAll('.parallax').forEach((element) => {
    observer.register(element);
  });
}
```

`view-timeline-inset: 50%` shrinks the view to a line across the middle of the viewport. The timeline then runs from the section's top edge reaching that line to its bottom edge passing it: the span of `--scroll-progress` with the default `50vh` line. The section is the subject of both, so both measure the same box. `animation-timeline` comes after the `animation` shorthand, which resets it.

The section needs `overflow: hidden`, and the image 80px more height than the section, so its edges never show.

### Reduced motion

Keep the fades and drop the movement. Put this after the rules it overrides: it uses the same selectors, so the later rule wins.

```css
@media (prefers-reduced-motion: reduce) {
  .has-line-observer .reveal__inner,
  .has-line-observer .card {
    transform: none;
  }

  .parallax__media {
    animation: none;
    transform: none;
  }
}
```

Motion that a script starts needs a check before it registers. This clip plays while it spans the line, unless the visitor asks for less motion:

```html
<figure class="clip">
  <video src="…" muted playsinline loop></video>
</figure>
```

```js
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (!reduceMotion.matches) {
  document.querySelectorAll('.clip').forEach((element) => {
    const video = element.querySelector('video');

    observer.register(element, {
      onActivate: () => video.play().catch(() => {}),
      onDeactivate: () => video.pause(),
    });
  });
}
```

`play()` rejects when `pause()` follows at once, as it does for a clip already past the line at load, and when the browser blocks autoplay. The `catch()` keeps that out of the console. `muted` lets the browser play it without a click. The check runs once, so a visitor who changes the setting sees the change on the next load.

### No-JS fallback

Content must show if the script never runs: JavaScript is off, `line-observer.js` is blocked or fails to load, or an error stops the script before it registers anything. So each hidden start state above sits under `has-line-observer`, which the script adds to `<html>` once `new LineObserver()` has worked. If anything before that fails, the class never goes on, and the content shows.

The usual `js` class, set by an inline script in the `<head>`, says only that JavaScript runs. With `line-observer.js` blocked, it would leave the content hidden for good.

Add the class in the same script that registers the elements. An element already past the line then gets `is-active` before the browser paints it hidden. The cost: if the browser paints before the script runs, as it can with `defer`, content between the line and the bottom of the viewport shows, fades out when the class goes on, and fades back in as it reaches the line.

### WordPress blocks

A block's front-end script can read its options from `data-` attributes. A missing attribute gives `undefined`, which keeps the default, and a string of digits counts as a number, so `data-trigger-line="200"` is a 200px line.

```html
<div class="wp-block-theme-callout" data-trigger-line="30vh" data-once>
  <div class="wp-block-theme-callout__inner">…</div>
</div>
```

```js
document.querySelectorAll('.wp-block-theme-callout').forEach((element) => {
  observer.register(element, {
    triggerLine: element.dataset.triggerLine,
    nearMargin: element.dataset.nearMargin,
    once: element.hasAttribute('data-once'),
  });
});
```

Read a boolean from whether the attribute is there. `element.dataset.once` is a string. `'true'` and `'false'` are read as booleans, but the empty string from a bare `data-once` is neither, so it logs a warning and leaves `once` off. Write `data-once` into the markup only when the option is on.

## Upgrading from 0.0.1

`"^0.0.1"` in `package.json` doesn't match 0.2.0: a caret on a 0.0.x version allows only that version. Change it to `"^0.2.0"`.

What changes for code written against 0.0.1:

- **`instance.activationScrollY` is gone.** Read `instance.offset`, or `instance.progress` for `offset / elementHeight`.
- **The offset comes from the element's position:** the distance from its top edge to the line, from 0 to its height. 0.0.1 counted pixels scrolled since the element activated, so it ignored how far a jump took the element past the line, and moved when scroll anchoring moved the page.
- **The end value is held.** An element that leaves the active zone, or crosses the line without activating because of `activateFrom`, keeps an offset equal to its height and progress 1 past the line, or 0 and 0 below it. `onScroll` gets that value once, before any `onDeactivate`. 0.0.1 set `--scroll-offset` to 0 either way, so a child styled from it snapped back to its start state past the line.
- **`onScroll` runs at `register()`** for an element already across the line, and on the frame an element activates. After that it runs in each frame in which the offset or progress changes, not in each frame the page scrolls.
- **Elements past the line get `onActivate`.** At `register()`, as on a page reloaded partway down, and when a jump, a fast scroll or a layout change takes an element across the line between two frames, it gets `onActivate`, `onScroll` and `onDeactivate`, in that order. `register()` ignores `activateFrom`, so this happens with `'below'` too. 0.0.1 gave these elements nothing. Code that handles elements already past the line itself now runs a second time: remove it, or make sure it can run twice.
- **`is-passed` is new.** It is on while the element is past the line. Set `passedClass` if your CSS uses `is-passed` for something else.
- **One loop for every observer.** Observers share one `requestAnimationFrame` loop, one `scroll` listener and one `resize` listener. The loop stops two frames after the page comes to rest, even with elements active, so `isActive()` returns `false` at rest. `tick()` and `handleResize()` are gone.
- **An error in a callback is reported, not thrown.** It goes to `reportError()`, which fires the window `error` event, and the loop keeps running.
- **Option values are checked.** An option set to `undefined` keeps its default; in 0.0.1 it replaced it, and `nearMargin: undefined` made `register()` throw. `triggerLine: '200'` is 200px; 0.0.1 fell back to `50vh`.
- **A resize is filtered by `activateFrom`,** with the direction of the last scroll, and does nothing when the viewport size hasn't changed.

New, and safe to ignore: `once`, `instance.offset`, `instance.progress` and `--scroll-progress`. `--scroll-progress` is written wherever `--scroll-offset` is, and inherits too: see [What the properties cost](#what-the-properties-cost).

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
| `once` | `boolean` | `false` | When true, the element activates the first time it reaches the line, or is found past it, and then LineObserver stops observing it. It keeps `activeClass` and the values it had when it activated, and `onDeactivate` never runs. See [Reveal once](#reveal-once). |
| `activateFrom` | `string` | `'both'` | Which side the element crosses the trigger line from to activate: `'below'` (scrolling down), `'above'` (scrolling up), or `'both'`. |
| `nearMargin` | `number \| string` | `100` | Half-width (in px) of the IntersectionObserver detection band around the trigger line. Larger values detect elements earlier but keep the animation loop running longer. A safety net in the loop handles elements that skip the band during very fast scrolling, and a second IntersectionObserver reports elements that cross the line without entering the band. Elements with the same trigger line and `nearMargin` share both IntersectionObservers. |
| `cssCustomProperty` | `boolean` | `true` | When true, sets `--scroll-offset` and `--scroll-progress` on each element when its values change. Both inherit, so the browser restyles every element inside, even if no CSS reads them. Set to `false` if you only use callbacks. |
| `onActivate` | `function \| null` | `null` | Called when an element crosses the trigger line and becomes active, or is found past it. Receives `(element, instance)`. |
| `onDeactivate` | `function \| null` | `null` | Called when an element leaves the active zone. Receives `(element, instance)`. |
| `onScroll` | `function \| null` | `null` | Called when the element activates, in each frame in which an active element's offset or progress changes, and once more with the value it holds when it leaves the active zone, before `onDeactivate`, or crosses the line without activating. Receives `(offset, element, instance)`. |

Options often come from data attributes, as strings, so a string of digits counts as a number: `nearMargin: '100'` is `100`, and `'true'` and `'false'` count as booleans for `once` and `cssCustomProperty`. An option set to `undefined`, as from a missing attribute, keeps its default. An invalid value, such as a negative `nearMargin`, a `triggerLine` of `'1.2.3vh'` or an empty `activeClass`, logs one warning and falls back to the default: the constructor's for an option given to `register()`, or the built-in one for an option given to the constructor.

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

Returns the direction of the last scroll: `'up'` or `'down'`. A passive `scroll` listener records it, so it stays current while the animation loop is stopped. A move of 1px or less, or of 1.5 device pixels or less, doesn't change it. Firefox can scroll to an anchor at a fractional position in two steps, one device pixel apart, and the second step must not reverse the jump. Small moves the same way add up.

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

A callback that isn't an arrow function gets `instance.options` as `this`.

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

An element with no box, such as one with `display: none`, keeps the state it had, so hiding it and showing it again fires no callbacks. One registered while it has no box starts `'inactive'`, and is read when it gets one. An empty element of zero size still has a box, and is read like any other. An element removed from the page counts as `'inactive'`.

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

`activateFrom` decides the state, the classes and `onActivate` and `onDeactivate`. The values follow the element either way: one that crosses the line without activating holds its height and progress 1 past it, or 0 below it, and `onScroll` gets that value once.

A resize that moves the line across an element, such as a phone's toolbar showing or hiding, is filtered the same way, with the direction of the last scroll. An element held active stays held.

Known limit: with `'below'` or `'above'`, a layout change at rest, such as content above the element growing, is filtered with the direction of the last scroll. That direction has nothing to do with the layout change, so the element can miss an activation or stay active past the line.

## The --scroll-offset CSS custom property

When `cssCustomProperty` is `true` (the default), LineObserver sets `--scroll-offset` on each element when it activates, and in each frame in which it moves while active. The value is the distance in pixels from the element's top edge to the trigger line, so an element that activates after a jump starts at the distance already crossed, not at 0.

The offset comes from the element's position, not from `window.scrollY`. Scroll anchoring that moves the page when content above it changes, or a scroll lock that sets `scrollY` to `0`, leaves it alone.

The value is a number with no unit. Multiply it to get a length: `calc(var(--scroll-offset, 0) * 1px)`. A bare `translateX(var(--scroll-offset))` is invalid, so the transform computes to `none`.

Style a child of the observed element, and give the base rule the start state. This example is scrubbed to the scroll position, so where `animation-timeline` is supported, CSS can do it alone: see [Parallax, native first](#parallax-native-first). With the quick start's markup:

```css
/* At the line: 0.3 opacity, in place. From 200px past it: full opacity, 60px up. */
.observed__inner {
  opacity: clamp(0.3, var(--scroll-offset, 0) / 200, 1);
  transform: translateY(calc(min(var(--scroll-offset, 0), 200) * -0.3px));
}
```

Don't transform the observed element itself, from `--scroll-offset` or from `.is-active`. LineObserver measures it with `getBoundingClientRect()`, which includes transforms, so moving it moves the box being measured, and its state can flip back and forth near the line.

When the element leaves the active zone, or crosses the line without activating because of `activateFrom`, the property holds the value of the side it is on: the element's height once its bottom edge passes the line, or `0` once its top edge drops back below it. So the child above stays at full opacity and 60px up past the line, also when the page loads past it, and returns to its start state below the line. The property is removed when the element is unregistered or the observer is destroyed.

### --scroll-progress

LineObserver also sets `--scroll-progress`: `0` when the line meets the element's top edge, `1` when it meets the bottom edge. It is `--scroll-offset` divided by the element's height, and the height is read with the offset, so it stays right when the element grows. Like the offset, it holds `1` past the line and `0` below it. [Progress](#progress) fills a bar with it.

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
