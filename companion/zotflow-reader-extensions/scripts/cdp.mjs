// cdp.mjs
// A minimal Chrome DevTools Protocol client, used to drive a real Obsidian
// against a real ZotFlow reader.
//
// It exists because the interesting half of this plugin cannot be unit tested:
// whether the PDF actually reflows, whether the drag handle actually resizes
// from the right edge, whether a second tab actually gets patched. Those are
// facts about somebody else's React app, and the only honest way to check them
// is to ask a running one.
//
// No dependency: Node 21+ ships a WebSocket client, which is all this needs.

/** Every debuggable target of the Obsidian instance on `port`. */
export async function targets(port = 9333) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return response.json();
}

export class Session {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.nextId = 0;
        this.pending = new Map();
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.onopen = () => resolve(this);
            this.ws.onerror = (event) => reject(new Error(`ws error ${event.message ?? ''}`));
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (!message.id || !this.pending.has(message.id)) return;
                const { resolve: ok, reject: fail } = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) fail(new Error(JSON.stringify(message.error)));
                else ok(message.result);
            };
        });
    }

    send(method, params = {}) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (!this.pending.has(id)) return;
                this.pending.delete(id);
                reject(new Error(`timeout ${method}`));
            }, 20000);
        });
    }

    /**
     * Evaluates an expression in the page.
     *
     * Always wrapped in an IIFE by the caller: every evaluation shares one
     * global scope, so a bare `const` in one call collides with the next.
     */
    async eval(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
        });
        if (result.exceptionDetails) {
            throw new Error(
                `EVAL: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`
            );
        }
        return result.result?.value;
    }

    close() {
        try {
            this.ws.close();
        } catch {
            // Closing an already-closed socket is not a failure worth raising.
        }
    }
}

/** Connects to the first target the predicate accepts. */
export async function attach(match, port = 9333) {
    const list = await targets(port);
    const target = list.find(match);
    if (!target) {
        throw new Error(`No matching target. Available: ${list.map((t) => t.url).join(', ')}`);
    }
    const session = new Session(target.webSocketDebuggerUrl);
    await session.connect();
    return session;
}
