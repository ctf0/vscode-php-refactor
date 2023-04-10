import * as vscode from 'vscode';
import * as parser from './Symbol/Parser';
import * as symbolsAndReferences from './Symbol/SymbolsAndReferences';
import * as utils from './utils';

export default class Resolver {
    config: vscode.WorkspaceConfiguration;
    CLASS_AST: any;
    EDITOR: vscode.TextEditor;
    DEFAULT_INDENT: string;

    public constructor(config) {
        this.config = config;

        // @ts-ignore
        this.DEFAULT_INDENT = ' '.repeat(parseInt(vscode.workspace.getConfiguration('editor').get('tabSize')));
    }

    setEditorAndAST() {
        this.EDITOR = this.getEditor();
        this.CLASS_AST = parser.getClassASTFromContent(this.EDITOR.document.getText());
    }

    getEditor(): vscode.TextEditor {
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            const err = 'Error editor not available';
            utils.showMessage(err);
            throw new Error(err);
        }

        return editor;
    }

    /* New ---------------------------------------------------------------------- */
    addConstructor(): Thenable<any> {
        this.setEditorAndAST();

        if (this.CLASS_AST.kind != 'class') {
            return utils.showMessage('only classes can have constructor');
        }

        const editor = this.EDITOR;
        const { document } = editor;

        const position = parser.getClassScopeInsertLine(this.CLASS_AST);
        const isPlainClass = position.column == 0;

        const insertLine = document.lineAt(position.line);
        const indentation = insertLine.text.substring(0, insertLine.firstNonWhitespaceCharacterIndex);

        const addIndent = indentation ? '' : this.DEFAULT_INDENT;

        const snippet = `${isPlainClass ? '' : '\n'}` +
            `${indentation ? '\n' : ''}` +
            `${addIndent}\${1|public,private,protected|} function __construct($2){\n` +
            `${addIndent}${this.DEFAULT_INDENT}$0;` +
            `\n${addIndent}}\n`;

        return editor.insertSnippet(
            new vscode.SnippetString(snippet),
            new vscode.Position(position.line, position.column),
        );
    }

    addNewProperty(): Thenable<boolean> {
        this.setEditorAndAST();

        const editor = this.EDITOR;
        const { selection, document } = editor;

        let position: any;
        let prefix = '';
        let suffix = '';
        const readOnly = this.config.showReadonly ? ' readonly' : '';
        let snippet = `\${1|public,private,protected|}${readOnly} \${2:type} \$\${3:name}\${4: = \${5:\'value\'}}`;

        const activeLine = selection.active.line;
        const _const = parser.getConstructor(this.CLASS_AST);
        const insideConstructorBody = _const?.loc.start.line - 1 <= activeLine && _const?.loc.end.line - 1 >= activeLine;

        if (_const && insideConstructorBody) {
            const _propPromotions = _const.arguments;

            if (_propPromotions.length) {
                const firstArg = _propPromotions[0];
                const lastArg = _propPromotions[_propPromotions.length - 1];

                position = {
                    line: lastArg.loc.end.line - 1,
                    column: lastArg.loc.end.column,
                };

                if (firstArg !== lastArg) {
                    // args are multiline
                    if (firstArg.loc.end.line !== lastArg.loc.end.line) {
                        prefix = ',\n';
                    }
                }

                // one arg
                // or multi args on the same line
                if (firstArg === lastArg || (firstArg.loc.end.line === lastArg.loc.end.line)) {
                    prefix = ', ';
                }
            } else {
                // get insert place when no args
                const constLineText = document.getText(new vscode.Range(
                    _const.loc.start.line - 1,
                    _const.loc.start.column,
                    _const.body.loc.start.line - 1,
                    _const.body.loc.start.column,
                ));

                position = document.positionAt(_const.loc.start.offset + constLineText.indexOf('(') + 1);

                position = {
                    line: position.line,
                    column: position.character,
                };
            }
        }

        const _methods = parser.getMethods(this.CLASS_AST);
        const insideMethodBody = _methods?.find((method) => method.loc.start.line - 1 <= activeLine && method.loc.end.line - 1 >= activeLine);

        if (_methods && insideMethodBody && !insideConstructorBody) {
            snippet = '\${1:type} \$\${2:var}\${3: = \${4:\'value\'}}';

            const args = insideMethodBody?.arguments;

            if (args.length) {
                const firstArg = args[0];
                const lastArg = args[args.length - 1];

                position = {
                    line: lastArg.loc.end.line - 1,
                    column: lastArg.loc.end.column,
                };

                if (firstArg !== lastArg) {
                    // args are multiline
                    if (firstArg.loc.end.line !== lastArg.loc.end.line) {
                        prefix = ',\n';
                    }
                }

                // one arg
                // or multi args on the same line
                if (firstArg === lastArg || (firstArg.loc.end.line === lastArg.loc.end.line)) {
                    prefix = ', ';
                }
            } else {
                // get insert place when no args
                const constLineText = document.getText(new vscode.Range(
                    insideMethodBody.loc.start.line - 1,
                    insideMethodBody.loc.start.column,
                    insideMethodBody.body.loc.start.line - 1,
                    insideMethodBody.body.loc.start.column,
                ));

                position = document.positionAt(insideMethodBody.loc.start.offset + constLineText.indexOf('(') + 1);

                position = {
                    line: position.line,
                    column: position.character,
                };
            }
        }

        if (!insideConstructorBody && !insideMethodBody) {
            position = parser.getClassScopeInsertLine(this.CLASS_AST);

            prefix = position.addPrefixLine ? '\n\n' : '\n';
            suffix = position.addSuffixLine ? ';\n\n' : ';';

            if (position.column == 0) {
                prefix = this.DEFAULT_INDENT;
                suffix = position.addSuffixLine ? ';\n' : ';';
            }

            if (position.column == this.DEFAULT_INDENT.length) {
                prefix = '';
            }
        }

        snippet = `${prefix}${snippet}${suffix}`;

        return editor.insertSnippet(
            new vscode.SnippetString(snippet),
            new vscode.Position(position.line, position.column),
        );
    }

    /* Extract ------------------------------------------------------------------ */
    async extractToFunction() {
        this.setEditorAndAST();

        const editor = this.EDITOR;
        const { selections, document } = editor;

        if (selections.length > 1) {
            return utils.showMessage('extract to function doesnt work with multiple selections');
        }

        const selection = selections[0];
        const symbols = await symbolsAndReferences.getFileSymbols(document.uri);

        if (symbols) {
            const _methodsOrFunctions = symbolsAndReferences.extractMethodOrFunctionsSymbols(symbols);

            if (_methodsOrFunctions && _methodsOrFunctions.length) {
                if (symbolsAndReferences.hasStartOrEndIntersection(selections, _methodsOrFunctions)) {
                    return utils.showMessage('selection cant be at the same line of method/function start or end line');
                }

                let methodName = await vscode.window.showInputBox({
                    placeHolder: 'function name',
                });

                if (!methodName) {
                    return utils.showMessage('please enter a method/function name', false);
                }

                methodName = methodName.replace(/^\$/, '');

                if (_methodsOrFunctions.some((item) => item.name == methodName)) {
                    return utils.showMessage('method already exists');
                }

                const cursorIntersection = _methodsOrFunctions.find((item: vscode.DocumentSymbol) => item.range.intersection(selection));
                const isFunction = cursorIntersection?.kind == vscode.SymbolKind.Function;

                if (cursorIntersection) {
                    const currentTxt = document.getText(selection);
                    let activeLine = document.lineAt(cursorIntersection.range.start.line);
                    const indentation = activeLine.text.substring(0, activeLine.firstNonWhitespaceCharacterIndex);
                    let contentIndentation = '';

                    if (!indentation) {
                        activeLine = document.lineAt(selection.start.line);
                        contentIndentation = activeLine.text.substring(0, activeLine.firstNonWhitespaceCharacterIndex);
                    }

                    const methodType = isFunction ? '' : 'private ';
                    const methodContent = '\n\n' +
                        `${indentation}${methodType}function ${methodName}()\n` +
                        `${indentation}{\n` +
                        `${indentation}${indentation || contentIndentation}${currentTxt}\n` +
                        `${indentation}}`;

                    await editor.edit((edit: vscode.TextEditorEdit) => {
                        edit.insert(cursorIntersection.range.end, methodContent);
                    }, { undoStopBefore: false, undoStopAfter: false });

                    await editor.edit((edit: vscode.TextEditorEdit) => {
                        const _this = isFunction ? '' : '$this->';

                        edit.replace(selection, `${_this}${methodName}();`);
                    }, { undoStopBefore: false, undoStopAfter: false });

                    return this.addMethodDocs(document, methodName)
                }
            } else {
                return utils.showMessage('only contents of method/function can be extracted');
            }
        }
    }

    async addMethodDocs(document: vscode.TextDocument, methodName: string): Promise<unknown> {
        // @ts-ignore
        const symbols = await symbolsAndReferences.getFileSymbols(document.uri);
        // @ts-ignore
        const _methodsOrFunctions = symbolsAndReferences.extractMethodOrFunctionsSymbols(symbols);
        // @ts-ignore
        const _methodRange = _methodsOrFunctions.find((symbol) => symbol.name == methodName)

        return this.insertPhpDocs(document, _methodRange?.range)
    }

    async extractToProperty() {
        const editor = this.getEditor();
        const { selections, document } = editor;

        const methods = parser.getMethodsOrFunctions(document.getText());
        const symbols = await symbolsAndReferences.getFileSymbols(editor.document.uri);

        if (symbols) {
            const _methodsOrFunctions = symbolsAndReferences.extractMethodOrFunctionsSymbols(symbols);

            if (_methodsOrFunctions && _methodsOrFunctions.length) {
                if (symbolsAndReferences.hasStartOrEndIntersection(selections, _methodsOrFunctions)) {
                    return utils.showMessage('selection cant be at the same line of method/function start or end line');
                }

                let propertyName: any = await vscode.window.showInputBox({
                    placeHolder: 'property name',
                });

                if (!propertyName) {
                    return utils.showMessage('please enter a property name', false);
                }

                propertyName = propertyName.replace(/^\$/, '');

                const firstSelection = selections[0];
                const cursorIntersection: any = _methodsOrFunctions.find((item: vscode.DocumentSymbol) => item.range.intersection(firstSelection));

                if (cursorIntersection) {
                    const selectionTxt = document.getText(firstSelection);
                    const isEndOfStatement = selectionTxt.endsWith(';');

                    propertyName = `\$${propertyName}`;
                    const currentTxt = `${propertyName} = ${selectionTxt}${isEndOfStatement ? '' : ';'}`;

                    // replace selections
                    for (const selection of selections) {
                        await editor.edit((edit: vscode.TextEditorEdit) => {
                            edit.replace(selection, `${propertyName}${isEndOfStatement ? ';' : ''}`);
                        }, { undoStopBefore: false, undoStopAfter: false });
                    }

                    // add property
                    const currentMethod = methods.find((method) => cursorIntersection.name == method.name.name);
                    const _currentMethodStart = currentMethod.body.children[0].loc.start;
                    const _insertLocation = parser.getRangeFromLoc(_currentMethodStart, _currentMethodStart);

                    const methodBodyLine = document.lineAt(_currentMethodStart.line - 1);
                    const indentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex);
                    const propertyContent = `${currentTxt}\n\n${indentation}`;

                    return editor.edit((edit: vscode.TextEditorEdit) => {
                        edit.insert(_insertLocation.end, propertyContent);
                    }, { undoStopBefore: false, undoStopAfter: false });
                }
            } else {
                return utils.showMessage('only contents of method/function can be extracted');
            }
        }
    }

    /* Missing ------------------------------------------------------------------ */
    async addMissingFunction() {
        this.setEditorAndAST();

        const editor = this.EDITOR;
        const { selections, document } = editor;

        if (selections.length > 1) {
            return utils.showMessage('add missing function doesnt work with multiple selections');
        }

        const selection = selections[0];
        const symbols = await symbolsAndReferences.getFileSymbols(document.uri);

        if (symbols) {
            const _methodsOrFunctions = symbolsAndReferences.extractMethodOrFunctionsSymbols(symbols);

            if (_methodsOrFunctions && _methodsOrFunctions.length) {
                const wordRange = document.getWordRangeAtPosition(selection.active, /(?<=(self::|\$this->))\w+\(.*?\)?/);

                if (wordRange) {
                    let methodAndParams = document.getText(wordRange);
                    methodAndParams = methodAndParams.endsWith(')') ? methodAndParams : `${methodAndParams})`;

                    const cursorIntersection = _methodsOrFunctions.find((item: vscode.DocumentSymbol) => item.range.intersection(selection));
                    const isFunction = cursorIntersection?.kind == vscode.SymbolKind.Function;

                    if (cursorIntersection) {
                        let activeLine = document.lineAt(cursorIntersection.range.start.line);
                        let indentation = activeLine.text.substring(0, activeLine.firstNonWhitespaceCharacterIndex);

                        if (!indentation) {
                            activeLine = document.lineAt(selection.start.line);
                            indentation = activeLine.text.substring(0, activeLine.firstNonWhitespaceCharacterIndex);
                        }

                        const methodType = isFunction ? '' : 'private ';
                        const methodContent = '\n\n' +
                            `${indentation}${methodType}function ${methodAndParams}\n` +
                            `${indentation}{\n` +
                            `${indentation}${indentation}throw new \\Exception(__FUNCTION__ . ' not implemented.');\n` +
                            `${indentation}}`;

                        return editor.edit((edit: vscode.TextEditorEdit) => {
                            edit.insert(cursorIntersection.range.end, methodContent);
                        }, { undoStopBefore: false, undoStopAfter: false });
                    }
                }
            }
        }
    }

    addMissingProperty() {
        this.setEditorAndAST();

        const editor = this.EDITOR;
        const { selections, document } = editor;

        if (selections.length > 1) {
            return utils.showMessage('add missing property doesnt work with multiple selections');
        }

        const selection = selections[0];

        if (this.CLASS_AST) {
            const wordRange = document.getWordRangeAtPosition(selection.active, /(?<=(:\$|\$this->))\w+\b(?!\()/);

            if (wordRange) {
                const propName = document.getText(wordRange);
                const readOnly = this.config.showReadonly ? ' readonly' : '';

                let position: any = parser.getClassScopeInsertLine(this.CLASS_AST);
                let prefix = position.addPrefixLine ? '\n\n' : '\n';
                let suffix = position.addSuffixLine ? ';\n\n' : ';';
                let snippet = `\${1|public,private,protected|}${readOnly} \${2:type} \\$${propName}\${4: = \${5:\'value\'}}`;

                if (position.column == 0) {
                    prefix = this.DEFAULT_INDENT;
                    suffix = position.addSuffixLine ? ';\n' : ';';
                }

                if (position.column == this.DEFAULT_INDENT.length) {
                    prefix = '';
                }

                snippet = `${prefix}${snippet}${suffix}`;

                return editor.insertSnippet(
                    new vscode.SnippetString(snippet),
                    new vscode.Position(position.line, position.column),
                );
            }
        }
    }

    addPhpDocs(): Promise<unknown> {
        const editor = this.getEditor()
        const { document, selection } = editor

        return this.insertPhpDocs(document, selection)
    }

    async insertPhpDocs(document: vscode.TextDocument, range: vscode.Range | undefined): Promise<unknown> {
        let _docFixs: vscode.CodeAction[] = await vscode.commands.executeCommand(
            "vscode.executeCodeActionProvider",
            document.uri,
            range,
        )

        // @ts-ignore
        let _docFix: vscode.CodeAction = _docFixs.find((fix: vscode.CodeAction) => fix.command?.command == "intelephense.phpdoc.add")

        if (_docFix) {
            // @ts-ignore
            return vscode.commands.executeCommand(_docFix.command?.command, ..._docFix.command?.arguments)
        }
    }
}
