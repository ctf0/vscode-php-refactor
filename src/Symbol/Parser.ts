import _set from 'lodash.set'
import * as PhpParser from 'php-parser'
import * as vscode from 'vscode'

const Parser = new PhpParser.Engine({
    parser : {
        extractDoc     : true,
        suppressErrors : true,
        version        : '8.5',
    },
    ast : {
        withPositions : true,
    },
})

function buildASTFromContent(content: string) {
    return parseCode(content)
}

export function parseCode(content: string) {
    return Parser.parseCode(content, '*.php')
}

export function getClassASTFromContent(content: string) {
    try {
        const AST = buildASTFromContent(content)

        return getClass(
            AST?.children?.find((item: any) => item.kind == 'namespace')
            || AST,
        )
    } catch (error) {
        // console.error(error);
    }
}

export function getMethodsOrFunctions(content: string) {
    try {
        const _class = getClassASTFromContent(content)

        if (_class) {
            const methods = getMethods(_class) ?? []
            const closures = getAllClosures(_class) ?? []

            return [...closures, ...methods]
        } else {
            const AST = buildASTFromContent(content)
            const funcs = getFunctions(AST) ?? []
            const closures = getAllClosures(AST) ?? []

            return [...closures, ...funcs]
        }
    } catch (error) {
        // console.error(error);
    }
}

export function canAddNewPropertyAtLine(content: string, line: number): boolean {
    const classAST = getClassASTFromContent(content)

    return Boolean(
        (classAST && hasIntersection(classAST, line))
        || getMethodsOrFunctions(content)?.some((item) => hasIntersection(item, line)),
    )
}

export function getFunctionLikeAtLines(content: string, startLine: number, endLine: number): any {
    try {
        const AST = buildASTFromContent(content)
        let functionLike

        const visit = (node: any): void => {
            if (!node || typeof node !== 'object') {
                return
            }

            if (['closure', 'arrowfunc'].includes(node.kind)
              && node.loc.start.line - 1 <= startLine
              && node.loc.end.line - 1 >= endLine) {
                functionLike = node
            }

            Object.values(node).forEach(visit)
        }

        visit(AST)

        return functionLike
    } catch (error) {
        // console.error(error);
    }
}

export function getVariableNames(content: string): string[] {
    try {
        const AST = buildASTFromContent(`<?php\n${content}`)
        const variables = new Set<string>()
        const assigned = new Set<string>()

        const visit = (node: any): void => {
            if (!node || typeof node !== 'object') {
                return
            }

            if (node.kind === 'variable') {
                variables.add(node.name)
            }

            if (node.kind === 'assign' && node.left?.kind === 'variable') {
                assigned.add(node.left.name)
            }

            Object.values(node).forEach(visit)
        }

        visit(AST)

        return [...variables].filter((name) => !assigned.has(name) && name !== 'this')
    } catch (error) {
        // console.error(error);
        return []
    }
}

export function hasReturn(content: string): boolean {
    try {
        const AST = buildASTFromContent(`<?php\n${content}`)
        let found = false

        const visit = (node: any): void => {
            if (!node || typeof node !== 'object' || found) {
                return
            }

            if (node.kind === 'return') {
                found = true

                return
            }

            Object.values(node).forEach(visit)
        }

        visit(AST)

        return found
    } catch (error) {
        // console.error(error);
        return false
    }
}

function getMethods(_classAST: any): any[] | undefined {
    return _classAST?.body.filter((item: any) => item.kind == 'method')
}

function getAllClosures(AST: any): any[] {
    const closures: any[] = []

    const visit = (node: any): void => {
        if (!node || typeof node !== 'object') {
            return
        }

        if (node.kind === 'closure') {
            closures.push(node)
        }

        Object.values(node).forEach(visit)
    }

    visit(AST)

    // Innermost (smallest range) first so Array.find prefers the most specific match
    closures.sort((a, b) => {
        const aSize = a.loc.end.offset - a.loc.start.offset
        const bSize = b.loc.end.offset - b.loc.start.offset

        return aSize - bSize
    })

    return closures
}

