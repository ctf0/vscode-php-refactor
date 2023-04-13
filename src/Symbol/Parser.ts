import * as PhpParser from 'php-parser';
import * as vscode from 'vscode';

const _set = require('lodash.set');
const Parser = new PhpParser.Engine({
    parser: {
        extractDoc: true,
    },
    ast: {
        withPositions: true,
    },
});

function buildASTFromContent(content: string) {
    return Parser.parseCode(content, '*.php');
}

export function getClassASTFromContent(content: string) {
    try {
        const AST = buildASTFromContent(content);

        return getClass(
            AST?.children?.find((item: any) => item.kind == 'namespace') ||
            AST,
        );
    } catch (error) {
        // console.error(error);
    }
}

export function getMethodsOrFunctions(content: string) {
    try {
        const _class = getClassASTFromContent(content);

        if (_class) {
            return getMethods(_class);
        } else {
            return getFunctions(buildASTFromContent(content));
        }
    } catch (error) {
        // console.error(error);
    }
}

export function getMethods(_classAST: any): any[] | undefined {
    return _classAST?.body.filter((item: any) => item.kind == 'method');
}

export function getFunctions(AST) {
    const filterExtra = AST?.children?.filter((item: any) => !new RegExp(/declare|usegroup|expressionstatement|function/).test(item.kind));

    return AST?.children
        ?.filter((item: any) => item.kind == 'function')
        .concat(getFunctionsLookup(filterExtra))
        .flat()
        .filter((e) => e);
}

export function getConstructor(_classAST: any, getArgsOnly = false) {
    const _const = getMethods(_classAST)?.find((item: any) => item.name.name == '__construct');

    if (getArgsOnly) {
        return _const?.arguments.map((item: PhpParser.Parameter) =>
            Object.assign(item, {
                leadingComments : _const.leadingComments,
                visibility      : flagsToVisibility(item.flags),
            }),
        );
    }

    return _const;
}

export function getClassScopeInsertLine(_classAST: any) {
    let position: any = null;

    // get last prop
    const _properties = getAllProperties(_classAST);

    if (_properties && _properties.length) {
        position = _properties[_properties.length - 1];

        return {
            line          : position.loc.end.line - 1,
            column        : position.loc.end.column,
            addPrefixLine : true,
            addSuffixLine : false,
        };
    }

    // get first method
    // ~first method comment if found
    const methods = getMethods(_classAST);

    if (methods && methods.length) {
        position = methods[0];

        const _comments = position.leadingComments;

        if (_comments) {
            position = _comments[0];
        }

        return {
            line          : position.loc.start.line - 1,
            column        : position.loc.start.column,
            addPrefixLine : false,
            addSuffixLine : true,
        };
    }

    // or class start
    // if non found
    position = _classAST;

    return {
        line          : position.loc.end.line - 1,
        column        : 0,
        addPrefixLine : false,
        addSuffixLine : true,
    };
}

export function getAllProperties(_classAST: any) {
    return _classAST?.body
        .filter((item: any) => item.kind == 'propertystatement')
        .map((item: any) => { // because the parser doesnt return correct column
            const start = item.loc.start;
            let extraLength = start.column - (item.visibility.length + 1);

            if (item.isStatic) {
                extraLength -= 'static '.length;
            }

            _set(item, 'loc.start.column', extraLength);
            _set(item, 'loc.end.column', item.loc.end.column + 1); // include the ;
            _set(item, 'loc.start.offset', start.offset - extraLength);

            return item;
        });
}

function getClass(AST) {
    return AST?.children?.find((item: any) => item.kind == 'class');
}

function getFunctionsLookup(filterExtra) {
    const list: any = [];

    for (const item of filterExtra) {
        list.push(item.body?.children?.filter((item: any) => item.kind == 'function'));
    }

    return list;
}

export function getRangeFromLoc(start: { line: number; column: number; }, end: { line: number; column: number; }): vscode.Range {
    return new vscode.Range(
        new vscode.Position(start.line - 1, start.column),
        new vscode.Position(end.line - 1, end.column),
    );
}

function flagsToVisibility(flags: number): string {
    let type = '';

    switch (flags) {
        case 1:
            type = 'public';
        case 2:
            type = 'protected';
        case 4:
            type = 'private';
    }

    return type;
}

export function hasStartOrEndIntersection(symbol, selection): boolean {
    return symbol.loc.start.line === selection.start.line || symbol.loc.end.line === selection.end.line;
}

export function hasIntersection(symbol, lineNumber): boolean {
    return symbol.loc.start.line - 1 <= lineNumber && symbol.loc.end.line - 1 >= lineNumber;
}
