import * as vscode from 'vscode'
import type {ClassAST} from '../types'
import * as utils from '../utils'
import * as parser from './Parser'
import * as symbolsAndReferences from './SymbolsAndReferences'

export default class Resolver {
    config: vscode.WorkspaceConfiguration
    CLASS_AST: ClassAST | null = null
    EDITOR: vscode.TextEditor | null = null
    DEFAULT_INDENT: string

    public constructor(config: vscode.WorkspaceConfiguration) {
        this.config = config

        const tabSize = vscode.workspace.getConfiguration('editor').get('tabSize') as number
        this.DEFAULT_INDENT = ' '.repeat(tabSize)
    }

    setEditorAndAST(): void {
        this.EDITOR = this.getEditor()
        this.CLASS_AST = parser.getClassASTFromContent(this.EDITOR.document.getText())
    }

    getEditor(): vscode.TextEditor {
        const editor = vscode.window.activeTextEditor

        if (!editor) {
            const err = 'Error editor not available'
            utils.showMessage(err, true)
            throw new Error(err)
        }

        return editor
    }

    /* New ---------------------------------------------------------------------- */
    addMagicMethod(methodName: string): Thenable<boolean> | undefined {
        this.setEditorAndAST()

        if (!this.CLASS_AST || this.CLASS_AST.kind !== 'class') {
            utils.showMessage(`only classes can have ${methodName}`, true)
            return
        }

        const editor = this.EDITOR

        if (!editor) {
            return
        }

        const {document} = editor

        const position = parser.getClassScopeInsertLine(this.CLASS_AST)
        const insertLine = document.lineAt(position.line)
        const indentation = insertLine.text.substring(0, insertLine.firstNonWhitespaceCharacterIndex)

        const addIndent = indentation ? '' : this.DEFAULT_INDENT

        const snippet = `${position.addPrefixLine ? '\n\n' : ''}`
          + `${addIndent}\${1|public,private,protected|} function ${methodName}($2){\n`
          + `${addIndent}${this.DEFAULT_INDENT}$0;\n`
          + `${addIndent}}\n${position.addSuffixLine ? '\n' : ''}`

        return editor.insertSnippet(
            new vscode.SnippetString(snippet),
            new vscode.Position(position.line, position.column),
        )
    }