function getFunctions(AST) {
    const filterExtra = AST?.children?.filter((item: any) => !/declare|usegroup|expressionstatement|function/.test(item.kind))

    return AST?.children
        ?.filter((item: any) => item.kind == 'function')
        .concat(getFunctionsLookup(filterExtra))
        .filter((e) => e)
}

export function getConstructor(_classAST: any, getArgsOnly = false) {
    const _const = getMethods(_classAST)?.find((item: any) => getName(item) == '__construct')

    if (getArgsOnly) {
        return _const?.arguments.map((item: PhpParser.Parameter) =>
            Object.assign(item, {
                leadingComments : _const.leadingComments,
                visibility      : flagsToVisibility(item.flags),
            }),
        )
    }

    return _const
}

export function getClassScopeInsertLine(_classAST: any) {
    let position: any = null

    // get last prop
    const _properties = getAllProperties(_classAST)

    if (_properties && _properties.length) {
        position = _properties[_properties.length - 1]

        return {
            line          : position.loc.end.line - 1,
            column        : position.loc.end.column,
            addPrefixLine : true,
            addSuffixLine : false,
        }
    }

    // get first method
    // ~first method comment if found
    const methods = getMethods(_classAST)

    if (methods && methods.length) {
        position = methods[0]

        const _comments = position.leadingComments

        if (_comments) {
            position = _comments[0]
        }

        return {
            line          : position.loc.start.line - 1,
            column        : position.loc.start.column,
            addPrefixLine : false,
            addSuffixLine : true,
        }
    }

    // or class start
    // if non found
    position = _classAST

    return {
        line          : position.loc.end.line - 1,
        column        : 0,
        addPrefixLine : false,
        addSuffixLine : true,
    }
}

function getAllProperties(_classAST: any) {
    return _classAST?.body
        .filter((item: any) => item.kind == 'propertystatement')
        .map((item: any) => { // because the parser doesnt return correct column
            const start = item.loc.start
            let extraLength = start.column - (item.visibility.length + 1)

            if (item.isStatic) {
                extraLength -= 'static '.length
            }

            _set(item, 'loc.start.column', extraLength)
            _set(item, 'loc.end.column', item.loc.end.column + 1) // include the ;
            _set(item, 'loc.start.offset', start.offset - extraLength)

            return item
        })
}

function getClass(AST) {
    return AST?.children?.find((item: any) => ['class', 'trait'].includes(item.kind))
}

function getFunctionsLookup(filterExtra) {
    return filterExtra.flatMap((item) =>
        item.body?.children?.filter((child: any) => child.kind == 'function') || [],
    )
}

export function getName(node: any): string | undefined {
    return node?.name?.name
}

export function getRangeFromLoc(start: {line: number, column: number}, end: {line: number, column: number}): vscode.Range {
    return new vscode.Range(
        new vscode.Position(start.line - 1, start.column),
        new vscode.Position(end.line - 1, end.column),
    )
}

function flagsToVisibility(flags: number): string {
    let type = ''

    switch (flags) {
        case 1:
            type = 'public'
            break
        case 2:
            type = 'protected'
            break
        case 4:
            type = 'private'
            break
    }

    return type
}

export function getTopLevelStatementAtLine(content: string, lineNumber: number): any {
    try {
        const AST = buildASTFromContent(content)
        const root = AST?.children?.find((item: any) => item.kind == 'namespace') || AST

        if (!root?.children) {
            return null
        }

        return root.children.find((item: any) =>
            item.kind && item.loc
            && item.loc.start.line - 1 <= lineNumber
            && item.loc.end.line - 1 >= lineNumber,
        )
    } catch (error) {
        return null
    }
}

export function hasStartOrEndIntersection(symbol, selection): boolean {
    return symbol.loc.start.line - 1 === selection.start.line || symbol.loc.end.line - 1 === selection.end.line
}

export function findLastVariableDeclarationNode(nodes: any[], variableNames?: string[]): any | null {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]

        if (
            node.kind === 'expressionstatement'
            && node.expression?.kind === 'assign'
            && node.expression.left?.kind === 'variable'
        ) {
            if (variableNames && variableNames.length > 0) {
                if (variableNames.includes(node.expression.left.name)) {
                    return node
                }
            } else {
                return node
            }
        }
    }

    return null
}

