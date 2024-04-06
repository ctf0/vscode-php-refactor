import * as vscode from 'vscode';
import updateFileReferences from './FileReferenceUpdate';
import CodeAction from './Providers/CodeAction';
import Resolver from './Resolver';
import * as utils from './utils';

export async function activate(context) {
    await utils.NsExtensionProviderInit();
    utils.setConfig();

    let _refactor = new Resolver(utils.config);

    context.subscriptions.push(
        // config
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(utils.PACKAGE_NAME)) {
                utils.setConfig();
                _refactor = new Resolver(utils.config);
            }
        }),
        // misc
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_phpdoc`, async () => await _refactor.addPhpDocs()),
        // extract
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.extract_to_function`, async () => await _refactor.extractToFunction()),
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.copy_to_function`, async () => await _refactor.copyToFunction()),
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.extract_to_property`, async () => await _refactor.extractToProperty()),
        // missing
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_missing_function`, async () => await _refactor.addMissingMethod()),
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_missing_prop`, async () => await _refactor.addMethodMissingProperty()),
        // new
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_magic`, async (args) => await _refactor.addMagicMethod(args)),
        vscode.commands.registerCommand(`${utils.PACKAGE_CMND_NAME}.add_new_property`, async () => await _refactor.addNewProperty()),
        // providers
        vscode.languages.registerCodeActionsProvider('php', new CodeAction()),
        // events
        vscode.workspace.onDidRenameFiles(async (event: vscode.FileRenameEvent) => await updateFileReferences(event)),
    );
}

export function deactivate() { }