    addNewProperty(): Thenable<any> | undefined {
        this.setEditorAndAST()

        const editor = this.EDITOR
        const {selection, document} = editor

        let position: any
        let prefix = ''
        let suffix = ''
        const readOnly = this.config.showReadonly ? ' readonly' : ''
        let snippet = `\${1|public,private,protected|}${readOnly} \${2:type} \$\${3:name}\${4: = \${5:'value'}}`

        const activeLine = selection.active.line

        // constructor
        const _const = parser.getConstructor(this.CLASS_AST)
        const insideConstructorBody = _const?.loc.start.line - 1 <= activeLine && _const?.loc.end.line - 1 >= activeLine

        if (_const && insideConstructorBody) {
            const _propPromotions = _const.arguments

            if (_propPromotions.length) {
                const firstArg = _propPromotions[0]
                const lastArg = _propPromotions[_propPromotions.length - 1]

                position = {
                    line: lastArg.loc.end.line - 1,
                    column: lastArg.loc.end.column,
                }

                // args are multiline
                if (firstArg !== lastArg && firstArg.loc.end.line !== lastArg.loc.end.line) {
                    prefix = ',\n'
                }

                // one arg
                // or multi args on the same line
                if (firstArg === lastArg || (firstArg.loc.end.line === lastArg.loc.end.line)) {
                    prefix = ', '
                }
            } else {
                // get insert place when no args
                const constLineText = document.getText(new vscode.Range(
                    _const.loc.start.line - 1,
                    _const.loc.start.column,
                    _const.body.loc.start.line - 1,
                    _const.body.loc.start.column,
                ))

                position = document.positionAt(_const.loc.start.offset + constLineText.indexOf('(') + 1)

                position = {
                    line: position.line,
                    column: position.character,
                }
            }
        }

        const _methodsOrFunctions = parser.getMethodsOrFunctions(this.getEditor().document.getText())

        // method
        const _methods = _methodsOrFunctions.filter((item) => item.kind == 'method')
        const insideMethodBody = _methods?.find((method) => method.loc.start.line - 1 <= activeLine && method.loc.end.line - 1 >= activeLine)

        if (_methods && insideMethodBody && !insideConstructorBody) {
            snippet = '\${1:type} \$\${2:var}\${3: = \${4:\'value\'}}'

            const args = insideMethodBody?.arguments

            if (args.length) {
                const firstArg = args[0]
                const lastArg = args[args.length - 1]

                position = {
                    line: lastArg.loc.end.line - 1,
                    column: lastArg.loc.end.column,
                }

                // args are multiline
                if (firstArg !== lastArg && firstArg.loc.end.line !== lastArg.loc.end.line) {
                    prefix = ',\n'
                }

                // one arg
                // or multi args on the same line
                if (firstArg === lastArg || (firstArg.loc.end.line === lastArg.loc.end.line)) {
                    prefix = ', '
                }
            } else {
                // get insert place when no args
                const constLineText = document.getText(new vscode.Range(
                    insideMethodBody.loc.start.line - 1,
                    insideMethodBody.loc.start.column,
                    insideMethodBody.body.loc.start.line - 1,
                    insideMethodBody.body.loc.start.column,
                ))

                position = document.positionAt(insideMethodBody.loc.start.offset + constLineText.indexOf('(') + 1)

                position = {
                    line: position.line,
                    column: position.character,
                }
            }
        }

        // function
        const _functions = _methodsOrFunctions.filter((item) => item.kind == 'function')
        const insideFunctionBody = _functions?.find((method) => method.loc.start.line - 1 <= activeLine && method.loc.end.line - 1 >= activeLine)

        if (_functions && insideFunctionBody) {
            snippet = '\${1:type} \$\${2:var}\${3: = \${4:\'value\'}}'
            const args = insideFunctionBody?.arguments

            if (args.length) {
                const firstArg = args[0]
                const lastArg = args[args.length - 1]

                position = {
                    line: lastArg.loc.end.line - 1,
                    column: lastArg.loc.end.column,
                }

                // args are multiline
                if (firstArg !== lastArg && firstArg.loc.end.line !== lastArg.loc.end.line) {
                    prefix = ',\n'
                }

                // one arg
                // or multi args on the same line
                if (firstArg === lastArg || (firstArg.loc.end.line === lastArg.loc.end.line)) {
                    prefix = ', '
                }
            } else {
                // get insert place when no args
                const constLineText = document.getText(new vscode.Range(
                    insideFunctionBody.loc.start.line - 1,
                    insideFunctionBody.loc.start.column,
                    insideFunctionBody.body.loc.start.line - 1,
                    insideFunctionBody.body.loc.start.column,
                ))

                position = document.positionAt(insideFunctionBody.loc.start.offset + constLineText.indexOf('(') + 1)

                position = {
                    line: position.line,
                    column: position.character,
                }
            }
        }

        if (!insideConstructorBody && !insideMethodBody && !insideFunctionBody) {
            if (this.CLASS_AST) {
                try {
                    position = parser.getClassScopeInsertLine(this.CLASS_AST)

                    prefix = position.addPrefixLine ? '\n\n' : '\n'
                    suffix = position.addSuffixLine ? ';\n\n' : ';'

                    if (position.column == 0) {
                        prefix = this.DEFAULT_INDENT
                        suffix = position.addSuffixLine ? ';\n' : ';'
                    }

                    if (position.column == this.DEFAULT_INDENT.length) {
                        prefix = ''
                    }
                } catch (error) {
                    // console.error(error);
                }
            } else {
                snippet = '\$\${2:var}\${3: = \${4:\'value\'}}'
                suffix = `;${this.getEditor().document.lineAt(activeLine).isEmptyOrWhitespace ? '' : '\n'}`
                position = {
                    line: selection.active.line,
                    column: selection.active.character,
                }
            }
        }

        snippet = `${prefix}${snippet}${suffix}`

        if (position) {
            return editor.insertSnippet(
                new vscode.SnippetString(snippet),
                new vscode.Position(position.line, position.column),
            )
        }
    }

