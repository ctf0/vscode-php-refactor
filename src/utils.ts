import path from 'node:path';
import * as vscode from 'vscode';

export const PACKAGE_CMND_NAME = 'phprefactor';
export const PACKAGE_NAME = 'phpRefactor';
export let config: vscode.WorkspaceConfiguration;
export let filesExcludeGlob: any;
export let NS_EXTENSION_PROVIDER;

export function showMessage(msg, error = true, items: any = []) {
    return error
        ? vscode.window.showErrorMessage(`PHP Refactor: ${msg}`, ...items)
        : vscode.window.showInformationMessage(`PHP Refactor: ${msg}`, ...items);
}

export function setConfig() {
    config = vscode.workspace.getConfiguration(PACKAGE_NAME);
    filesExcludeGlob = config.excludeList
}

export function getConfig(key) {
    return config.get(key);
}

export function getFileNameFromPath(filePath) {
    return path.parse(filePath).name;
}

export function getFileExtFromPath(filePath) {
    return path.parse(filePath).ext;
}

export function getDirNameFromPath(filePath) {
    return path.parse(filePath).dir;
}

export function getFileNamespace(uri?: vscode.Uri) {
    try {
        return NS_EXTENSION_PROVIDER.getNamespace(uri);
    } catch (error) {
        // console.error(error);
        return undefined;
    }
}

export async function NsExtensionProviderInit() {
    const nsResolverExtension = vscode.extensions.getExtension('ctf0.php-namespace-resolver');

    if (nsResolverExtension == null) {
        throw new Error('Depends on \'ctf0.php-namespace-resolver\' extension');
    }

    NS_EXTENSION_PROVIDER = await nsResolverExtension.activate();
}

export function sortSelections(selections: vscode.Selection[]): vscode.Selection[] {
    return selections.sort((a, b) => { // make sure its sorted correctly
        if (a.start.line > b.start.line && a.start.character > b.start.character) return 1;

        if (b.start.line > a.start.line && b.start.character > a.start.character) return -1;

        return 0;
    });
}
