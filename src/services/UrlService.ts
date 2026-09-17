import { App, Notice } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { ButtonAction, UrlActionParams } from '@/types/action';
import { tWithParams } from '@/utils/i18n';

/**
 * Handles the open-URL action.
 * Opens an external link, including URL validation and error handling.
 */
export class UrlService {
    /**
     * Initializes the service with the app and plugin instance.
     * @param app Obsidian app instance
     * @param plugin Plugin instance (optional)
     */
    constructor(
        private app: App,
        private plugin?: ButtonsPanelPlugin
    ) {}

    /**
     * Opens an external link from within Obsidian.
     * @param action Button action config; must be type: 'url' with its parameters
     */
    async openUrl(action: ButtonAction): Promise<void> {
        const url = this.validateAndExtractUrl(action);
        if (!url) {
            return;
        }

        const target = this.resolveOpenableUrl(url);
        if (!target) {
            new Notice(tWithParams('invalid_url', { url }));
            return;
        }

        window.open(target, '_blank');
    }

    /**
     * Validates the action type and extracts the URL.
     * @param action Button action config
     * @returns The URL, or an empty string when it is invalid
     */
    private validateAndExtractUrl(action: ButtonAction): string {
        if (action.type !== 'url') {
            throw new Error('Invalid action type for URL opening');
        }
        const urlParams: UrlActionParams = action.parameters;
        return urlParams.url?.trim() || '';
    }

    private static readonly allowedUrlProtocols = new Set(['http:', 'https:', 'obsidian:']);

    /**
     * Parses and validates the input into an openable absolute URL; returns null on failure.
     * Accepts obsidian:// and http(s):// (as far as the URL parser accepts them), plus a bare
     * host that can be completed to https://.
     */
    private resolveOpenableUrl(url: string): string | null {
        if (!url) {
            return null;
        }

        if (url.toLowerCase().startsWith('obsidian://')) {
            try {
                new URL(url);
                return url;
            } catch {
                return null;
            }
        }

        try {
            const { protocol } = new URL(url);
            return UrlService.allowedUrlProtocols.has(protocol.toLowerCase()) ? url : null;
        } catch {
            if (url.includes('://')) {
                return null;
            }
            try {
                const withHttps = `https://${url}`;
                const { protocol } = new URL(withHttps);
                return protocol === 'https:' ? withHttps : null;
            } catch {
                return null;
            }
        }
    }
}
