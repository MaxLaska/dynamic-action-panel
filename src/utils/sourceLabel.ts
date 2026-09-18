// sourceLabel.ts
// A compact "who and when" for a PDF, derived from where it sits in the vault.
//
// This is NOT a citation engine and must never grow into one. It exists because
// a bookmark on a highlight has to say which book it points at, and the only
// place that information exists in this vault is the folder the PDF lives in,
// which is kept as `Authors (Year) - Title`. Investigated alternatives and why
// they are not used:
//
// - Source notes, frontmatter, `.bib`/CSL files: no bibliographic field exists
//   anywhere in the vault — the ZotFlow source notes carry only
//   `zotflow-locked` and `zotflow-local-attachment`.
// - The PDF's own metadata: unusable and actively wrong. Publication years are
//   absent (only production dates, off by up to eight years), author lists are
//   truncated to the first name, and one real file names its graphic designer.
// - A Zotero export/cache: stale, keyed on paths outside the vault, and missing
//   many of these sources entirely.
//
// The result is therefore a restatement of the folder name, which is honest but
// only as correct as that name. It is a navigation aid — deliberately NOT a
// citation, and nothing here should ever be fed into a bibliography.

/** Abbreviation in front of the page. German on purpose, as the panel's own convention. */
const PAGE_PREFIX = 'S.';

/** Separator between source and page, matching the notation already in the vault. */
const SEPARATOR = ' · ';

/** Longest a bare-basename fallback may get before it is cut. */
const MAX_FALLBACK = 48;

/** `Authors (YYYY) - Title` — anchored on the YEAR, so a title may contain " - ". */
const CANONICAL = /^(.+?)\s*\((\d{4})\)\s*-\s*.+$/;

/** `Authors - YYYY - Title`, the other convention present in the vault. */
const DASHED = /^(.+?)\s+-\s+(\d{4})\s+-\s+.+$/;

/** A four-digit year delimited so `-2021-` and `-(2019)-` both match. */
const YEAR_IN_NAME = /(?:^|[-_ (])((?:1[89]|20)\d{2})(?:[-_ )]|$)/;

/** An edition suffix a filename fallback should not carry. */
const EDITION_SUFFIX = /[-_ ]Aufl[._ ]?\d+\.?$/i;

/**
 * "Meyer et al." / "Bieker, Westerholt" / "Staub-Bernasconi" from an author
 * segment of a folder name.
 *
 * Authors are separated by ", " and never by "-", which is what keeps a
 * hyphenated surname intact. Case and diacritics are left exactly as written.
 */
function shortenAuthors(segment: string): string {
    const trimmed = segment.trim();
    // An explicit "and others" already says everything; keep only the first name.
    const abbreviated = /^(.*?)[,\s]+(?:et al\.?|u\.\s*a\.?)$/i.exec(trimmed);
    const base = (abbreviated?.[1] ?? trimmed).trim();
    const names = base
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

    if (names.length === 0) {
        return '';
    }
    if (abbreviated || names.length > 2) {
        return `${names[0]} et al.`;
    }
    return names.join(', ');
}

/** Path segments, tolerating either slash and ignoring empty parts. */
function segmentsOf(filePath: string): string[] {
    return filePath.split(/[\\/]/).filter((part) => part.length > 0);
}

/**
 * The folder that names the source: normally the PDF's own folder, one level up
 * when the PDF sits in a `Raw` subfolder of chapter extracts.
 */
function sourceFolderOf(filePath: string): string | undefined {
    const parts = segmentsOf(filePath);
    // parts = [...folders, fileName]
    const parent = parts[parts.length - 2];
    if (parent === undefined) {
        return undefined;
    }
    if (parent.toLowerCase() === 'raw') {
        return parts[parts.length - 3] ?? parent;
    }
    return parent;
}

/** File name without folders, extension, edition suffix or stray dots. */
function tidyBasename(filePath: string): string {
    const name = segmentsOf(filePath).pop() ?? '';
    const withoutExtension = name.replace(/\.[^.]*$/, '');
    return withoutExtension
        .replace(EDITION_SUFFIX, '')
        .replace(/[.\s]+$/, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max).trimEnd()}…`;
}

/**
 * A compact source label for a PDF, or null when its path says nothing useful.
 *
 * In order:
 * 1. `Authors (YYYY) - Title` folder  -> "Authors YYYY"
 * 2. same folder without a year       -> "Authors YYYY" using a year from the file name
 * 3. `Authors - YYYY - Title` folder  -> "Authors YYYY"
 * 4. a folder that is just a title    -> that title, plus a file-name year if there is one
 * 5. neither                          -> the tidied file name
 *
 * An author or a year is never invented: a collective work whose folder carries
 * no author simply shows its title.
 */
export function shortSourceLabel(filePath: string): string | null {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        return null;
    }
    const folder = sourceFolderOf(filePath);
    const basenameYear = YEAR_IN_NAME.exec(segmentsOf(filePath).pop() ?? '')?.[1];

    if (folder) {
        const canonical = CANONICAL.exec(folder);
        if (canonical) {
            const authors = shortenAuthors(canonical[1] ?? '');
            const year = canonical[2] ?? '';
            if (authors) {
                return `${authors} ${year}`.trim();
            }
        }

        const dashed = DASHED.exec(folder);
        if (dashed) {
            const authors = shortenAuthors(dashed[1] ?? '');
            if (authors) {
                return `${authors} ${dashed[2] ?? ''}`.trim();
            }
        }

        // A real title rather than a name: at least two words, no year of its own.
        if (/\s/.test(folder)) {
            return basenameYear ? `${folder} ${basenameYear}` : folder;
        }
    }

    const fallback = tidyBasename(filePath);
    return fallback.length > 0 ? truncate(fallback, MAX_FALLBACK) : null;
}

/**
 * The hover text of an annotation bookmark: which source, and which page.
 *
 * The page is the PRINTED page label exactly as the document shows it, passed
 * through as an opaque string — it is regularly not `pageIndex + 1` (verified
 * against printed folios: offsets of one, three and over a hundred all occur in
 * one vault) and it is not always a number ("Cover"). When it is unknown the
 * page is simply left out rather than replaced by the physical page, because a
 * plausible-looking wrong page is worse in a tooltip than no page at all.
 */
export function annotationTooltip(
    source: string | null | undefined,
    pageLabel?: string
): string | undefined {
    const trimmedSource = source?.trim();
    const page = pageLabel?.trim();
    const parts: string[] = [];
    if (trimmedSource) {
        parts.push(trimmedSource);
    }
    if (page) {
        parts.push(`${PAGE_PREFIX} ${page}`);
    }
    return parts.length > 0 ? parts.join(SEPARATOR) : undefined;
}
