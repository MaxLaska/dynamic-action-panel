// open.ts
// Opening the studio: reveal the one that exists, or make one on the right.
//
// This is a single call to `Workspace.ensureSideLeaf`, and the reason it is not
// hand-written is worth recording. Measured against Obsidian 1.13.7's own
// implementation, `ensureSideLeaf(type, side, …)`:
//
//   - takes the FIRST existing leaf of the type, wherever it is — the right
//     dock, a split in the main area, a pop-out window — and only if there is
//     none creates one in the requested dock;
//   - loads it if it is deferred;
//   - reveals it (uncollapsing the dock if needed);
//   - and, with `active`, focuses it.
//
// That is exactly "Single-Instance, open or reveal", including the case where
// the user has dragged the studio somewhere else since. A hand-rolled
// `getLeavesOfType` + `getRightLeaf` + `revealLeaf` would be the same logic
// with more places to get the deferred-view case wrong.
//
// The user can still make a second studio with Obsidian's own "split" or "open
// in new window" on the tab. That is not prevented — fighting the native
// docking UI is exactly what this project decided not to do — and it is not a
// problem: every studio view reads the same settings and is told about every
// change (see `forEachStudioView` in main.ts).

import type { Workspace, WorkspaceLeaf } from 'obsidian';

import { NEXUS_STUDIO_VIEW_TYPE } from './view';

/** The one method of the workspace this needs. */
export type StudioOpener = Pick<Workspace, 'ensureSideLeaf'>;

/** Reveals the existing studio view, or opens one in the right dock. */
export function openStudio(workspace: StudioOpener): Promise<WorkspaceLeaf> {
    return workspace.ensureSideLeaf(NEXUS_STUDIO_VIEW_TYPE, 'right', {
        active: true,
        reveal: true,
    });
}