    /* Extract ------------------------------------------------------------------ */
    async extractToFunction(replace = true) {
        const editor = this.getEditor()
        const {selections, selection, document} = editor
        const activeLine = selection.active.line

        if (selections.length > 1) {
            return utils.showMessage('extract to function doesnt work with multiple selections', true)
        }

        try {
            const _methodsOrFunctions = parser.getMethodsOrFunctions(editor.document.getText())
            const functionBody = this.getIntersectedMethodOrFunction(_methodsOrFunctions, activeLine)

            this.checkForStartOrEndIntersection(functionBody, selection)

            const selectionTxt = this.checkStartWithChar(document, selection)

            let methodName: any = await vscode.window.showInputBox({
                placeHolder: 'function/method name',
            })

            if (!methodName) {
                return utils.showMessage('please enter a method/function name')
            }

            methodName = methodName.replace(/^\$/, '')

            if (_methodsOrFunctions.some((item) => item.name.name == methodName)) {
                return utils.showMessage('method already exists')
            }

            const isFunction = functionBody.kind == 'function'
            const isStatic = functionBody.isStatic == true

            let methodBodyLine = document.lineAt(functionBody.loc.start.line - 1)
            const indentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex)
            let contentIndentation = ''

            if (!indentation) {
                methodBodyLine = document.lineAt(selection.start.line)
                contentIndentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex)
            }

            const methodType = isFunction ? '' : 'private '
            const _static = isStatic ? 'static ' : ''

            const methodContent = '\n\n'
              + `${indentation}${methodType}${_static}function ${methodName}()\n`
              + `${indentation}{\n`
              + `${indentation}${indentation || contentIndentation}${selectionTxt}\n`
              + `${indentation}}`

            // add method
            await editor.edit((edit: vscode.TextEditorEdit) => {
                edit.insert(
                    parser.getRangeFromLoc(functionBody.loc.end, functionBody.loc.end).end,
                    methodContent,
                )
            }, {undoStopBefore: false, undoStopAfter: false})

            // replace selections
            if (replace) {
                await editor.edit((edit: vscode.TextEditorEdit) => {
                    const _this = isFunction
                        ? ''
                        : (isStatic ? 'self::' : '$this->')

                    edit.replace(selection, `${_this}${methodName}();`)
                }, {undoStopBefore: false, undoStopAfter: false})
            }

