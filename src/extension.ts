import * as vscode from 'vscode';
import CodeAction from './Providers/CodeAction';
import Resolver from './Resolver';
import * as utils from './utils';

export async function activate(context) {
    /* Config ------------------------------------------------------------------- */
    utils.setConfig();

    let _refactor = new Resolver(utils.config);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(utils.PACKAGE_NAME)) {
                utils.setConfig();
                _refactor = new Resolver(utils.config);
            }
        }),
    );

    /* Commands ----------------------------------------------------------------- */
    context.subscriptions.push(
        // misc
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_phpdoc`, async () => await _refactor.addPhpDocs()),
        // extract
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.extract_to_function`, async () => await _refactor.extractToFunction()),
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.extract_to_property`, async () => await _refactor.extractToProperty()),
        // missing
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_missing_function`, async () => await _refactor.addMissingFunction()),
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_missing_prop`, async () => await _refactor.addMissingProperty()),
        // new
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_constructor`, async () => await _refactor.addConstructor()),
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_new_property`, async () => await _refactor.addNewProperty()),
        // providers
        vscode.languages.registerCodeActionsProvider('php', new CodeAction()),
    );
}

export function deactivate() { }