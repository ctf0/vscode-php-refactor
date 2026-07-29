import * as vscode from 'vscode'
import type {ClassAST} from '../types'
import * as utils from '../utils'
import * as parser from './Parser'

export default class Resolver {
    config         : vscode.WorkspaceConfiguration
    CLASS_AST      : ClassAST | null = null
    EDITOR         : vscode.TextEditor | null = null
    DEFAULT_INDENT : string

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

        const {document} = this.EDITOR

        const position = parser.getClassScopeInsertLine(this.CLASS_AST)
        const insertLine = document.lineAt(position.line)
        const indentation = insertLine.text.substring(0, insertLine.firstNonWhitespaceCharacterIndex)

        const addIndent = indentation ? '' : this.DEFAULT_INDENT

        const snippet = `${position.addPrefixLine ? '\n\n' : ''}`
          + `${addIndent}\${1|public,private,protected|} function ${methodName}($2){\n`
          + `${addIndent}${this.DEFAULT_INDENT}$0;\n`
          + `${addIndent}}\n${position.addSuffixLine ? '\n' : ''}`

        return this.EDITOR.insertSnippet(
            new vscode.SnippetString(snippet),
            new vscode.Position(position.line, position.column),
        )
    }

    getArgumentInsertPosition(document: vscode.TextDocument, functionLike: any): {
        position : {line: number, column: number}
        prefix   : string
    } {
        const args = functionLike.arguments

        if (args.length) {
            const firstArg = args[0]
            const lastArg = args[args.length - 1]

            return {
                position : {
                    line   : lastArg.loc.end.line - 1,
                    column : lastArg.loc.end.column,
                },
                prefix : firstArg.loc.end.line === lastArg.loc.end.line ? ', ' : ',\n',
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
            position : {
                line   : position.line,
                column : position.character,
            },
            prefix : '',
        }
    }

    private resolveClassScopeIndentation(position: {addPrefixLine: boolean, addSuffixLine: boolean, column: number}): {prefix: string, suffix: string} {
        let prefix = position.addPrefixLine ? '\n\n' : '\n'
        let suffix = position.addSuffixLine ? ';\n\n' : ';'

        if (position.column == 0) {
            prefix = this.DEFAULT_INDENT
            suffix = position.addSuffixLine ? ';\n' : ';'
        }

        if (position.column == this.DEFAULT_INDENT.length) {
            prefix = ''
        }

        return {prefix, suffix}
    }

    private resolveFreeFormPosition(selection: vscode.Selection, activeLine: number): {
        snippet : string, position : {line: number, column: number}, suffix : string
    } {
        return {
            snippet  : '\$\${2:var}\${3: = \${4:\'value\'}}',
            suffix   : `;${this.getEditor().document.lineAt(activeLine).isEmptyOrWhitespace ? '' : '\n'}`,
            position : {
                line   : selection.active.line,
                column : selection.active.character,
            },
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
        let snippet = `\${1|public,private,protected,abstract|}${readOnly} \${2:type} \$\${3:name}\${4: = \${5:'value'}}`

        const activeLine = selection.active.line

        const constructorMethod = parser.getConstructor(this.CLASS_AST)
        const insideConstructorBody = constructorMethod?.loc.start.line - 1 <= activeLine && constructorMethod?.loc.end.line - 1 >= activeLine

        if (constructorMethod && insideConstructorBody) {
            const insert = this.getArgumentInsertPosition(document, constructorMethod)
            position = insert.position
            prefix = insert.prefix
        }

        const methodsOrFunctions = parser.getMethodsOrFunctions(this.getEditor().document.getText())

        const methods = methodsOrFunctions.filter((item) => item.kind == 'method')
        const insideMethodBody = methods?.find((method) => method.loc.start.line - 1 <= activeLine && method.loc.end.line - 1 >= activeLine)

        if (methods && insideMethodBody && !insideConstructorBody) {
            snippet = '\${1:type} \$\${2:var}\${3: = \${4:\'value\'}}'
            const insert = this.getArgumentInsertPosition(document, insideMethodBody)
            position = insert.position
            prefix = insert.prefix
        }

        const functions = methodsOrFunctions.filter((item) => item.kind == 'function')
        const insideFunctionBody = functions?.find((method) => method.loc.start.line - 1 <= activeLine && method.loc.end.line - 1 >= activeLine)

        if (functions && insideFunctionBody) {
            snippet = '\${1:type} \$\${2:var}\${3: = \${4:\'value\'}}'
            const insert = this.getArgumentInsertPosition(document, insideFunctionBody)
            position = insert.position
            prefix = insert.prefix
        }

        if (!insideConstructorBody && !insideMethodBody && !insideFunctionBody) {
            if (this.CLASS_AST) {
                position = parser.getClassScopeInsertLine(this.CLASS_AST)
                const indentation = this.resolveClassScopeIndentation(position)
                prefix = indentation.prefix
                suffix = indentation.suffix
            } else {
                const freeForm = this.resolveFreeFormPosition(selection, activeLine)
                snippet = freeForm.snippet
                suffix = freeForm.suffix
                position = freeForm.position
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

        let functionBody: any
        let methodsOrFunctions: any[]

        try {
            const result = this.validateExtraction(document, selection, activeLine)
            functionBody = result.functionBody
            methodsOrFunctions = result.methodsOrFunctions
        } catch (error) {
            // Top-level code — determine class context for method vs function behavior
            methodsOrFunctions = parser.getMethodsOrFunctions(document.getText())
            functionBody = null
        }

        const selectionTxt = this.checkStartWithChar(document, selection)
        const hasReturn = parser.hasReturn(selectionTxt)
        const dependencies = parser.getVariableNames(selectionTxt)
        const methodArguments = dependencies.map((name) => `$${name}`).join(', ')

        let methodName: any = await vscode.window.showInputBox({
            placeHolder : 'function/method name',
        })

        if (!methodName) {
            return utils.showMessage('please enter a method/function name')
        }

        methodName = methodName.replace(/^\$/, '')

        if (methodsOrFunctions
            .filter((item) => item.kind !== 'closure')
            .some((item) => item.name.name == methodName)) {
            return utils.showMessage('method already exists')
        }

        if (!functionBody) {
            // Top-level extraction — check if inside a class
            const inClass = this.CLASS_AST
              && parser.hasIntersection(this.CLASS_AST, activeLine)

            if (inClass) {
                const position = parser.getClassScopeInsertLine(this.CLASS_AST)
                const docLine = document.lineAt(position.line)
                const indentation = docLine.text.substring(0, docLine.firstNonWhitespaceCharacterIndex) || this.DEFAULT_INDENT

                const methodContent = '\n\n'
                  + `${indentation}private function ${methodName}(${methodArguments})\n`
                  + `${indentation}{\n`
                  + `${indentation}${this.DEFAULT_INDENT}${selectionTxt}\n`
                  + `${indentation}}`

                await editor.edit((edit: vscode.TextEditorEdit) => {
                    edit.insert(
                        new vscode.Position(position.line, position.column),
                        methodContent,
                    )
                }, {undoStopBefore: false, undoStopAfter: false})

                if (replace) {
                    await this.replaceSelectionWithCall(editor, selection, '$this->', methodName, methodArguments, hasReturn)
                }
            } else {
                const topStatement = parser.getTopLevelStatementAtLine(document.getText(), activeLine)

                if (!topStatement) {
                    return utils.showMessage('could not determine where to insert the function', true)
                }

                const methodContent = `\n\nfunction ${methodName}(${methodArguments})${hasReturn ? ': mixed' : ''}\n{\n    ${selectionTxt.trimEnd()}\n}`

                await this.insertAfterFunctionBody(editor, topStatement, methodContent)

                if (replace) {
                    await this.replaceSelectionWithCall(editor, selection, '', methodName, methodArguments, hasReturn)
                }
            }

            return
        }

        const methodParameters = dependencies.map((name) => {
            const argument = functionBody.arguments?.find((item) => item.name.name === name)

            if (!argument) {
                return `$${name}`
            }

            const prefix = document.getText(parser.getRangeFromLoc(argument.loc.start, argument.name.loc.start)).trim()
            const cleanPrefix = prefix.replace(/^(public|protected|private|readonly)\s+/, '')

            return `${cleanPrefix}${cleanPrefix && !cleanPrefix.endsWith('&') ? ' ' : ''}$${name}`
        })

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
        const staticPrefix = isStatic ? 'static ' : ''
        const functionHeader = document.getText(parser.getRangeFromLoc(functionBody.loc.start, functionBody.body.loc.start))
        const returnType = hasReturn ? functionHeader.match(/\)\s*:\s*(.+?)\s*$/s)?.[1] : undefined
        const returnDeclaration = returnType ? `: ${returnType}` : ''

        const methodContent = '\n\n'
          + `${indentation}${methodType}${staticPrefix}function ${methodName}(${methodParameters.join(', ')})${returnDeclaration}\n`
          + `${indentation}{\n`
          + `${indentation}${indentation || contentIndentation}${selectionTxt}\n`
          + `${indentation}}`

        await this.insertAfterFunctionBody(editor, functionBody, methodContent)

        if (replace) {
            await editor.edit((edit: vscode.TextEditorEdit) => {
                const receiverPrefix = isFunction
                    ? ''
                    : (isStatic ? 'self::' : '$this->')

                edit.replace(selection, `${hasReturn ? 'return ' : ''}${receiverPrefix}${methodName}(${methodArguments});`)
            }, {undoStopBefore: false, undoStopAfter: false})
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
            if (header[i] === '(') {
                depth++
            }

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
            const {args, returnType} = this.parseFunctionHeader(header, openingParenthesis, closingParenthesis, /=>\s*$/)
            const line = document.lineAt(functionLike.loc.start.line - 1)
            const indentation = line.text.substring(0, line.firstNonWhitespaceCharacterIndex)
            const bodyIndentation = `${indentation}${this.DEFAULT_INDENT}`
            const parameters = new Set(functionLike.arguments.map((argument) => argument.name.name))
            const superglobals = new Set(['this', 'GLOBALS', '_SERVER', '_GET', '_POST', '_FILES', '_COOKIE', '_SESSION', '_REQUEST', '_ENV', 'http_response_header', 'argc', 'argv'])
            const dependencies = new Set<string>()
            const expressionLines = expression.split('\n')
            const continuationIndents = expressionLines.slice(1)
                .filter((item) => item.trim())
                .map((item) => item.match(/^\s*/)?.[0] ?? '')
            const commonContinuationIndent = continuationIndents.reduce((common, current) => {
                let index = 0

                while (index < common.length && common[index] === current[index]) {
                    index++
                }

                return common.slice(0, index)
            }, continuationIndents[0] ?? '')
            const normalizedExpression = expressionLines.map((item, index) => {
                if (index === 0) {
                    return item.trimEnd()
                }

                if (!item.trim()) {
                    return ''
                }

                return `${bodyIndentation}${item.slice(commonContinuationIndent.length).trimEnd()}`
            }).join('\n')

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
              + `${bodyIndentation}return ${normalizedExpression};\n`
              + `${indentation}}`
        } else {
            const bodyChildren = functionLike.body.children || []
            const returnStatement = bodyChildren.length === 1 && bodyChildren[0].kind === 'return'

            if (!returnStatement || !bodyChildren[0].expr) {
                return utils.showMessage('conversion is not possible', true)
            }

            if (functionLike.uses?.some((use) => use.byref)) {
                return utils.showMessage('closures using references cannot be shortened', true)
            }

            const expression = document.getText(parser.getRangeFromLoc(
                bodyChildren[0].expr.loc.start,
                bodyChildren[0].expr.loc.end,
            )).trim()
            const {args, returnType} = this.parseFunctionHeader(header, openingParenthesis, closingParenthesis, /use\s*\([^)]*\)/)
            replacement = `fn${args}${returnType ? ` ${returnType}` : ''} => ${expression}`
        }

        return editor.edit((edit: vscode.TextEditorEdit) => {
            edit.replace(functionRange, replacement)
        }, {undoStopBefore: true, undoStopAfter: true})
    }

    private async convertArrowToClosureAndResolveSelections(
        editor: vscode.TextEditor,
        document: vscode.TextDocument,
        selections: vscode.Selection[],
        activeLine: number,
        functionLike: any,
    ): Promise<{
        selections   : vscode.Selection[]
        topSelection : vscode.Selection
        activeLine   : number
        propertyName : string
        editor       : vscode.TextEditor
        document     : vscode.TextDocument
    } | undefined> {
        let propertyName = await vscode.window.showInputBox({
            placeHolder : 'property name',
        })

        if (!propertyName) {
            utils.showMessage('please enter a property name')

            return
        }

        propertyName = propertyName.replace(/^\$/, '')
        propertyName = `\$${propertyName}`

        // Save relative offset of the selection within the body expression,
        // which is preserved verbatim after conversion
        const bodyStartOffset = functionLike.body.loc.start.offset
        const originalSelections = utils.sortSelections(selections).map((selection) => ({
            text                 : document.getText(selection),
            relativeOffsetInBody : document.offsetAt(selection.start) - bodyStartOffset,
        }))

        // Anchor by offset, not line — lines can drift after document mutation
        const originalFnOffset = functionLike.loc.start.offset

        await this.toggleFunctionSyntax()

        // Re-read editor state after document modification
        editor = this.getEditor()
        document = editor.document

        // Find the closure using offset-based anchor (lines can shift after conversion)
        const anchorPos = document.positionAt(Math.min(originalFnOffset, document.getText().length - 1))
        const newFunctionLike = parser.getFunctionLikeAtLines(document.getText(), anchorPos.line, anchorPos.line)

        if (newFunctionLike?.kind !== 'closure') {
            utils.showMessage('could not find the closure after conversion', true)

            return
        }

        // The body expression is now inside the return statement
        const returnStatement = newFunctionLike.body?.children?.[0]

        if (returnStatement?.kind !== 'return' || !returnStatement.expr) {
            utils.showMessage('could not find the expression after conversion', true)

            return
        }

        const exprRange = parser.getRangeFromLoc(returnStatement.expr.loc.start, returnStatement.expr.loc.end)
        const resolvedSelections = this.resolveSelectionsInConvertedArrowFunction(
            document,
            exprRange,
            originalSelections,
        )

        if (resolvedSelections.length !== originalSelections.length) {
            utils.showMessage('could not find the selection after conversion', true)

            return
        }

        selections = resolvedSelections
        const resolvedTopSelection = utils.sortSelections(selections)[0]

        if (!resolvedTopSelection) {
            utils.showMessage('could not find the selection after conversion', true)

            return
        }

        const topSelection = resolvedTopSelection
        activeLine = topSelection.start.line

        return {selections, topSelection, activeLine, propertyName, editor, document}
    }

    private insertAfterFunctionBody(editor: vscode.TextEditor, functionBody: any, methodContent: string): Thenable<boolean> {
        return editor.edit((edit: vscode.TextEditorEdit) => {
            edit.insert(
                parser.getRangeFromLoc(functionBody.loc.end, functionBody.loc.end).end,
                methodContent,
            )
        }, {undoStopBefore: false, undoStopAfter: false})
    }

    private getShortClassName(namespace: string | undefined, className: string): string {
        if (!namespace) {
            return className
        }

        const namespaceParts = utils.getFQNOnly(namespace)?.split('\\') || []

        return namespaceParts.length > 0 ? `\\${namespaceParts.join('\\')}\\${className}` : className
    }

    private async replaceSelectionWithCall(
        editor: vscode.TextEditor,
        selection: vscode.Selection | vscode.Range,
        prefix: string,
        methodName: string,
        methodArguments: string,
        hasReturn: boolean,
    ): Promise<void> {
        await editor.edit((edit: vscode.TextEditorEdit) => {
            edit.replace(selection, `${hasReturn ? 'return ' : ''}${prefix}${methodName}(${methodArguments});`)
        }, {undoStopBefore: false, undoStopAfter: false})
    }

    private resolveScopeForNode(
        node: any,
        startLine: number,
        endLine: number,
        dependencies: string[],
        document: vscode.TextDocument,
        extractionTxt: string,
    ): {insertLocation: vscode.Range, indentation: string, propertyContent: string} | undefined {
        const scope = this.getIntersectedScope(node, startLine, endLine)

        if (!scope) {
            return undefined
        }

        const scopeResult = this.resolveScopeInsertLocation(scope, dependencies, document)

        if (!scopeResult) {
            return undefined
        }

        return {
            insertLocation  : scopeResult.insertRange,
            indentation     : scopeResult.indentation,
            propertyContent : `${scopeResult.indentation}${extractionTxt}${extractionTxt.endsWith('\n') ? '' : '\n'}`,
        }
    }

    private resolveScopeInsertLocation(
        scope: any,
        dependencies: string[],
        document: vscode.TextDocument,
    ): {insertRange: vscode.Range, indentation: string} | undefined {
        const lastVarDecl = parser.findLastVariableDeclarationNode(scope.body.children || [], dependencies)

        if (lastVarDecl) {
            return {
                insertRange : parser.getRangeFromLoc(
                    {line: lastVarDecl.loc.end.line + 1, column: 0},
                    {line: lastVarDecl.loc.end.line + 1, column: 0},
                ),
                indentation : document.lineAt(lastVarDecl.loc.end.line - 1).text.substring(0, document.lineAt(lastVarDecl.loc.end.line - 1).firstNonWhitespaceCharacterIndex),
            }
        }

        const scopeBodyStart = scope.body.children?.[0]?.loc.start || scope.body.loc.end

        return {
            insertRange : parser.getRangeFromLoc(
                {...scopeBodyStart, column: 0},
                {...scopeBodyStart, column: 0},
            ),
            indentation : document.lineAt(scopeBodyStart.line - 1).text.substring(0, document.lineAt(scopeBodyStart.line - 1).firstNonWhitespaceCharacterIndex),
        }
    }

    private parseFunctionHeader(
        header: string,
        openingParenthesis: number,
        closingParenthesis: number,
        suffixPattern?: RegExp,
    ): {args: string, returnType: string} {
        const args = header.slice(openingParenthesis, closingParenthesis + 1)
        let returnType = header.slice(closingParenthesis + 1)

        if (suffixPattern) {
            returnType = returnType.replace(suffixPattern, '')
        }

        return {args, returnType: returnType.trim()}
    }

    async extractToProperty() {
        let editor = this.getEditor()
        let {selections, document} = editor
        let topSelection = utils.sortSelections(selections)[0]

        if (!topSelection) {
            return utils.showMessage('please select text', true)
        }

        let activeLine = topSelection.start.line

        const functionLike = parser.getFunctionLikeAtLines(document.getText(), activeLine, activeLine)
        let propertyName: string | null = null

        if (functionLike?.kind === 'arrowfunc') {
            const converted = await this.convertArrowToClosureAndResolveSelections(
                editor, document, selections, activeLine, functionLike,
            )

            if (!converted) {
                return
            }

            editor = converted.editor
            document = converted.document
            selections = converted.selections
            topSelection = converted.topSelection
            activeLine = converted.activeLine
            propertyName = converted.propertyName
        }

        try {
            let functionBody: any
            let selectionTxt: string

            // Use directly-found functionLike for closures (bypasses getMethodsOrFunctions
            // which can fail to find closures that getFunctionLikeAtLines already found)
            if (functionLike?.kind === 'closure') {
                functionBody = functionLike
                this.checkForStartOrEndIntersection(functionBody, topSelection)
                selectionTxt = this.checkStartWithChar(document, topSelection)
            } else if (functionLike?.kind === 'arrowfunc') {
                const closureNode = parser.getFunctionLikeAtLines(document.getText(), activeLine, activeLine)

                if (closureNode?.kind !== 'closure') {
                    return utils.showMessage('could not find the closure after conversion', true)
                }

                functionBody = closureNode
                this.checkForStartOrEndIntersection(functionBody, topSelection)
                selectionTxt = this.checkStartWithChar(document, topSelection)
            } else {
                try {
                    const result = this.validateExtraction(document, topSelection, activeLine, {includeClosures: true})
                    functionBody = result.functionBody
                    selectionTxt = result.selectionTxt
                } catch (error) {
                    // No enclosing function/method/closure — treat as top-level code,
                    // the parser will find the top-level statement to insert before
                    selectionTxt = this.checkStartWithChar(document, topSelection)
                    functionBody = null
                }
            }

            if (!propertyName) {
                propertyName = await vscode.window.showInputBox({
                    placeHolder : 'property name',
                })

                if (!propertyName) {
                    return utils.showMessage('please enter a property name')
                }

                propertyName = propertyName.replace(/^\$/, '')
                propertyName = `\$${propertyName}`
            }

            const isEndOfStatement = selectionTxt.endsWith(';')
            const extractionTxt = `${propertyName} = ${selectionTxt}${isEndOfStatement ? '' : ';'}`

            editor = this.getEditor()

            const dependencies = parser.getVariableNames(extractionTxt)
            let insertLocation: vscode.Range | vscode.Selection = editor.selection
            let methodBodyLine
            let propertyContent
            let indentation

            if (!functionBody) {
                const topStatement = parser.getTopLevelStatementAtLine(document.getText(), topSelection.start.line)

                if (!topStatement) {
                    return utils.showMessage('could not determine where to insert the variable', true)
                }

                // Resolve scope within the top-level control structure (foreach/if/while body)
                const scopeResult = this.resolveScopeForNode(topStatement, topSelection.start.line, topSelection.end.line, dependencies, document, extractionTxt)

                if (scopeResult) {
                    insertLocation = scopeResult.insertLocation
                    indentation = scopeResult.indentation
                    propertyContent = scopeResult.propertyContent
                    editor.selection = topSelection
                } else if (topStatement.body?.children?.length) {
                    const bodyChild = topStatement.body.children[0].loc.start
                    insertLocation = parser.getRangeFromLoc(
                        {line: bodyChild.line, column: 0},
                        {line: bodyChild.line, column: 0},
                    )
                    methodBodyLine = document.lineAt(bodyChild.line - 1)
                    indentation = methodBodyLine.text.substring(0, methodBodyLine.firstNonWhitespaceCharacterIndex)
                    propertyContent = `${indentation}${extractionTxt}${extractionTxt.endsWith('\n') ? '' : '\n'}`
                    editor.selection = topSelection
                } else {
                    const statementStart = topStatement.loc.start
                    insertLocation = parser.getRangeFromLoc(
                        {line: statementStart.line, column: 0},
                        {line: statementStart.line, column: 0},
                    )
                    indentation = ''
                    propertyContent = `${extractionTxt}\n`
                    editor.selection = topSelection
                }
            } else {
                const scopeResult = this.resolveScopeForNode(functionBody, topSelection.start.line, topSelection.end.line, dependencies, document, extractionTxt)

                if (scopeResult) {
                    insertLocation = scopeResult.insertLocation
                    indentation = scopeResult.indentation
                    propertyContent = scopeResult.propertyContent
                } else {
                    const lastVarDecl = parser.findLastVariableDeclarationNode(functionBody.body.children || [], dependencies)

                    if (lastVarDecl) {
                        insertLocation = parser.getRangeFromLoc(
                            {line: lastVarDecl.loc.end.line + 1, column: 0},
                            {line: lastVarDecl.loc.end.line + 1, column: 0},
                        )
                        indentation = document.lineAt(lastVarDecl.loc.end.line - 1).text.substring(0, document.lineAt(lastVarDecl.loc.end.line - 1).firstNonWhitespaceCharacterIndex)
                    } else {
                        const _currentMethodStart = functionBody.body.children[0].loc.start
                        insertLocation = parser.getRangeFromLoc(_currentMethodStart, _currentMethodStart)
                        indentation = document.lineAt(_currentMethodStart.line - 1).text.substring(0, document.lineAt(_currentMethodStart.line - 1).firstNonWhitespaceCharacterIndex)
                    }

                    propertyContent = `${extractionTxt}\n${indentation}`
                    editor.selection = topSelection
                }
            }

            const sortedSelections = utils.sortSelections(selections).reverse()
            const edited = await editor.edit((edit: vscode.TextEditorEdit) => {
                for (const selection of sortedSelections) {
                    edit.replace(selection, `${propertyName}${isEndOfStatement ? ';' : ''}`)
                }

                edit.insert(insertLocation.end, propertyContent)
            }, {undoStopBefore: true, undoStopAfter: true})

            const cursorPosition = insertLocation.start.translate(0, indentation.length)
            editor.selection = new vscode.Selection(cursorPosition, cursorPosition)

            return edited
        } catch (error) {
            utils.showMessage(error.message, true)
        }
    }

    getIntersectedScope(node, startLine: number, endLine: number): any {
        // Only function-like nodes should exclude their own body — for control
        // structures (foreach/if/while) the body IS the scope to insert into.
        const isFunctionLike = ['function', 'method', 'closure', 'arrowfunc'].includes(node.kind)

        const visit = (value: any, insideArrowFunction = false): any => {
            if (!value || typeof value !== 'object') {
                return
            }

            const isArrowFunction = value.kind === 'arrowfunc'
            const isScope = !insideArrowFunction && value.kind === 'block' && value.loc && (!isFunctionLike || value !== node.body)
              && value.loc.start.line - 1 <= startLine
              && value.loc.end.line - 1 >= endLine

            for (const child of Object.values(value)) {
                const scope = visit(child, insideArrowFunction || isArrowFunction)

                if (scope) {
                    return scope
                }
            }

            return isScope ? {body: value} : undefined
        }

        return visit(node)
    }

    resolveSelectionsInConvertedArrowFunction(
        document: vscode.TextDocument,
        expressionRange: vscode.Range,
        originalSelections: {text: string, relativeOffsetInBody: number}[],
    ): vscode.Selection[] {
        const expressionText = document.getText(expressionRange)
        const expressionOffset = document.offsetAt(expressionRange.start)

        return originalSelections
            .map((selection) => {
                const matchOffset = this.findClosestOffset(expressionText, selection.text, selection.relativeOffsetInBody)

                if (matchOffset === -1) {
                    return null
                }

                const startOffset = expressionOffset + matchOffset
                const startPos = document.positionAt(startOffset)
                const endPos = document.positionAt(startOffset + selection.text.length)

                return new vscode.Selection(startPos, endPos)
            })
            .filter((selection): selection is vscode.Selection => selection !== null)
    }

    findClosestOffset(text: string, searchText: string, targetOffset: number): number {
        let bestMatch = -1
        let bestDiff = Infinity
        let searchPos = 0

        while (true) {
            const foundAt = text.indexOf(searchText, searchPos)

            if (foundAt === -1) {
                break
            }

            const diff = Math.abs(foundAt - targetOffset)

            if (diff < bestDiff) {
                bestDiff = diff
                bestMatch = foundAt
            }

            searchPos = foundAt + 1
        }

        // Reject if too far from the target offset — likely the wrong occurrence
        if (bestMatch !== -1 && bestDiff > Math.max(searchText.length * 2, 20)) {
            return -1
        }

        return bestMatch
    }

    async extractToClass() {
        const editor = this.getEditor()
        const {selections, selection, document} = editor
        const activeLine = selection.active.line

        if (selections.length > 1) {
            return utils.showMessage('extract to class doesnt work with multiple selections', true)
        }

        let selectionTxt: string
        let methodsOrFunctions: any[]

        try {
            const result = this.validateExtraction(document, selection, activeLine)
            selectionTxt = result.selectionTxt
            methodsOrFunctions = result.methodsOrFunctions
        } catch (error) {
            methodsOrFunctions = parser.getMethodsOrFunctions(document.getText())
            selectionTxt = this.checkStartWithChar(document, selection)
        }

        try {
            const selectedDirectory = await vscode.window.showOpenDialog({
                canSelectFiles   : false,
                canSelectFolders : true,
                canSelectMany    : false,
                openLabel        : 'Select Directory',
                title            : 'Select directory for new class',
                defaultUri       : vscode.workspace.workspaceFolders?.[0]?.uri,
            })

            if (!selectedDirectory || selectedDirectory.length === 0) {
                return utils.showMessage('please select a directory')
            }

            const targetDirectory = selectedDirectory[0].fsPath

            const className: any = await vscode.window.showInputBox({
                placeHolder   : 'Class name (e.g., MyNewClass)',
                validateInput : (value: string) => {
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

            const newFilePath = `${targetDirectory}/${className}.php`

            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(newFilePath))

                return utils.showMessage('file already exists', true)
            } catch {
                // File doesn't exist, which is what we want
            }

            const namespace = await utils.getNamespaceFromPath(newFilePath)
            const namespaceDeclaration = namespace ? `${namespace}\n\n` : ''

            const selectedMethod = this.findCompleteMethodInSelection(selection, methodsOrFunctions)

            let classContent: string
            let methodName: string
            let replacementText: string

            if (selectedMethod) {
                methodName = selectedMethod.name.name
                const isStatic = selectedMethod.isStatic === true
                const methodParameters = this.generateMethodCallParameters(selectedMethod.arguments || [])

                classContent = `<?php\n\n${namespaceDeclaration}class ${className}\n{\n    ${selectionTxt.trim()}\n}\n`

                const shortClassName = this.getShortClassName(namespace, className)
                replacementText = isStatic
                    ? `${shortClassName}::${methodName}(${methodParameters});`
                    : `(new ${shortClassName}())->${methodName}(${methodParameters});`
            } else {
                methodName = 'extractedMethod'
                classContent = `<?php\n\n${namespaceDeclaration}class ${className}\n{\n    public function ${methodName}()\n    {\n        ${selectionTxt.split('\n').join('\n        ')}\n    }\n}\n`

                replacementText = `(new ${this.getShortClassName(namespace, className)}())->${methodName}();`
            }

            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(newFilePath),
                Buffer.from(classContent),
            )

            await editor.edit((edit: vscode.TextEditorEdit) => {
                edit.replace(selection, replacementText)
            }, {undoStopBefore: false, undoStopAfter: false})

            const newDocument = await vscode.workspace.openTextDocument(newFilePath)
            await vscode.window.showTextDocument(newDocument)

            utils.showMessage(`Class ${className} created successfully`)
        } catch (error: any) {
            utils.showMessage(error.message, true)
        }
    }

    findCompleteMethodInSelection(selection: vscode.Selection, methodsOrFunctions: any[]): any | null {
        for (const method of methodsOrFunctions) {
            const methodStartLine = method.loc.start.line - 1
            const methodEndLine = method.loc.end.line - 1

            // (with some tolerance for whitespace)
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
            const paramName = this.getArgumentName(arg, index)

            if (arg.value) {
                return arg.type ? `/* ${arg.type} */ $${paramName}` : `$${paramName}`
            }

            if (!arg.type?.name) {
                return `$${paramName}`
            }

            return this.getTypedParameterPlaceholder(arg.type.name, paramName)
        }).join(', ')
    }

    getArgumentName(arg: any, index: number): string {
        let paramName = (arg.name && arg.name.name) || `param${index + 1}`

        if (typeof paramName !== 'string') {
            paramName = `param${index + 1}`
        }

        return paramName.startsWith('$') ? paramName.substring(1) : paramName
    }

    getTypedParameterPlaceholder(typeName: string, paramName: string): string {
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
            const methodsOrFunctions = parser.getMethodsOrFunctions(editor.document.getText())
            const functionBody = this.getIntersectedMethodOrFunction(methodsOrFunctions, activeLine)

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
                const staticPrefix = isStatic ? 'static ' : ''

                const methodContent = '\n\n'
                  + `${indentation}${methodType}${staticPrefix}function ${methodAndParams}\n`
                  + `${indentation}{\n`
                  + `${indentation}${indentation}throw new \\Exception(__FUNCTION__ . ' not implemented.');\n`
                  + `${indentation}}`

                return this.insertAfterFunctionBody(editor, functionBody, methodContent)
            }
        } catch (error) {
            utils.showMessage(error.message, true)
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
                const {prefix, suffix} = this.resolveClassScopeIndentation(position)
                const snippet = `${prefix}\${1|public,private,protected|}${readOnly} \${2:type} \\$${propName}\${4: = \${5:'value'}}${suffix}`

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

    validateExtraction(document: vscode.TextDocument, selection: vscode.Selection, activeLine: number, options?: {includeClosures?: boolean}): {functionBody: any, selectionTxt: string, methodsOrFunctions: any[]} {
        const methodsOrFunctions = parser.getMethodsOrFunctions(document.getText())
        const functionBody = this.getIntersectedMethodOrFunction(methodsOrFunctions, activeLine, options)

        this.checkForStartOrEndIntersection(functionBody, selection)
        const selectionTxt = this.checkStartWithChar(document, selection)

        return {functionBody, selectionTxt, methodsOrFunctions}
    }

    getIntersectedMethodOrFunction(methodsOrFunctions, activeLine, options?: {includeClosures?: boolean}) {
        let candidates = methodsOrFunctions

        if (!options?.includeClosures) {
            candidates = candidates?.filter((item) => item.kind !== 'closure')
        }

        const intersectedFunctionBody = candidates?.find((method) => parser.hasIntersection(method, activeLine))

        if (!intersectedFunctionBody) {
            throw new Error('only contents of method/function can be extracted')
        }

        return intersectedFunctionBody
    }
}
