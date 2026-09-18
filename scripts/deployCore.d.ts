// scripts/deployCore.d.ts
// The public surface of deployCore.mjs, so the safety tests can be typechecked
// and linted like the rest of the project.
//
// Hand-written rather than generated: the module is plain ESM that Node runs
// directly, and adding a compile step to a deployment script would put a build
// between the developer and the thing that installs builds. The surface is
// small and the tests import every entry, so a declaration that drifts from the
// implementation fails at runtime rather than passing quietly.

export interface DeployTarget {
    label: string;
    vaultPath: string;
    productive: boolean;
}

/** A named target, as `DEPLOY_TARGETS` holds it. */
export type DeployTargets = Record<string, DeployTarget>;

export declare const DEPLOY_TARGETS: DeployTargets;
export declare const PLUGIN_ID: string;
export declare const BACKUP_ROOT: string;
export declare const DEPLOYABLE_FILES: string[];
export declare const PROTECTED_FILES: string[];

export declare function canonicalPath(inputPath: string): string;
export declare function pluginDirFor(vaultPath: string, pluginId: string): string;

export declare function resolveTarget(
    name: string | null | undefined,
    targets?: DeployTargets
): DeployTarget & { name: string };

/** Returns the name of the target that matched, or throws. */
export declare function assertAllowedPluginDir(
    pluginDir: string,
    targets?: DeployTargets
): string;

export declare function assertNoLinkedAncestor(targetPath: string): void;

export declare function assertDeployableNames(files: unknown): void;

export declare function validateBuildArtifacts(distDir: string, files?: string[]): string[];

/** Writes the staged copy beside `destFile` and returns its path. */
export declare function stageFile(sourceFile: string, destFile: string): string;

/** Moves a staged file into place; returns the strategy that succeeded. */
export declare function commitStaged(
    staging: string,
    destFile: string,
    options?: { retries?: number; baseDelay?: number }
): 'rename' | 'aside+rename' | 'copy';

export declare function deployArtifacts(
    distDir: string,
    pluginDir: string,
    files?: string[]
): string[];

export declare function sha256(filePath: string): string | null;

export declare function inventory(
    pluginDir: string,
    files?: string[]
): Record<string, string | null>;

export declare function backupInstalledBuild(pluginDir: string, backupDir: string): string[];

export declare function deployToTarget(options: {
    targetName: string | null | undefined;
    distDir: string;
    pluginId: string;
    targets?: DeployTargets;
    files?: string[];
    onBeforeWrite?: (context: {
        target: DeployTarget & { name: string };
        pluginDir: string;
        before: Record<string, string | null>;
    }) => void;
}): {
    target: DeployTarget & { name: string };
    pluginDir: string;
    written: string[];
    before: Record<string, string | null>;
    after: Record<string, string | null>;
};
