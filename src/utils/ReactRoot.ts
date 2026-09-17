import { createRoot, Root } from 'react-dom/client';
import type React from 'react';

/**
 * ReactRoot
 * Wraps the React 18 createRoot API to mount and unmount a React app safely
 * inside an Obsidian ItemView.
 */
export class ReactRoot {
    private root: Root | null = null;
    private container: HTMLElement | null = null;

    /**
     * Mounts a React component into the given container.
     * @param container Container element provided by Obsidian (usually this.contentEl)
     * @param component Root React element
     */
    mount(container: HTMLElement, component: React.ReactElement): void {
        this.container = container;
        this.root = createRoot(container);
        this.root.render(component);
    }

    /**
     * Re-renders the root component without unmounting it.
     */
    update(component: React.ReactElement): void {
        if (!this.root) {
            console.warn('ReactRoot.update: root is null, cannot update');
            return;
        }
        if (!this.container || !this.container.isConnected) {
            console.warn('ReactRoot.update: container is null or disconnected, cannot update');
            return;
        }
        try {
            this.root.render(component);
        } catch (error) {
            console.error('ReactRoot.update: error rendering component', error);
            // If the update failed, try a full remount.
            if (this.container) {
                try {
                    this.root.unmount();
                    this.root = createRoot(this.container);
                    this.root.render(component);
                } catch (remountError) {
                    console.error('ReactRoot.update: error remounting', remountError);
                }
            }
        }
    }

    /**
     * Unmounts the React app and clears the container.
     */
    unmount(): void {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
        if (this.container) {
            this.container.empty();
            this.container = null;
        }
    }
}


