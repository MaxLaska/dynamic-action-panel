// path.ts
// Helpers for vault file paths.
import { normalizePath } from 'obsidian';

/**
 * Extracts the folder part of a path.
 * @param path Path string
 * @returns Folder path, '/' when the path has no folder segment, '' for an empty path
 */
export function getFolderFromPath(path: string): string {
    if (!path) return '';
    const lastSlashIndex = path.lastIndexOf('/');
    return lastSlashIndex > -1 ? path.substring(0, lastSlashIndex) : '/';
}

/**
 * Extracts the file name of a path without its extension.
 * @param path Path string
 * @returns File name without extension
 */
export function getFileNameFromPath(path: string): string {
    const lastSlashIndex = path.lastIndexOf('/');
    const fileName = lastSlashIndex > -1 ? path.substring(lastSlashIndex + 1) : path;
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex > -1 ? fileName.substring(0, dotIndex) : fileName;
}

/**
 * Builds a full file path from a folder and a file name.
 * @param folder Folder path
 * @param fileName File name
 * @returns Full file path
 */
export function buildFilePath(folder: string, fileName: string): string {
    // Normalize the file name before assembling the path.
    fileName = normalizePath(fileName);

    // Ensure the file name ends with .md
    const finalFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;

    let fullPath = '';
    if (folder && folder.trim() !== '' && folder !== '/') {
        // Normalize the folder path as well.
        folder = normalizePath(folder);
        fullPath = `${folder}/${finalFileName}`;
    } else {
        fullPath = finalFileName;
    }

    return fullPath;
}