export function hasIntersection(symbol, lineNumber): boolean {
    return symbol.loc.start.line - 1 <= lineNumber && symbol.loc.end.line - 1 >= lineNumber
}

/**
 * Finds the innermost method `call` node (e.g. `$this->paginate(...)`, `self::foo(...)`)
 * that contains the given cursor position, together with the name of the class/trait
 * that encloses it. Only matches calls whose method name is a plain identifier, so we
 * never treat array-access `$arr[$k]` or variable calls as a method call.
 */
export function getMethodCallAtLine(content: string, line: number, character?: number): {call: any, className: string | undefined} | null {
    try {
        const AST = buildASTFromContent(content)
        const cursor = {line, character: character ?? 0}
        let best: any = null
        let bestClassName: string | undefined
        let bestSize = Infinity

        const containsPosition = (node: any): boolean => {
            const start = node.loc.start
            const end = node.loc.end

            return (start.line - 1 < cursor.line
              || (start.line - 1 === cursor.line && start.column <= cursor.character))
            && (end.line - 1 > cursor.line
              || (end.line - 1 === cursor.line && end.column >= cursor.character))
        }

        const visit = (node: any, className: string | undefined): void => {
            if (!node || typeof node !== 'object') {
                return
            }

            let nextClassName = className

            if (node.kind === 'class' || node.kind === 'trait') {
                nextClassName = node.name?.name
            }

            if (node.kind === 'call'
              && node.what?.offset?.kind === 'identifier'
              && containsPosition(node)) {
                const size = node.loc.end.offset - node.loc.start.offset

                if (size < bestSize) {
                    bestSize = size
                    best = node
                    bestClassName = nextClassName
                }
            }

            Object.values(node).forEach((value) => visit(value, nextClassName))
        }

        visit(AST, undefined)

        return best ? {call: best, className: bestClassName} : null
    } catch (error) {
        return null
    }
}

/**
 * Resolves the class a method call is invoked on, using the enclosing class name
 * for instance/`$this` receivers.
 *  - `$this->foo()` / `self::foo()` / `static::foo()`  → the enclosing class
 *  - `SomeClass::foo()`                                → the referenced class name
 *  - `$instance->foo()` (plain variable) or a chained call receiver → undefined
 */
export function resolveCallReceiverClass(callNode: any, enclosingClassName?: string): string | undefined {
    const what = callNode?.what

    if (!what) {
        return undefined
    }

    if (what.kind === 'propertylookup') {
        if (what.what?.kind === 'variable' && what.what.name === 'this') {
            return enclosingClassName
        }

        return undefined
    }

    if (what.kind === 'staticlookup') {
        const receiver = what.what

        if (receiver?.kind === 'name') {
            return receiver.name
        }

        return enclosingClassName
    }

    return undefined
}

/**
 * Extracts the namespace declaration and the alias map (short name → FQCN) from a
 * file. The alias map only covers class/interface imports (not `use function` or
 * `use const`). Unaliased imports map by their last name segment.
 */
export function parseUseStatements(content: string): {namespace: string | undefined, aliases: Record<string, string>} {
    try {
        const AST: any = buildASTFromContent(content)
        const namespaceNode = AST?.children?.find((item: any) => item.kind === 'namespace')
        const namespace = namespaceNode?.name?.name
        const aliases: Record<string, string> = {}
        const items = namespaceNode?.children ?? AST?.children ?? []

        for (const item of items) {
            if (item.kind !== 'usegroup' || item.type === 'function' || item.type === 'const') {
                continue
            }

            const groupPrefix = item.name ? `${item.name}\\` : ''

            for (const useItem of item.items ?? []) {
                if (useItem.kind !== 'useitem' || useItem.type) {
                    continue
                }

                const full = `${groupPrefix}${useItem.name}`
                const alias = useItem.alias?.name ?? full.split('\\').pop()

                if (alias) {
                    aliases[alias] = full
                }
            }
        }

        return {namespace, aliases}
    } catch (error) {
        return {namespace: undefined, aliases: {}}
    }
}
