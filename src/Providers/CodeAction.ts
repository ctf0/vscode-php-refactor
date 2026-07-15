import * as vscode from 'vscode'
import * as symbolsAndReferences from '../Symbol/SymbolsAndReferences'
import * as parser from '../Symbol/Parser'
import * as utils from '../utils'

type ArraySymbolProvider = {
    getSymbolKeyAtLine(document: vscode.TextDocument, line: number): string | undefined
}

export default class CodeAction implements vscode.CodeActionProvider {
    public constructor(private readonly arraySymbolProvider: ArraySymbolProvider) { }

    public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[] | undefined> {
        const editor = vscode.window.activeTextEditor

        if (!document || !utils.getConfig('enableCodeActions') || !editor) {
            return undefined
        }

        const {selections} = editor
        const commands: any[] = []
        const content = document.getText()
        const functionLike = parser.getFunctionLikeAtLines(content, range.start.line, range.end.line)

        if (functionLike && range.isEmpty) {
            commands.push({
                command : `${utils.PACKAGE_CMND_NAME}.toggle_function_syntax`,
                title   : functionLike.kind === 'arrowfunc' ? 'Convert To Normal Function' : 'Convert To Short Function',
                type    : vscode.CodeActionKind.RefactorRewrite,
            })
        }

        const _classSymbols = symbolsAndReferences.extractClassSymbols(content)

        // addMagicMethod
        if (_classSymbols) {
            for (const methodName of symbolsAndReferences.filterMagicSymbols(_classSymbols, utils.getConfig('magicMethods') || [])) {
                commands.push({
                    title     : `Add ${methodName}`,
                    command   : `${utils.PACKAGE_CMND_NAME}.add_magic`,
                    arguments : [methodName],
                })
            }
        }

        if (range.isEmpty === true) {
            const arrayKey = this.getCurrentArrayKey(document, range.start.line)

            if (arrayKey) {
                commands.push({
                    title     : 'Copy Array Key',
                    command   : `${utils.PACKAGE_CMND_NAME}.copy_array_key`,
                    arguments : [arrayKey],
                })
            }

            // addNewProperty
            if (parser.canAddNewPropertyAtLine(content, range.start.line)) {
                commands.push({
                    title   : 'Add New Property',
                    command : `${utils.PACKAGE_CMND_NAME}.add_new_property`,
                })
            }

            const _methodsOrFunctions = symbolsAndReferences.extractMethodOrFunctionsSymbols(content)

            if (_methodsOrFunctions && !symbolsAndReferences.hasStartOrEndIntersection(selections, _methodsOrFunctions)) {
                const activeSelection = selections[0].active

                // add_missing_function
                const methodWordRange = document.getWordRangeAtPosition(activeSelection, /(?<=(:|\$this->))\w+(?=\()/)

                if (methodWordRange) {
                    const methodName = document.getText(methodWordRange)

                    if (!_methodsOrFunctions.some((item) => item.name.name == methodName)) {
                        commands.push(
                            {
                                command : `${utils.PACKAGE_CMND_NAME}.add_missing_function`,
                                title   : 'Add Missing Method/Function Declaration',
                                type    : vscode.CodeActionKind.QuickFix,
                            },
                        )
                    }
                }

                // add_missing_prop
                const propWordRange = document.getWordRangeAtPosition(activeSelection, /(?<=(:\$|\$this->))\w+\b(?!\()/)

                if (propWordRange) {
                    const propName = document.getText(propWordRange)
                    const _props = symbolsAndReferences.extractPropSymbols(_classSymbols)

                    if (!_props || !_props.some((item) => item.name.name == propName)) {
                        commands.push(
                            {
                                command : `${utils.PACKAGE_CMND_NAME}.add_missing_prop`,
                                title   : 'Add Missing Property',
                                type    : vscode.CodeActionKind.QuickFix,
                            },
                        )
                    }
                }
            }
        } else {
            // extract_to_function
            if (selections.length == 1) {
                const txt = document.getText(selections[0]).trim()

                if (!(txt.startsWith('->') || txt.startsWith('::'))) {
                    commands.push(
                        {
                            command : `${utils.PACKAGE_CMND_NAME}.extract_to_function`,
                            title   : 'Extract To Method/Function',
                            type    : vscode.CodeActionKind.RefactorRewrite,
                        },
                        {
                            command : `${utils.PACKAGE_CMND_NAME}.extract_to_class`,
                            title   : 'Extract To New Class',
                            type    : vscode.CodeActionKind.RefactorRewrite,
                        },
                    )
                }
            }

            // extract_to_property
            if (!selections.some((item) => {
                const txt = document.getText(item).trim()

                return txt.startsWith('return') || txt.startsWith('->') || txt.startsWith('::')
            })) {
                commands.push(
                    {
                        command : `${utils.PACKAGE_CMND_NAME}.extract_to_property`,
                        title   : 'Extract To Property',
                        type    : vscode.CodeActionKind.RefactorRewrite,
                    },
                )
            }
        }

        return commands.map((item) => this.createCommand(item))
    }

    private getCurrentArrayKey(document: vscode.TextDocument, line: number): string | undefined {
        return this.arraySymbolProvider.getSymbolKeyAtLine(document, line)
    }

    private createCommand(cmnd: any): vscode.CodeAction {
        const action = new vscode.CodeAction(cmnd.title, cmnd.type)
        action.command = {
            command   : cmnd.command,
            title     : cmnd.title,
            arguments : cmnd.arguments || [],
        }

        return action
    }
}
