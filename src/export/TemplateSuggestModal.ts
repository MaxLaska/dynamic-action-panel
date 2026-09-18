// export/TemplateSuggestModal.ts
// The picker for the managed template library: the templates that are actually
// in `Dynamic Action Panel/Templates`, chosen the way everything else in
// Obsidian is chosen.
//
// It reads the folder each time it opens, so a `.ocap.json` the user has just
// copied in from a backup drive is simply there — no rescan command, no index
// to refresh. Nothing is parsed to build the list: the entries are file names
// and modification times, which means a corrupt file costs nothing until it is
// actually chosen, and is then reported by the ordinary import validation.

import { App, FuzzySuggestModal, TFile } from 'obsidian';
import { t } from '@/utils/i18n';
import { listTemplateFiles, templateDisplayName } from '@/export/templateLibrary';

/**
 * Picks one template from the library.
 *
 * Cancelling is a real outcome, not an error: `onChooseItem` is the only path
 * that does anything, so `Esc` leaves no notice and no state behind.
 */
export class TemplateSuggestModal extends FuzzySuggestModal<TFile> {
    private readonly onPick: (file: TFile) => void;

    constructor(app: App, onPick: (file: TFile) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder(t('template_library_placeholder'));
        // The default caps the rendered list well below what the collision
        // ladder can produce, and because the order is ascending by name it is
        // the NEWEST numbered exports that would fall off the end.
        this.limit = 500;
        // An empty library is the normal state before the first export, so it
        // says where to put files rather than reporting that nothing matched.
        this.emptyStateText = t('template_library_empty');
    }

    getItems(): TFile[] {
        return listTemplateFiles(this.app);
    }

    /** What the user types against: the name without the `.ocap.json` tail. */
    getItemText(file: TFile): string {
        return templateDisplayName(file);
    }

    /**
     * Two lines, in the shape the file suggester already uses: the name the
     * user recognizes, and underneath it the modification time, which is what
     * actually tells `Research` from `Research 1` and `Research 2`.
     *
     * Overriding this drops the fuzzy match highlighting, which is a fair
     * trade for a list that is normally short enough to read rather than
     * search.
     */
    renderSuggestion(match: { item: TFile }, el: HTMLElement): void {
        el.addClass('buttons-panel');
        el.createDiv({ cls: 'file-suggestion-title' }).setText(
            templateDisplayName(match.item)
        );
        const modified = match.item.stat?.mtime;
        if (modified) {
            el.createDiv({ cls: 'file-suggestion-desc' }).setText(
                new Date(modified).toLocaleString()
            );
        }
    }

    onChooseItem(file: TFile): void {
        this.onPick(file);
    }
}
