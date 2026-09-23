// dom.ts
// The smallest element helper the studio needs, on standard DOM only.
//
// Why not Obsidian's `createEl`/`createDiv`: those are prototype augmentations
// that exist only on documents Obsidian has patched. The studio's panel is
// rendered by code that is also exercised in tests under happy-dom, where they
// do not exist — and a panel that can only be verified by opening Obsidian is a
// panel whose collapse bug ships. (It did.) Plain DOM behaves the same in both
// places. The companion ESLint override in eslint.config.mjs covers this
// directory.
//
// Elements are created from the PARENT's own document, never from the global
// one. A workspace view can be dragged into a pop-out window, which is a
// separate document; a node created by the main window's `document` and
// appended there is a cross-document node, which is exactly the kind of bug that
// only shows up the first time somebody moves the tab.

/** What an element can be born with. Deliberately not an attribute bag. */
export interface ElementSpec {
    cls?: string | string[];
    text?: string;
    attr?: Record<string, string>;
}

/** The document a node lives in, so new nodes are born in the same one. */
export function docOf(node: Node): Document {
    return node.ownerDocument ?? (node as Document);
}

/** The window a node lives in, for timers and the screen sampler. */
export function winOf(node: Node): Window {
    return docOf(node).defaultView ?? window;
}

/** Creates an element in the parent's document and appends it. */
export function el<K extends keyof HTMLElementTagNameMap>(
    parent: HTMLElement,
    tag: K,
    spec: ElementSpec = {}
): HTMLElementTagNameMap[K] {
    const node = docOf(parent).createElement(tag);
    const classes = Array.isArray(spec.cls) ? spec.cls : spec.cls ? spec.cls.split(' ') : [];
    for (const name of classes) if (name) node.classList.add(name);
    if (spec.text !== undefined) node.textContent = spec.text;
    for (const [name, value] of Object.entries(spec.attr ?? {})) node.setAttribute(name, value);
    parent.appendChild(node);
    return node;
}

/** A button that is a button: focusable, typed, never a form submit. */
export function button(parent: HTMLElement, spec: ElementSpec = {}): HTMLButtonElement {
    const node = el(parent, 'button', spec);
    node.type = 'button';
    return node;
}
