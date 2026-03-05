# LineObserver

A performant scroll interaction observer that triggers handlers when elements cross a configurable "trigger line" in the viewport.

- Single shared `requestAnimationFrame` loop (only runs when instances are active)
- Batched DOM read/write operations via IntersectionObserver + RAF
- Configurable trigger line per instance (px, %, vh, vw)
- Bidirectional scroll support with consistent offset values
- Sets a `--scroll-offset` CSS custom property on active elements by default

## Installation

### npm

```bash
npm install @happyprime/line-observer
```

```js
import LineObserver from '@happyprime/line-observer';
```

### Script tag

```html
<script src="path/to/line-observer.js" type="module"></script>
<script>
  const observer = new LineObserver();
</script>
```

When loaded via script tag, `LineObserver` is available as `window.LineObserver`.

## Quick start

```js
const observer = new LineObserver({ triggerLine: '50vh' });

document.querySelectorAll('.observed').forEach((el) => {
  observer.register(el, {
    activeClass: 'is-active',
    onActivate: (element) => console.log('Activated', element),
    onDeactivate: (element) => console.log('Deactivated', element),
    onScroll: (offset, element, instance) => {
      const progress = offset / instance.elementHeight;
      element.style.opacity = Math.min(1, progress);
    },
  });
});
```

## Constructor options

Options passed to the constructor set defaults for all registered elements. Each option can be overridden per element in `register()`.

```js
const observer = new LineObserver({
  triggerLine: '50vh',        // Position of the trigger line (default: '50vh')
  activeClass: 'is-active',  // Class added when element is active (default: 'is-active')
  activateFrom: 'both',      // Where activation triggers from: 'both', 'below', 'above' (default: 'both')
  nearMargin: 100,           // IO detection band half-width in px (default: 100)
  cssCustomProperty: true,   // Set --scroll-offset on active elements (default: true)
  onActivate: null,          // Callback when element becomes active (default: null)
  onDeactivate: null,        // Callback when element becomes inactive (default: null)
  onScroll: null,            // Callback each frame while element is active (default: null)
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `triggerLine` | `string \| number` | `'50vh'` | Where the trigger line sits in the viewport. Accepts px, %, vh, vw units or a raw number (treated as px). |
| `activeClass` | `string` | `'is-active'` | CSS class added to the element while it is in the active zone. |
| `activateFrom` | `string` | `'both'` | Which side the element crosses the trigger line from to activate: `'below'` (scrolling down), `'above'` (scrolling up), or `'both'`. |
| `nearMargin` | `number` | `100` | Half-width (in px) of the IntersectionObserver detection band around the trigger line. Larger values detect elements earlier but keep the animation loop running longer. A safety net in the loop handles elements that skip the band during very fast scrolling. |
| `cssCustomProperty` | `boolean` | `true` | When true, sets `--scroll-offset` on active elements every frame. Set to false if you only use callbacks. |
| `onActivate` | `function \| null` | `null` | Called when an element crosses the trigger line and becomes active. Receives `(element, instance)`. |
| `onDeactivate` | `function \| null` | `null` | Called when an element leaves the active zone. Receives `(element, instance)`. |
| `onScroll` | `function \| null` | `null` | Called every animation frame while the element is active. Receives `(offset, element, instance)`. |

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

Stop observing an element. Removes the active class and cleans up the `--scroll-offset` property. Returns the instance for chaining.

```js
observer.unregister(el1);
```

### destroy()

Tear down everything: stops the RAF loop, disconnects all IntersectionObservers, removes classes and custom properties from all elements, and removes the resize listener.

```js
observer.destroy();
```

### getActiveCount()

Returns the number of elements currently in the active zone.

```js
observer.getActiveCount(); // 3
```

### getTotalCount()

Returns the total number of registered elements.

```js
observer.getTotalCount(); // 10
```

### isActive()

Returns `true` if the internal RAF loop is currently running.

```js
observer.isActive(); // true
```

### getDirection()

Returns the current scroll direction: `'up'` or `'down'`.

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
| `activationScrollY` | `number` | The `window.scrollY` value when the element was activated. |
| `elementHeight` | `number` | The element's `offsetHeight`, captured at activation. |
| `triggerLinePx` | `number` | The trigger line position in pixels (computed from the `triggerLine` option). |

```js
observer.register(el, {
  onScroll: (offset, element, instance) => {
    // offset = scrollY - activationScrollY (clamped to >= 0)
    const progress = offset / instance.elementHeight;
    element.style.setProperty('--progress', Math.min(1, progress));
  },
  onActivate: (element, instance) => {
    console.log('State:', instance.state);             // 'active'
    console.log('Trigger at:', instance.triggerLinePx); // e.g. 400
    console.log('Height:', instance.elementHeight);     // e.g. 800
  },
});
```

## How the trigger line works

The trigger line is an invisible horizontal line across the viewport. An element becomes active when its top edge scrolls above the line and remains active until its bottom edge also scrolls above it.

Each registered element can be in one of three states:

- `'inactive'` -- element is entirely below the trigger line.
- `'active'` -- element spans the trigger line (top above, bottom below).
- `'passed'` -- element is entirely above the trigger line.

### Supported units

| Value | Meaning |
| --- | --- |
| `'50vh'` | 50% of viewport height (default -- middle of screen) |
| `'100px'` | 100 pixels from top of viewport |
| `'25%'` | 25% of viewport height (equivalent to `'25vh'`) |
| `'50vw'` | 50% of viewport width |
| `200` | Raw number, treated as 200px |

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

## The --scroll-offset CSS custom property

When `cssCustomProperty` is `true` (the default), LineObserver sets `--scroll-offset` on each active element every animation frame. The value is the number of pixels scrolled since the element was activated.

```css
.observed {
  transform: translateY(calc(var(--scroll-offset, 0) * -0.5px));
}

.observed.is-active {
  opacity: calc(var(--scroll-offset, 0) / 500);
}
```

The property is reset to `0` when the element deactivates and removed entirely when the element is unregistered or the observer is destroyed.

To disable this behavior, set `cssCustomProperty` to `false`:

```js
observer.register(el, {
  cssCustomProperty: false,
  onScroll: (offset) => {
    // handle offset in JS instead
  },
});
```

## License

MIT
