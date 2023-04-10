import * as vscode from 'vscode';

export const PACKAGE_CMND_NAME = 'phprefactor';
export const PACKAGE_NAME = 'phpRefactor';
export let config: any;

export function showMessage(msg, error = true, items: any = []) {
    return error
        ? vscode.window.showErrorMessage(`PHP Refactor: ${msg}`, ...items)
        : vscode.window.showInformationMessage(`PHP Refactor: ${msg}`, ...items);
}

export function setConfig() {
    config = vscode.workspace.getConfiguration(PACKAGE_NAME);
}
