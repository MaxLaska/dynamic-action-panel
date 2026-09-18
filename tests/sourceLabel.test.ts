// The compact "who and when" a bookmark shows for a PDF.
//
// There is no bibliographic data in this vault — no author, year, title or
// citekey in any note, frontmatter, sidecar or export — so the folder the PDF
// lives in is the only source, and it is kept as `Authors (Year) - Title`. This
// function restates that name; it is not a citation engine and must not become
// one. The fixtures below are the REAL folder and file names from the productive
// library, including every deviation found there, because those deviations are
// the whole difficulty: titles that themselves contain " - ", `et al.`, an
// edition suffix, a trailing dot, hyphenated surnames, umlauts, chapter extracts
// in a `Raw` subfolder, and collective works with no author at all.
//
// The page is the PRINTED label, passed through as an opaque string: it differs
// from `pageIndex + 1` in 10 of 13 real annotations (offsets of one, three and
// over a hundred all occur), so a missing label means no page rather than a
// plausible-looking wrong one.

import { describe, expect, it } from 'vitest';
import { annotationTooltip, shortSourceLabel } from '@/utils/sourceLabel';

const BIB = 'A2_Bib';

/** A PDF inside its source folder, as the vault stores it. */
const at = (folder: string, file: string) => `${BIB}/${folder}/${file}`;

