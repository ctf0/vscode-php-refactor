import * as vscode from 'vscode'
import type {ClassAST} from '../types'
import * as utils from '../utils'
import * as parser from './Parser'

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

    getArgumentInsertPosition(document: vscode.TextDocument, functionLike: any): {
        position: {line: number; column: number}
        prefix: string
    } {
        const args = functionLike.arguments

        if (args.length) {
            const firstArg = args[0]
            const lastArg = args[args.length - 1]

            return {
                position: {
                    line: lastArg.loc.end.line - 1,
                    column: lastArg.loc.end.column,
                },
                prefix: firstArg.loc.end.line === lastArg.loc.end.line ? ', ' : ',\n',
            }
        }

        const functionText = document.getText(new vscode.Range(
            functionLike.loc.start.line - 1,
            functionLike.loc.start.column,
            functionLike.body.loc.start.line - 1,
            functionLike.body.loc.start.column,
        ))
        const position = document.positionAt(functionLike.loc.start.offset + functionText.indexOf('(') + 1)

        return {
            position: {
                line: position.line,
                column: position.character,
            },
            prefix: '',
        }
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
            const insert = this.getArgumentInsertPosition(document, _const)
            position = insert.position
            prefix = insert.prefix
        }

        const _methodsOrFunctions = parser.getMethodsOrFunctions(this.getEditor().document.getText())

        // method
        const _methods = _methodsOrFunctions.filter((item) => item.kind == 'method')
        const insideMethodBody = _methods?.find((method) => method.loc.start.line - 1 <= activeLine && method.loc.end.line - 1 >= activeLine)

        if (_methods && insideMethodBody && !insideConstructorBody) {
            snippet = '\${1:type} \$\${2:var}\${3: = \${4:\'value\'}}'
            const insert = this.getArgumentInsertPosition(document, insideMethodBody)
            position = insert.position
            prefix = insert.prefix
        }

        // function
        const _functions = _methodsOrFunctions.filter((item) => item.kind == 'function')
        const insideFunctionBody = _functions?.find((method) => method.loc.start.line - 1 <= activeLine && method.loc.end.line - 1 >= activeLine)

        if (_functions && insideFunctionBody) {
            snippet = '\${1:type} \$\${2:var}\${3: = \${4:\'value\'}}'
            const insert = this.getArgumentInsertPosition(document, insideFunctionBody)
            position = insert.position
            prefix = insert.prefix
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
            const hasReturn = parser.hasReturn(selectionTxt)
            const dependencies = parser.getVariableNames(selectionTxt)
            const methodParameters = dependencies.map((name) => {
                const argument = functionBody.arguments?.find((item) => item.name.name === name)

                if (!argument) {
                    return `$${name}`
                }

                const prefix = document.getText(parser.getRangeFromLoc(argument.loc.start, argument.name.loc.start)).trim()
                const cleanPrefix = prefix.replace(/^(public|protected|private|readonly)\s+/, '')

                return `${cleanPrefix}${cleanPrefix && !cleanPrefix.endsWith('&') ? ' ' : ''}$${name}`
            })
            const methodArguments = dependencies.map((name) => `$${name}`).join(', ')

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
            const functionHeader = document.getText(parser.getRangeFromLoc(functionBody.loc.start, functionBody.body.loc.start))
            const returnType = hasReturn ? functionHeader.match(/\)\s*:\s*(.+?)\s*$/s)?.[1] : undefined
            const returnDeclaration = returnType ? `: ${returnType}` : ''

            const methodContent = '\n\n'
              + `${indentation}${methodType}${_static}function ${methodName}(${methodParameters.join(', ')})${returnDeclaration}\n`
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

                    edit.replace(selection, `${hasReturn ? 'return ' : ''}${_this}${methodName}(${methodArguments});`)
                }, {undoStopBefore: false, undoStopAfter: false})
            }

            return
        } catch (error) {
            utils.showMessage(error.message, true)

            // console.error(error);
        }
    }

    async toggleFunctionSyntax() {
        const editor = this.getEditor()
        const {document, selection} = editor
        const functionLike = parser.getFunctionLikeAtLines(document.getText(), selection.start.line, selection.end.line)

        if (!functionLike) {
            return utils.showMessage('place the cursor inside a closure or arrow function', true)
        }

        const functionRange = parser.getRangeFromLoc(functionLike.loc.start, functionLike.loc.end)
        const functionText = document.getText(functionRange)
        const bodyOffset = functionLike.body.loc.start.offset - functionLike.loc.start.offset
        const header = functionText.slice(0, bodyOffset)
        const openingParenthesis = header.indexOf('(')
        let depth = 0
        let closingParenthesis = -1

        for (let i = openingParenthesis; i < header.length; i++) {
            if (header[i] === '(') depth++
            if (header[i] === ')' && --depth === 0) {
                closingParenthesis = i
                break
            }
        }

        if (openingParenthesis < 0 || closingParenthesis < 0) {
            return utils.showMessage('unable to read the function arguments', true)
        }

        let replacement

        if (functionLike.kind === 'arrowfunc') {
            const expression = document.getText(parser.getRangeFromLoc(functionLike.body.loc.start, functionLike.body.loc.end)).trim()
            const args = header.slice(openingParenthesis, closingParenthesis + 1)
            const returnType = header.slice(closingParenthesis + 1).replace(/=>\s*$/, '').trim()
            const line = document.lineAt(functionLike.loc.start.line - 1)
            const indentation = line.text.substring(0, line.firstNonWhitespaceCharacterIndex)
            const parameters = new Set(functionLike.arguments.map((argument) => argument.name.name))
            const superglobals = new Set(['this', 'GLOBALS', '_SERVER', '_GET', '_POST', '_FILES', '_COOKIE', '_SESSION', '_REQUEST', '_ENV', 'http_response_header', 'argc', 'argv'])
            const dependencies = new Set<string>()
            const collectVariables = (node: any): void => {
                if (!node || typeof node !== 'object') {
                    return
                }

                if (node.kind === 'variable' && !parameters.has(node.name) && !superglobals.has(node.name)) {
                    dependencies.add(`$${node.name}`)
                }

                Object.values(node).forEach(collectVariables)
            }

            collectVariables(functionLike.body)
            const useClause = dependencies.size ? ` use (${[...dependencies].join(', ')})` : ''
            replacement = `function${args}${useClause}${returnType ? ` ${returnType}` : ''} {\n`
                + `${indentation}${this.DEFAULT_INDENT}return ${expression};\n`
                + `${indentation}}`
        } else {
            const bodyChildren = functionLike.body.children || []
            const returnStatement = bodyChildren.length === 1 && bodyChildren[0].kind === 'return'

            if (!returnStatement || !bodyChildren[0].expr) {
                return utils.showMessage('only closures with one return statement can be shortened', true)
            }

            if (functionLike.uses?.some((use) => use.byref)) {
                return utils.showMessage('closures using references cannot be shortened', true)
            }

            const expression = document.getText(parser.getRangeFromLoc(
                bodyChildren[0].expr.loc.start,
                bodyChildren[0].expr.loc.end,
            )).trim()
            const args = header.slice(openingParenthesis, closingParenthesis + 1)
            const returnType = header.slice(closingParenthesis + 1)
                .replace(/use\s*\([^)]*\)/, '')
                .trim()
            replacement = `fn${args}${returnType ? ` ${returnType}` : ''} => ${expression}`
        }

        return editor.edit((edit: vscode.TextEditorEdit) => {
            edit.replace(functionRange, replacement)
        }, {undoStopBefore: true, undoStopAfter: true})
    }

    async extractToProperty() {
        let editor = this.getEditor()
        const {selections, document} = editor
        // @ts-expect-error ignore
        const topSelection = utils.sortSelections(selections)[0]
        const activeLine = topSelection.start.line

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

            editor = this.getEditor()
            let _insertLocation = editor.selection
            const _insertLocationLine = _insertLocation.active.line
            const scope = this.getIntersectedScope(functionBody, topSelection.start.line, topSelection.end.line)

            let methodBodyLine
            let propertyContent
            let indentation

            if (scope) {
                const scopeBodyStart = scope.body.children?.[0]?.loc.start || scope.body.loc.end
                // @ts-expect-error ignore
                _insertLocation = parser.getRangeFromLoc(
                    {...scopeBodyStart, column: 0},
                    {...scopeBodyStart, column: 0},
                )
                methodBodyLine = document.lineAt(scopeBodyStart.line - 1)
                indentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex)
                propertyContent = `${indentation}${extractionTxt}${extractionTxt.endsWith('\n') ? '' : '\n'}`
            } else if (parser.hasIntersection(functionBody, _insertLocationLine)) {
                // add property
                editor.selection = topSelection
                await vscode.commands.executeCommand('cursorMove', {
                    to: 'prevBlankLine',
                })

                editor = this.getEditor()
                _insertLocation = editor.selection
                const insertLocationLine = _insertLocation.active.line
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

            const sortedSelections = utils.sortSelections(selections).reverse()
            const edited = await editor.edit((edit: vscode.TextEditorEdit) => {
                for (const selection of sortedSelections) {
                    edit.replace(selection, `${propertyName}${isEndOfStatement ? ';' : ''}`)
                }

                edit.insert(_insertLocation.end, propertyContent)
            }, {undoStopBefore: true, undoStopAfter: true})

            const cursorPosition = _insertLocation.start.translate(0, indentation.length)
            editor.selection = new vscode.Selection(cursorPosition, cursorPosition)
            return edited
        } catch (error) {
            utils.showMessage(error.message, true)

            // console.error(error);
        }
    }

    getIntersectedScope(node, startLine: number, endLine: number): any {
        let intersectedScope

        const visit = (value: any): void => {
            if (!value || typeof value !== 'object') {
                return
            }

            if (value.kind && value.loc) {
                const containsSelection = value.loc.start.line - 1 <= startLine
                    && value.loc.end.line - 1 >= endLine

                if (containsSelection && value.kind === 'block' && value !== node.body) {
                    intersectedScope = {body: value}
                }
            }

            Object.values(value).forEach(visit)
        }

        visit(node)
        return intersectedScope
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