            return this.addMethodDocs(document, methodName)
        } catch (error) {
            utils.showMessage(error.message, true)

            // console.error(error);
        }
    }

    async copyToFunction() {
        await this.extractToFunction(false)
    }

    async addMethodDocs(document: vscode.TextDocument, methodName: string): Promise<unknown> {
        const symbols = await symbolsAndReferences.getFileSymbols(document.uri)
        // @ts-expect-error ignore
        const _methodsOrFunctions = symbolsAndReferences.extractMethodOrFunctionsSymbols(symbols)
        const _methodRange = _methodsOrFunctions?.find((symbol) => symbol.name == methodName)

        return this.insertPhpDocs(document, _methodRange?.range)
    }

    async extractToProperty() {
        let editor = this.getEditor()
        const {selections, document} = editor
        // @ts-expect-error ignore
        const topSelection = utils.sortSelections(selections)[0]
        const activeLine = topSelection.active.line

        try {
            const _methodsOrFunctions = parser.getMethodsOrFunctions(document.getText())
            const functionBody = this.getIntersectedMethodOrFunction(_methodsOrFunctions, activeLine)

            this.checkForStartOrEndIntersection(functionBody, topSelection)

            const selectionTxt = this.checkStartWithChar(document, topSelection)

            let propertyName: any = await vscode.window.showInputBox({
                placeHolder: 'property name',
            })

            if (!propertyName) {
                return utils.showMessage('please enter a property name')
            }

            propertyName = propertyName.replace(/^\$/, '')
            propertyName = `\$${propertyName}`

            const isEndOfStatement = selectionTxt.endsWith(';')
            const extractionTxt = `${propertyName} = ${selectionTxt}${isEndOfStatement ? '' : ';\n'}`

            // replace selections
            for (const selection of utils.sortSelections(selections).reverse()) {
                await editor.edit((edit: vscode.TextEditorEdit) => {
                    edit.replace(selection, `${propertyName}${isEndOfStatement ? ';' : ''}`)
                }, {undoStopBefore: false, undoStopAfter: false})
            }

            editor.selection = topSelection

            // add property
            await vscode.commands.executeCommand('cursorMove', {
                to: 'prevBlankLine',
            })

            editor = this.getEditor()
            let _insertLocation = editor.selection
            const _insertLocationLine = _insertLocation.active.line

            let methodBodyLine
            let propertyContent
            let indentation

            if (parser.hasIntersection(functionBody, _insertLocationLine)) {
                methodBodyLine = document.lineAt(_insertLocationLine + 1)
                indentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex)
                propertyContent = `${indentation}${extractionTxt}`
            } else {
                const _currentMethodStart = functionBody.body.children[0].loc.start
                // @ts-expect-error ignore
                _insertLocation = parser.getRangeFromLoc(_currentMethodStart, _currentMethodStart)
                methodBodyLine = document.lineAt(_currentMethodStart.line - 1)
                indentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex)
                propertyContent = `${extractionTxt}\n${indentation}`
                editor.selection = topSelection
            }

            return editor.edit(async(edit: vscode.TextEditorEdit) => {
                edit.insert(_insertLocation.end, propertyContent)

                if (propertyContent.endsWith('\n')) {
                    await vscode.commands.executeCommand('cursorMove', {
                        to: 'up',
                    })
                }
            }, {undoStopBefore: false, undoStopAfter: false})
        } catch (error) {
            utils.showMessage(error.message, true)

            // console.error(error);
        }
    }

    async extractToClass() {
        const editor = this.getEditor()
        const {selections, selection, document} = editor
        const activeLine = selection.active.line

        if (selections.length > 1) {
            return utils.showMessage('extract to class doesnt work with multiple selections', true)
        }

        try {
            const _methodsOrFunctions = parser.getMethodsOrFunctions(document.getText())
            const functionBody = this.getIntersectedMethodOrFunction(_methodsOrFunctions, activeLine)

            this.checkForStartOrEndIntersection(functionBody, selection)

            const selectionTxt = this.checkStartWithChar(document, selection)

            // Show directory picker
            const selectedDirectory = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Directory',
                title: 'Select directory for new class',
                defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            })

            if (!selectedDirectory || selectedDirectory.length === 0) {
                return utils.showMessage('please select a directory')
            }

            const targetDirectory = selectedDirectory[0].fsPath

            // Show input for class name
            const className: any = await vscode.window.showInputBox({
                placeHolder: 'Class name (e.g., MyNewClass)',
                validateInput: (value: string) => {
                    if (!value || value.trim().length === 0) {
                        return 'Class name cannot be empty'
                    }

                    if (!/^[A-Z][a-zA-Z0-9_]*$/.test(value.trim())) {
                        return 'Class name must start with uppercase letter and contain only letters, numbers, and underscores'
                    }

                    return null
                },
            })

            if (!className) {
                return utils.showMessage('please enter a class name')
            }

            // Create the new file path
            const newFilePath = `${targetDirectory}/${className}.php`

            // Check if file already exists
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(newFilePath))
                return utils.showMessage('file already exists', true)
            } catch {
                // File doesn't exist, which is what we want
            }

            // Get namespace for the new file
            const namespace = await utils.getNamespaceFromPath(newFilePath)
            const namespaceDeclaration = namespace ? `${namespace}\n\n` : ''

            // Check if the selection covers a complete method by comparing selection bounds with method bounds
            const selectedMethod = this.findCompleteMethodInSelection(selection, _methodsOrFunctions)

            let classContent: string
            let methodName: string
            let replacementText: string

            if (selectedMethod) {
                // Extract the complete method
                methodName = selectedMethod.name.name
                const isStatic = selectedMethod.isStatic === true
                const methodParameters = this.generateMethodCallParameters(selectedMethod.arguments || [])

                // Use the selected text as-is since it's a complete method
                classContent = `<?php\n\n${namespaceDeclaration}class ${className}\n{\n    ${selectionTxt.trim()}\n}\n`

                // Replace with class instantiation and method call
                if (namespace) {
                    const namespaceParts = utils.getFQNOnly(namespace)?.split('\\') || []
                    const shortClassName = namespaceParts.length > 0 ? `\\${namespaceParts.join('\\')}\\${className}` : className
                    replacementText = isStatic
                        ? `${shortClassName}::${methodName}(${methodParameters});`
                        : `(new ${shortClassName}())->${methodName}(${methodParameters});`
                } else {
                    replacementText = isStatic
                        ? `${className}::${methodName}(${methodParameters});`
                        : `(new ${className}())->${methodName}(${methodParameters});`
                }
            } else {
                // Extract partial code into a new method
                methodName = 'extractedMethod'
                classContent = `<?php\n\n${namespaceDeclaration}class ${className}\n{\n    public function ${methodName}()\n    {\n        ${selectionTxt.split('\n').join('\n        ')}\n    }\n}\n`

                if (namespace) {
                    const namespaceParts = utils.getFQNOnly(namespace)?.split('\\') || []
                    const shortClassName = namespaceParts.length > 0 ? `\\${namespaceParts.join('\\')}\\${className}` : className
                    replacementText = `(new ${shortClassName}())->${methodName}();`
                } else {
                    replacementText = `(new ${className}())->${methodName}();`
                }
            }

            // Create the new file
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(newFilePath),
                Buffer.from(classContent),
            )

            // Replace the selection with class instantiation and method call
            await editor.edit((edit: vscode.TextEditorEdit) => {
                edit.replace(selection, replacementText)
            }, {undoStopBefore: false, undoStopAfter: false})

            // Open the new file
            const newDocument = await vscode.workspace.openTextDocument(newFilePath)
            await vscode.window.showTextDocument(newDocument)

            utils.showMessage(`Class ${className} created successfully`)
        } catch (error: any) {
            utils.showMessage(error.message, true)
            // console.error(error);
        }
    }

    findCompleteMethodInSelection(selection: vscode.Selection, methodsOrFunctions: any[]): any | null {
        // Check if the selection exactly matches a method/function boundaries
        for (const method of methodsOrFunctions) {
            const methodStartLine = method.loc.start.line - 1
            const methodEndLine = method.loc.end.line - 1

            // Check if selection start and end match the method boundaries (with some tolerance for whitespace)
            if (selection.start.line >= methodStartLine - 1
              && selection.start.line <= methodStartLine + 1
              && selection.end.line >= methodEndLine - 1
              && selection.end.line <= methodEndLine + 1) {
                return method
            }
        }

        return null
    }

    generateMethodCallParameters(methodArguments: any[]): string {
        if (!methodArguments || methodArguments.length === 0) {
            return ''
        }

        return methodArguments.map((arg, index) => {
            let paramName = (arg.name && arg.name.name) || `param${index + 1}`

            // Ensure paramName is a string
            if (typeof paramName !== 'string') {
                paramName = `param${index + 1}`
            }

            // Remove $ prefix if it exists for cleaner placeholder
            if (paramName.startsWith('$')) {
                paramName = paramName.substring(1)
            }

            // Generate placeholder based on parameter type and default value
            if (arg.value) {
                // Has default value, make it optional with a meaningful placeholder
                if (arg.type) {
                    return `/* ${arg.type} */ $${paramName}`
                }

                return `$${paramName}`
            } else {
                // Required parameter
                if (arg.type && arg.type.name) {
                    // Has type hint
                    const typeName = arg.type.name

                    switch (typeName.toLowerCase()) {
                        case 'string':
                            return `'${paramName}'`
                        case 'int':
                        case 'integer':
                            return '0'
                        case 'bool':
                        case 'boolean':
                            return 'false'
                        case 'array':
                            return '[]'
                        case 'float':
                        case 'double':
                            return '0.0'
                        default:
                            return `$${paramName}`
                    }
                } else {
                    // No type hint, use variable placeholder
                    return `$${paramName}`
                }
            }
        }).join(', ')
    }

    /* Missing ------------------------------------------------------------------ */
    async addMissingMethod() {
        const editor = this.getEditor()
        const {selections, selection, document} = editor
        const activeLine = selection.active.line

        if (selections.length > 1) {
            return utils.showMessage('add missing function doesnt work with multiple selections', true)
        }

        try {
            const _methodsOrFunctions = parser.getMethodsOrFunctions(editor.document.getText())
            const functionBody = this.getIntersectedMethodOrFunction(_methodsOrFunctions, activeLine)

            const isFunction = functionBody.kind == 'function'
            const isStatic = functionBody.isStatic == true

            const wordRange = document.getWordRangeAtPosition(selection.active, /(?<=(self::|\$this->))\w+\(.*?\)?/)

            if (wordRange) {
                let methodAndParams = document.getText(wordRange)
                methodAndParams = methodAndParams.endsWith(')') ? methodAndParams : `${methodAndParams})`

                let methodBodyLine = document.lineAt(functionBody.loc.start.line - 1)
                let indentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex)

                if (!indentation) {
                    methodBodyLine = document.lineAt(selection.start.line)
                    indentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex)
                }

                const methodType = isFunction ? '' : 'private '
                const _static = isStatic ? 'static ' : ''

                const methodContent = '\n\n'
                  + `${indentation}${methodType}${_static}function ${methodAndParams}\n`
                  + `${indentation}{\n`
                  + `${indentation}${indentation}throw new \\Exception(__FUNCTION__ . ' not implemented.');\n`
                  + `${indentation}}`

                return editor.edit((edit: vscode.TextEditorEdit) => {
                    edit.insert(
                        parser.getRangeFromLoc(functionBody.loc.end, functionBody.loc.end).end,
                        methodContent,
                    )
                }, {undoStopBefore: false, undoStopAfter: false})
            }
        } catch (error) {
            utils.showMessage(error.message, true)

            // console.error(error);
        }
    }

    addMethodMissingProperty() {
        this.setEditorAndAST()

        const editor = this.EDITOR
        const {selections, selection, document} = editor

        if (selections.length > 1) {
            return utils.showMessage('add missing property doesnt work with multiple selections', true)
        }

        if (this.CLASS_AST) {
            const wordRange = document.getWordRangeAtPosition(selection.active, /(?<=(:\$|\$this->))\w+\b(?!\()/)

            if (wordRange) {
                const propName = document.getText(wordRange)
                const readOnly = this.config.showReadonly ? ' readonly' : ''

                const position: any = parser.getClassScopeInsertLine(this.CLASS_AST)
                let prefix = position.addPrefixLine ? '\n\n' : '\n'
                let suffix = position.addSuffixLine ? ';\n\n' : ';'
                let snippet = `\${1|public,private,protected|}${readOnly} \${2:type} \\$${propName}\${4: = \${5:'value'}}`

                if (position.column == 0) {
                    prefix = this.DEFAULT_INDENT
                    suffix = position.addSuffixLine ? ';\n' : ';'
                }

                if (position.column == this.DEFAULT_INDENT.length) {
                    prefix = ''
                }

                snippet = `${prefix}${snippet}${suffix}`

                return editor.insertSnippet(
                    new vscode.SnippetString(snippet),
                    new vscode.Position(position.line, position.column),
                )
            }
        }
    }

    addPhpDocs(): Promise<unknown> {
        const editor = this.getEditor()
        const {document, selection} = editor

        return this.insertPhpDocs(document, selection)
    }

    async insertPhpDocs(document: vscode.TextDocument, range: vscode.Range | undefined): Promise<unknown> {
        const _docFixs: vscode.CodeAction[] = await vscode.commands.executeCommand(
            'vscode.executeCodeActionProvider',
            document.uri,
            range,
        )

        const _docFix: vscode.CodeAction | undefined = _docFixs.find((fix: vscode.CodeAction) => fix.command?.command == 'intelephense.phpdoc.add')

        if (_docFix) {
            // @ts-expect-error ignore
            return vscode.commands.executeCommand(_docFix.command?.command, ..._docFix.command?.arguments)
        }
    }

    checkForStartOrEndIntersection(insideFunctionBody, firstSelection) {
        if (parser.hasStartOrEndIntersection(insideFunctionBody, firstSelection)) {
            throw new Error('selection cant be at the same line of method/function start or end line')
        }
    }

    checkStartWithChar(document, firstSelection) {
        const selectionTxt = document.getText(firstSelection)

        if (selectionTxt.startsWith('->') || selectionTxt.startsWith('::')) {
            throw new Error('selection that starts with "-> or ::" cant be extracted')
        }

        return selectionTxt
    }

    getIntersectedMethodOrFunction(_methodsOrFunctions, activeLine) {
        const intersectedFunctionBody = _methodsOrFunctions?.find((method) => parser.hasIntersection(method, activeLine))

        if (!intersectedFunctionBody) {
            throw new Error('only contents of method/function can be extracted')
        }

        return intersectedFunctionBody
    }
}
