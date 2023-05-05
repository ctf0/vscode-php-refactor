import throttle from 'lodash.throttle';
import * as vscode from 'vscode';
import * as symbolsAndReferences from '../Symbol/SymbolsAndReferences';
import * as utils from '../utils';

export default class CodeAction implements vscode.CodeActionProvider {
    SYMBOLS: vscode.DocumentSymbol[] | undefined;

    public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[] | undefined> {
        const editor = vscode.window.activeTextEditor;

        if (!document || !utils.config.enableCodeActions || !editor) {
            return;
        }

        await this.setSymbols(document);

        const symbols = this.SYMBOLS;
        const { selections } = editor;

        const commands: any = [];

        if (symbols) {
            const _classSymbols: vscode.DocumentSymbol[] | undefined = symbolsAndReferences.extractClassSymbols(symbols);

            // addMagicMethod
            if (_classSymbols) {
                for (const methodName of symbolsAndReferences.filterMagicSymbols(_classSymbols, utils.config.magicMethods)) {
                    commands.push(
                        {
                            command   : `${utils.PACKAGE_CMND_NAME}.add_magic`,
                            title     : `Add ${methodName}`,
                            arguments : [methodName],
                        },
                    );
                }
            }

            // addNewProperty
            commands.push({
                command : `${utils.PACKAGE_CMND_NAME}.add_new_property`,
                title   : 'Add New Property',
            });

            if (range.isEmpty === true) {
                const _methodsOrFunctions = symbolsAndReferences.extractMethodOrFunctionsSymbols(symbols);

                if (_methodsOrFunctions && !symbolsAndReferences.hasStartOrEndIntersection(selections, _methodsOrFunctions)) {
                    const activeSelection = selections[0].active;

                    // add_missing_function
                    const methodWordRange = document.getWordRangeAtPosition(activeSelection, /(?<=(:|\$this->))\w+(?=\()/);

                    if (methodWordRange) {
                        const methodName = document.getText(methodWordRange);

                        if (!_methodsOrFunctions.some((item) => item.name == methodName)) {
                            commands.push(
                                {
                                    command : `${utils.PACKAGE_CMND_NAME}.add_missing_function`,
                                    title   : 'Add Missing Method/Function Declaration',
                                    type    : vscode.CodeActionKind.QuickFix,
                                },
                            );
                        }
                    }

                    // add_missing_prop
                    const propWordRange = document.getWordRangeAtPosition(activeSelection, /(?<=(:\$|\$this->))\w+\b(?!\()/);

                    if (propWordRange) {
                        const propName = document.getText(propWordRange);
                        const _props: vscode.DocumentSymbol[] | undefined = await symbolsAndReferences.extractPropSymbols(_classSymbols);

                        if (!_props || !_props.some((item) => item.name == `\$${propName}`)) {
                            commands.push(
                                {
                                    command : `${utils.PACKAGE_CMND_NAME}.add_missing_prop`,
                                    title   : 'Add Missing Property',
                                    type    : vscode.CodeActionKind.QuickFix,
                                },
                            );
                        }
                    }
                }
            } else {
                // extract_to_function
                if (selections.length == 1) {
                    const txt = document.getText(selections[0]).trim();

                    if (!(txt.startsWith('->') || txt.startsWith('::'))) {
                        commands.push({
                            command : `${utils.PACKAGE_CMND_NAME}.extract_to_function`,
                            title   : 'Extract To Method/Function',
                            type    : vscode.CodeActionKind.RefactorExtract,
                        });
                    }
                }

                // extract_to_property
                if (!selections.some((item) => {
                    const txt = document.getText(item).trim();

                    return txt.startsWith('return') || txt.startsWith('->') || txt.startsWith('::');
                })) {
                    commands.push(
                        {
                            command : `${utils.PACKAGE_CMND_NAME}.extract_to_property`,
                            title   : 'Extract To Property',
                            type    : vscode.CodeActionKind.RefactorExtract,
                        },
                    );
                }
            }
        }

        return commands.map((item) => this.createCommand(item));
    }

    private createCommand(cmnd): vscode.CodeAction {
        const action = new vscode.CodeAction(cmnd.title, cmnd.type);
        action.command = {
            command   : cmnd.command,
            title     : cmnd.title,
            arguments : cmnd.arguments || [],
        };

        return action;
    }

    setSymbols = throttle(async (document: vscode.TextDocument) => {
        if (document) {
            this.SYMBOLS = await symbolsAndReferences.getFileSymbols(document.uri);
        }
    }, 2000);
}
