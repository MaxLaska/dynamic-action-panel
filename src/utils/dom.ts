// dom.ts
// DOM helpers.

const SCRIPT_LOCAL = 'script';

/**
 * Strips inline `<script>...</script>` from raw SVG markup so DOMParser never
 * instantiates an executable script node in memory. Combined with the post-parse
 * removal below this gives defence in depth.
 */
function stripSvgScriptMarkup(svgMarkup: string): string {
    return svgMarkup.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

/**
 * Removes every `script` element from a parsed subtree, including variants such as
 * HTML embedded in SVG, without relying on `querySelectorAll('script')`.
 */
function removeScriptElementsFromSubtree(root: Element): void {
    const candidates = root.querySelectorAll('*');
    for (let i = candidates.length - 1; i >= 0; i--) {
        const el = candidates[i]!;
        if (el.localName?.toLowerCase() === SCRIPT_LOCAL) {
            el.remove();
        }
    }
}

/**
 * Safely inserts an SVG string into an element: only a `<svg>` root is accepted, and
 * all event attributes and executable script content are removed.
 * @param el Target element
 * @param svgString SVG markup
 */
export function safeSetSVG(el: HTMLElement, svgString: string) {
    if (!svgString || !svgString.trim().startsWith('<svg')) {
        el.empty();
        return;
    }
    const sanitized = stripSvgScriptMarkup(svgString);
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (svg) {
        // Remove all event attributes (on*).
        const removeEventAttrs = (node: Element) => {
            Array.from(node.attributes).forEach((attr) => {
                if (/^on/i.test(attr.name)) {
                    node.removeAttribute(attr.name);
                }
            });
            Array.from(node.children).forEach((child) => removeEventAttrs(child));
        };
        removeEventAttrs(svg);
        removeScriptElementsFromSubtree(svg);
        el.empty();
        el.appendChild(svg);
    } else {
        el.empty();
    }
}