describe('the short source label', () => {
    it('reads authors and year from a canonical folder', () => {
        expect(
            shortSourceLabel(
                at(
                    'Bieker, Westerholt (2021) - Soziale Arbeit studieren',
                    'Bieker-Westerholt-2021-Soziale_Arbeit_studieren-Aufl_5.pdf'
                )
            )
        ).toBe('Bieker, Westerholt 2021');
    });

    it('takes the year from the folder even when the file name has none', () => {
        // Both of these really lack the year in the file name.
        expect(
            shortSourceLabel(
                at('Thole (2012) - Grundriss Soziale Arbeit', 'Thole-Grundriss_Soziale_Arbeit-Aufl_4.pdf')
            )
        ).toBe('Thole 2012');
        expect(
            shortSourceLabel(
                at(
                    'Salomon (2004) - Die wissenschaftlichen Grundlagen der sozialen Arbeit',
                    'Salomon-Die_wissenschaftlichen_Grundlagen_der_sozialen_Arbeit.pdf'
                )
            )
        ).toBe('Salomon 2004');
    });

    it('is not confused by a title that itself contains " - "', () => {
        // Anchoring on "(YYYY) - " rather than on any " - " is what makes this work.
        expect(
            shortSourceLabel(
                at(
                    'Hartung, Kosfelder (2019) - Sozialpsychologie - Psychologie in der Sozialen Arbeit',
                    'Hartung-Kosfelder-2019-Sozialpsychologie-Psychologie_in_der_Sozialen_Arbeit-Aufl_4..pdf'
                )
            )
        ).toBe('Hartung, Kosfelder 2019');
        expect(
            shortSourceLabel(
                at(
                    'Pothmann, Schmidt (2022) - Soziale Arbeit - die Organisationen und Institutionen',
                    'Pothmann-Schmidt-(2022)-Soziale_Arbeit-die_Organisationen_und_Institutionen.pdf'
                )
            )
        ).toBe('Pothmann, Schmidt 2022');
    });

    it('keeps a hyphenated surname whole', () => {
        // Splitting authors on "-" would produce "Staub" and "Bernasconi".
        expect(
            shortSourceLabel(
                at('Staub-Bernasconi (2019) - Menschenwürde', 'Staub-Bernasconi-2019-Menschenwürde.pdf')
            )
        ).toBe('Staub-Bernasconi 2019');
    });

    it('carries an existing "et al." through', () => {
        expect(
            shortSourceLabel(
                at(
                    'Meyer et al. (2022) - Handbuch der Nonprofit-Organisation',
                    'Meyer-Simsa-Badelt-2022-Handbuch.pdf'
                )
            )
        ).toBe('Meyer et al. 2022');
        // Umlaut in the surname, preserved exactly.
        expect(
            shortSourceLabel(
                at(
                    'Wälte et al. (2019) - Psychologische Grundlagen der Sozialen Arbeit',
                    'Wälte-Borg-Laufs-Brückner-2019-Psychologische_Grundlagen.pdf'
                )
            )
        ).toBe('Wälte et al. 2019');
        expect(shortSourceLabel(at('Tov u. a. (2016) - Schlüsselsituationen', 'x-2016-y.pdf'))).toBe(
            'Tov et al. 2016'
        );
    });

    it('abbreviates three or more spelled-out authors itself', () => {
        expect(
            shortSourceLabel(at('Otto, Thiersch, Treptow, Ziegler (2018) - Handbuch', 'x.pdf'))
        ).toBe('Otto et al. 2018');
    });

    it('keeps exactly two authors', () => {
        expect(shortSourceLabel(at('Berner, Böhler (2021) - Postmigration', 'x.pdf'))).toBe(
            'Berner, Böhler 2021'
        );
    });

    it('keeps a single author', () => {
        expect(shortSourceLabel(at('Egelhaaf (2023) - Ökosysteme für Innovationen', 'x.pdf'))).toBe(
            'Egelhaaf 2023'
        );
    });

    it('shows a collective work by its title, inventing no author and no year', () => {
        // These two folders really carry neither author nor year.
        expect(
            shortSourceLabel(
                at('Handbuch Soziale Arbeit', 'Otto-Tiersch-Treptow-Ziegler-Handbuch_Soziale_Arbeit-Aufl_6.pdf')
            )
        ).toBe('Handbuch Soziale Arbeit');
        expect(
            shortSourceLabel(at('Fachlexikon der Sozialen Arbeit', 'Fachlexikon_der_Sozialen_Arbeit.pdf'))
        ).toBe('Fachlexikon der Sozialen Arbeit');
    });

    it('adds a year to a title-only folder when the file name has one', () => {
        expect(shortSourceLabel(at('Handbuch Soziale Arbeit', 'Otto-2018-Handbuch.pdf'))).toBe(
            'Handbuch Soziale Arbeit 2018'
        );
    });

    it('understands the other convention, "Authors - Year - Title"', () => {
        expect(
            shortSourceLabel(
                'A2_Bib/psycho/Rothgang, Bach - 2021 - Entwicklungsplsychologie/Rothgang,Bach-2021-Entwicklungsplsychologie.pdf'
            )
        ).toBe('Rothgang, Bach 2021');
    });

    it('looks past a Raw folder of chapter extracts', () => {
        expect(
            shortSourceLabel(
                at(
                    'Löhe, Aldendorff (2022) - Grundlagen zum Sozialmanagement/Raw',
                    '2022-9-qualitätsmanagement.pdf'
                )
            )
        ).toBe('Löhe, Aldendorff 2022');
    });

    it('falls back to a tidied file name when the folder says nothing', () => {
        // A single-word folder is not a title.
        expect(shortSourceLabel('A2_Bib/psycho/978-3-662-69370-4.pdf')).toBe('978-3-662-69370-4');
        expect(shortSourceLabel('A2_Bib/psycho/Some_Long_Name.pdf')).toBe('Some Long Name');
    });

    it('strips an edition suffix and a trailing dot from the fallback', () => {
        expect(shortSourceLabel('x/Report_Draft-Aufl_4..pdf')).toBe('Report Draft');
    });

    it('truncates an absurd file name', () => {
        const label = shortSourceLabel(`x/${'A'.repeat(200)}.pdf`)!;
        expect(label.length).toBeLessThanOrEqual(49);
        expect(label.endsWith('…')).toBe(true);
    });

    it('handles a file at the vault root and junk input', () => {
        expect(shortSourceLabel('Paper.pdf')).toBe('Paper');
        expect(shortSourceLabel('')).toBeNull();
        expect(shortSourceLabel('   ')).toBeNull();
        expect(shortSourceLabel(undefined as unknown as string)).toBeNull();
        expect(shortSourceLabel(42 as unknown as string)).toBeNull();
    });

    it('accepts backslashes as separators', () => {
        expect(shortSourceLabel('A2_Bib\\Thole (2012) - Grundriss\\Thole.pdf')).toBe('Thole 2012');
    });

    it('does not mistake a four-digit number for a year', () => {
        // 9999 is not a plausible publication year, so no year is added.
        expect(shortSourceLabel(at('Handbuch Soziale Arbeit', 'x-9999-y.pdf'))).toBe(
            'Handbuch Soziale Arbeit'
        );
    });

    it('finds a year at the very end of the file name', () => {
        expect(shortSourceLabel(at('Handbuch Soziale Arbeit', 'Otto-Handbuch-2018.pdf'))).toBe(
            'Handbuch Soziale Arbeit 2018'
        );
        expect(shortSourceLabel(at('Handbuch Soziale Arbeit', 'Otto-Handbuch (2018).pdf'))).toBe(
            'Handbuch Soziale Arbeit 2018'
        );
    });

    it('does not state the year twice', () => {
        // The folder already carries it; appending the file name's would repeat it.
        expect(shortSourceLabel(at('Handbuch 2021', 'Kapitel-2021-x.pdf'))).toBe('Handbuch 2021');
    });

    it('never returns whitespace or a one-word non-title as a source', () => {
        // A single word is a container, not a title, so the file name wins.
        expect(shortSourceLabel('   /a.pdf')).toBe('a');
        expect(shortSourceLabel('Lit/Einwortordner/a.pdf')).toBe('a');
    });

    it('caps a very long folder title', () => {
        const label = shortSourceLabel(`Lit/${'Wort '.repeat(60).trim()}/a.pdf`)!;
        expect(label.length).toBeLessThanOrEqual(49);
        expect(label.endsWith('…')).toBe(true);
    });

    it('survives malformed folder shapes without throwing', () => {
        for (const path of [
            '(2021)/a.pdf',
            'A (2021) - /a.pdf',
            '- 2021 - x/a.pdf',
            'x - 2021 -/a.pdf',
            'Raw/a.pdf',
            'Raw/Raw/a.pdf',
            'Lib/Raw/Raw/a.pdf',
            'Lit/, (2019) - T/a.pdf',
            'Lit/et al. (2020) - Titel/a.pdf',
            '/a.pdf',
            'folder/',
            'H:\\vault\\Lit/Meyer (2019) - T\\file.pdf',
        ]) {
            expect(() => shortSourceLabel(path), path).not.toThrow();
            const label = shortSourceLabel(path);
            expect(label === null || label.trim().length > 0, `${path} -> ${label}`).toBe(true);
        }
    });

    it('resolves a mixed-separator path the same as a clean one', () => {
        expect(shortSourceLabel('H:\\vault\\Lit/Meyer (2019) - T\\file.pdf')).toBe('Meyer 2019');
    });

    it('abbreviates an absurd author list instead of printing it', () => {
        const authors = Array.from({ length: 30 }, (_, i) => `Autor${i}`).join(', ');
        expect(shortSourceLabel(`Lit/${authors} (2020) - Titel/a.pdf`)).toBe('Autor0 et al. 2020');
    });

    it('handles "u. a." with and without the space', () => {
        expect(shortSourceLabel('Lit/Müller u. a. (2020) - Titel/a.pdf')).toBe('Müller et al. 2020');
        expect(shortSourceLabel('Lit/Müller u.a. (2020) - Titel/a.pdf')).toBe('Müller et al. 2020');
    });

    it('stays fast on a pathological path segment', () => {
        // Vault segments cannot realistically be this long; the point is that the
        // regexes do not blow up if one ever is.
        const started = Date.now();
        shortSourceLabel(`Lit/${' '.repeat(5000)}/f.pdf`);
        shortSourceLabel(`Lit/${'a-'.repeat(5000)}(2021)/f.pdf`);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});

describe('the hover text', () => {
    it('is source then printed page', () => {
        expect(annotationTooltip('Bieker, Westerholt 2021', '194')).toBe(
            'Bieker, Westerholt 2021 · S. 194'
        );
    });

    it('passes a non-numeric page label through untouched', () => {
        // Real documents label front matter "Cover", "iv" and the like.
        expect(annotationTooltip('Thole 2012', 'Cover')).toBe('Thole 2012 · S. Cover');
        expect(annotationTooltip('Thole 2012', 'iv')).toBe('Thole 2012 · S. iv');
    });

    it('omits the page when it is unknown, rather than guessing one', () => {
        expect(annotationTooltip('Thole 2012')).toBe('Thole 2012');
        expect(annotationTooltip('Thole 2012', '')).toBe('Thole 2012');
        expect(annotationTooltip('Thole 2012', '   ')).toBe('Thole 2012');
    });

    it('is the page alone when there is no source', () => {
        expect(annotationTooltip(null, '5')).toBe('S. 5');
        expect(annotationTooltip(undefined, '5')).toBe('S. 5');
    });

    it('is nothing at all when neither is known', () => {
        expect(annotationTooltip(null)).toBeUndefined();
        expect(annotationTooltip('   ', '  ')).toBeUndefined();
    });

    it('keeps unicode and unusual characters intact', () => {
        expect(annotationTooltip('Müller & Sørensen 2020', '§12')).toBe(
            'Müller & Sørensen 2020 · S. §12'
        );
        expect(annotationTooltip('日本語 2019', '五')).toBe('日本語 2019 · S. 五');
    });
});
