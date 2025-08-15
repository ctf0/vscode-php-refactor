# Change Log

## 0.0.1

- Initial release

## 0.0.2

- cleanup/rewrite
- `extract to property` will be now added as close as possible to the extraction point instead of at the beginning of the method
- `add new property` now works with functions as well

## 0.0.4

- fix `extract to property`

## 0.0.5

- add file rename/move refactoring

## 0.0.8

- add code action to add `__invoke`
- multiple selection extract is now handled correctly

## 0.1.0

- add code action to add any magic method
- remove add constructor cmnd

## 0.1.2

- fix extract to new method outside of class body

## 0.1.3

- allow the extension to work regardless of parsing errors

## 0.1.5

- fix add new property code action

## 0.1.6

- add new command `Copy To Method/Function`
- fix insert line for magic methods

## 0.1.7

- now works in trait as well

## 0.2.0

- fix not working correctly
- better api
- change `phpRefactor.excludeSubExtensions` to `phpRefactor.excludeList`, as we dont rely on the search/files exclude anymore
- update deps

## 0.2.1

- add a way to update/generate directory files namespace in bulk

## 0.2.2

- fix not respecting the excluded paths

## 0.2.3

- fix adding namespaces to file that usually doesnt have one ex.`configs, routes, lang

## 0.2.5

- add an option to run `composer dump` after namespace update
