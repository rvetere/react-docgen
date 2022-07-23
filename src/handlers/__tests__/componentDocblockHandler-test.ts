import { makeMockImporter, parse } from '../../../tests/utils';
import componentDocblockHandler from '../componentDocblockHandler';
import Documentation from '../../Documentation';
import type DocumentationMock from '../../__mocks__/Documentation';
import type { NodePath } from '@babel/traverse';
import type {
  ArrowFunctionExpression,
  ClassExpression,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ExpressionStatement,
  FunctionExpression,
  Node,
  ObjectExpression,
  VariableDeclaration,
} from '@babel/types';

jest.mock('../../Documentation');

describe('componentDocblockHandler', () => {
  let documentation: Documentation & DocumentationMock;

  beforeEach(() => {
    documentation = new Documentation() as Documentation & DocumentationMock;
  });

  function test(
    definitionSrc: string,
    parseFunc: (src: string) => NodePath<Node | null | undefined>,
  ) {
    it('finds docblocks for component definitions', () => {
      const definition = parseFunc(`
        import something from 'somewhere';

        /**
         * Component description
         */
        ${definitionSrc}
      `) as NodePath;

      componentDocblockHandler(documentation, definition);
      expect(documentation.description).toBe('Component description');
    });

    it('ignores other types of comments', () => {
      let definition = parseFunc(`
        import something from 'somewhere';

        /*
         * This is not a docblock',
         */
        ${definitionSrc}
      `) as NodePath;

      componentDocblockHandler(documentation, definition);
      expect(documentation.description).toBe('');

      definition = parseFunc(`
        // Inline comment'
        ${definitionSrc}
      `) as NodePath;

      componentDocblockHandler(documentation, definition);
      expect(documentation.description).toBe('');
    });

    it('only considers the docblock directly above the definition', () => {
      const definition = parseFunc(`
        import something from 'somewhere';

        /**
         * This is the wrong docblock
         */
        var something_else = "foo";
        ${definitionSrc}
      `) as NodePath;

      componentDocblockHandler(documentation, definition);
      expect(documentation.description).toBe('');
    });
  }

  /**
   * Decorates can only be assigned to class and therefore only make sense for
   * class declarations and export declarations.
   */
  function testDecorators(
    classSrc: string,
    parseFunc: (src: string) => NodePath<Node | null | undefined>,
    exportSrc = '',
  ) {
    describe('decorators', () => {
      it("uses the docblock above the decorator if it's the only one", () => {
        const definition = parseFunc(`
          import something from 'somewhere';
          /**
           * Component description
           */
          ${exportSrc}
          @Decorator1
          @Decorator2
          ${classSrc}
        `) as NodePath;

        componentDocblockHandler(documentation, definition);
        expect(documentation.description).toBe('Component description');
      });

      it('uses the component docblock if present', () => {
        const definition = parseFunc(`
          import something from 'somewhere';

          ${exportSrc}
          /**
          * Decorator description
          */
          @Decorator1
          @Decorator2
          /**
           * Component description
           */
          ${classSrc}
        `) as NodePath;

        componentDocblockHandler(documentation, definition);
        expect(documentation.description).toBe('Component description');
      });
    });
  }

  function testImports(
    exportSrc: string,
    importName: string,
    useDefault = false,
  ) {
    const importDef = useDefault ? `${importName}` : `{ ${importName} }`;

    const mockImporter = makeMockImporter({
      test1: stmtLast =>
        stmtLast(
          `
        /**
        * Component description
        */
        ${exportSrc}
      `,
          false,
          0,
        ).get('declaration') as NodePath,

      test2: stmtLast =>
        stmtLast<ExportDefaultDeclaration>(`
        import ${importDef} from 'test1';
        export default ${importName};
      `).get('declaration'),
    });

    describe('imports', () => {
      it('can use a custom importer to resolve docblocks on imported components', () => {
        const program = parse
          .statementLast<ExportDefaultDeclaration>(
            `import ${importDef} from 'test1';
             export default ${importName};`,
            mockImporter,
          )
          .get('declaration');

        componentDocblockHandler(documentation, program);
        expect(documentation.description).toBe('Component description');
      });
    });

    it('traverses multiple imports', () => {
      const program = parse
        .statementLast<ExportDefaultDeclaration>(
          `import ${importDef} from 'test2';
           export default ${importName};`,
          mockImporter,
        )
        .get('declaration');

      componentDocblockHandler(documentation, program);
      expect(documentation.description).toBe('Component description');
    });
  }

  describe('React.createClass', () => {
    test('var Component = React.createClass({})', src =>
      parse
        .statementLast(src)
        .get('declarations.0.init.arguments.0') as NodePath<ObjectExpression>);
    testImports('export var Component = React.createClass({})', 'Component');
  });

  describe('ClassDeclaration', () => {
    test('class Component {}', src => parse.statementLast(src));
    testDecorators('class Component {}', src => parse.statementLast(src));
    testImports('export class Component {}', 'Component');
  });

  describe('ClassExpression', () => {
    test('var Component = class {};', src =>
      parse
        .statementLast<VariableDeclaration>(src)
        .get('declarations.0.init') as NodePath<ClassExpression>);
    testImports('export var Component = class {};', 'Component');
  });

  describe('Stateless functions', () => {
    test('function Component() {}', src => parse.statementLast(src));
    testImports('export function Component() {}', 'Component');
    test('var Component = function () {};', src =>
      parse
        .statementLast<VariableDeclaration>(src)
        .get('declarations.0.init') as NodePath<FunctionExpression>);
    testImports('export var Component = function () {};', 'Component');
    test('var Component = () => {}', src =>
      parse
        .statementLast<VariableDeclaration>(src)
        .get('declarations.0.init') as NodePath<ArrowFunctionExpression>);
    testImports('export var Component = () => {}', 'Component');
  });

  describe('ES6 default exports', () => {
    describe('Default React.createClass export', () => {
      test('export default React.createClass({});', src =>
        parse
          .statementLast<ExportDefaultDeclaration>(src)
          .get('declaration.arguments.0') as NodePath<ObjectExpression>);
    });

    describe('Default class declaration export', () => {
      test('export default class Component {}', src =>
        parse.statementLast<ExportDefaultDeclaration>(src).get('declaration'));
      testDecorators(
        'class Component {}',
        src =>
          parse.statementLast<ExportDefaultDeclaration>(src).get('declaration'),
        'export default',
      );
    });

    describe('Default class expression export', () => {
      test('export default class {}', src =>
        parse.statementLast<ExportDefaultDeclaration>(src).get('declaration'));
      testDecorators(
        'class {}',
        src =>
          parse.statementLast<ExportDefaultDeclaration>(src).get('declaration'),
        'export default',
      );
    });

    describe('Default stateless function export', () => {
      describe('named function', () => {
        test('export default function Component() {}', src =>
          parse
            .statementLast<ExportDefaultDeclaration>(src)
            .get('declaration'));
      });

      describe('anonymous function', () => {
        test('export default function() {}', src =>
          parse
            .statementLast<ExportDefaultDeclaration>(src)
            .get('declaration'));
      });

      describe('arrow function', () => {
        test('export default () => {}', src =>
          parse
            .statementLast<ExportDefaultDeclaration>(src)
            .get('declaration'));
      });
    });
  });

  describe('ES6 named exports', () => {
    describe('Named React.createClass export', () => {
      test('export var Component = React.createClass({});', src =>
        parse
          .statementLast<ExportNamedDeclaration>(src)
          .get(
            'declaration.declarations.0.init.arguments.0',
          ) as NodePath<ObjectExpression>);
    });

    describe('Named class declaration export', () => {
      test('export class Component {}', src =>
        parse.statementLast<ExportNamedDeclaration>(src).get('declaration'));
      testDecorators(
        'class Component {}',
        src =>
          parse.statementLast<ExportNamedDeclaration>(src).get('declaration'),
        'export',
      );
    });

    describe('Named stateless function', () => {
      describe('named function', () => {
        test('export function Component() {}', src =>
          parse.statementLast<ExportNamedDeclaration>(src).get('declaration'));
      });

      describe('anonymous function', () => {
        test('export var Component = function() {}', src =>
          parse.statementLast<ExportNamedDeclaration>(src).get('declaration'));
      });

      describe('arrow function', () => {
        test('export var Component = () => {}', src =>
          parse.statementLast<ExportNamedDeclaration>(src).get('declaration'));
      });
    });
  });

  describe('forwardRef', () => {
    const useDefault = true;

    describe('inline implementation', () => {
      test(`
        React.forwardRef((props, ref) => {});
        import React from "react";`, src =>
        parse.statement<ExpressionStatement>(src, -2).get('expression'));

      testImports(
        `import React from 'react';
         export default React.forwardRef((props, ref) => {});`,
        'RefComponent',
        useDefault,
      );
    });

    describe('inline implementation with memo', () => {
      test(`
        React.memo(React.forwardRef((props, ref) => {}));
        import React from "react";
        `, src =>
        parse.statement<ExpressionStatement>(src, -2).get('expression'));

      testImports(
        `
         export default React.memo(React.forwardRef((props, ref) => {}));
         import React from 'react';
        `,
        'RefComponent',
        useDefault,
      );
    });

    describe('out of line implementation', () => {
      test(`
        let Component = (props, ref) => {};
        React.forwardRef(Component);
        import React from "react";
        `, src =>
        parse.statement<ExpressionStatement>(src, -2).get('expression'));

      testImports(
        `
         let Component = (props, ref) => {};
         export default React.forwardRef(Component);
         import React from 'react';
        `,
        `RefComponent`,
        useDefault,
      );
    });
  });
});
