import { describe, it } from 'node:test';
import assert from 'node:assert';
import { addXlsxPrefixes, stripXlsxPrefixes } from '../src/utils/xlsx-formula.js';

describe('addXlsxPrefixes', () => {
  it('leaves plain functions unchanged', () => {
    assert.strictEqual(addXlsxPrefixes('SUM(1,2,3)'), 'SUM(1,2,3)');
    assert.strictEqual(addXlsxPrefixes('IF(A1>0,"yes","no")'), 'IF(A1>0,"yes","no")');
    assert.strictEqual(addXlsxPrefixes('VLOOKUP(1,A:B,2,FALSE)'), 'VLOOKUP(1,A:B,2,FALSE)');
  });

  it('adds _xlfn. to modern functions', () => {
    assert.strictEqual(addXlsxPrefixes('XLOOKUP(1,A:A,B:B)'), '_xlfn.XLOOKUP(1,A:A,B:B)');
    assert.strictEqual(addXlsxPrefixes('IFS(A1>0,"pos",A1<0,"neg")'), '_xlfn.IFS(A1>0,"pos",A1<0,"neg")');
    assert.strictEqual(addXlsxPrefixes('CONCAT("a","b")'), '_xlfn.CONCAT("a","b")');
    assert.strictEqual(addXlsxPrefixes('TEXTJOIN(",",TRUE,A1:A5)'), '_xlfn.TEXTJOIN(",",TRUE,A1:A5)');
  });

  it('adds _xlfn._xlws. to dynamic array functions', () => {
    assert.strictEqual(addXlsxPrefixes('SORT(A1:A5)'), '_xlfn._xlws.SORT(A1:A5)');
    assert.strictEqual(addXlsxPrefixes('FILTER(A1:A5,B1:B5)'), '_xlfn._xlws.FILTER(A1:A5,B1:B5)');
    assert.strictEqual(addXlsxPrefixes('UNIQUE(A1:A5)'), '_xlfn._xlws.UNIQUE(A1:A5)');
    assert.strictEqual(addXlsxPrefixes('SEQUENCE(5)'), '_xlfn._xlws.SEQUENCE(5)');
    assert.strictEqual(addXlsxPrefixes('RANDARRAY(3,3)'), '_xlfn._xlws.RANDARRAY(3,3)');
  });

  it('handles dotted function names', () => {
    assert.strictEqual(addXlsxPrefixes('NORM.DIST(1,0,1,TRUE)'), '_xlfn.NORM.DIST(1,0,1,TRUE)');
    assert.strictEqual(addXlsxPrefixes('T.DIST.2T(1.96,10)'), '_xlfn.T.DIST.2T(1.96,10)');
    assert.strictEqual(addXlsxPrefixes('CEILING.MATH(6.3)'), '_xlfn.CEILING.MATH(6.3)');
    assert.strictEqual(addXlsxPrefixes('STDEV.S(1,2,3)'), '_xlfn.STDEV.S(1,2,3)');
  });

  it('handles nested formulas', () => {
    assert.strictEqual(
      addXlsxPrefixes('IF(XLOOKUP(1,A:A,B:B)>0,SORT(C:C),"no")'),
      'IF(_xlfn.XLOOKUP(1,A:A,B:B)>0,_xlfn._xlws.SORT(C:C),"no")'
    );
    assert.strictEqual(
      addXlsxPrefixes('SUM(FILTER(A1:A5,B1:B5>0))'),
      'SUM(_xlfn._xlws.FILTER(A1:A5,B1:B5>0))'
    );
  });

  it('is idempotent — already-prefixed formulas unchanged', () => {
    const prefixed = '_xlfn.XLOOKUP(1,A:A,B:B)';
    assert.strictEqual(addXlsxPrefixes(prefixed), prefixed);

    const prefixed2 = '_xlfn._xlws.SORT(A1:A5)';
    assert.strictEqual(addXlsxPrefixes(prefixed2), prefixed2);

    const prefixed3 = 'IF(_xlfn.IFS(A1>0,"a",TRUE,"b")="a",_xlfn._xlws.SORT(C:C),"no")';
    assert.strictEqual(addXlsxPrefixes(prefixed3), prefixed3);
  });

  it('handles multiple modern functions in one formula', () => {
    assert.strictEqual(
      addXlsxPrefixes('MAXIFS(A:A,B:B,">0")+MINIFS(A:A,B:B,"<10")'),
      '_xlfn.MAXIFS(A:A,B:B,">0")+_xlfn.MINIFS(A:A,B:B,"<10")'
    );
  });
});

describe('stripXlsxPrefixes', () => {
  it('removes _xlfn. prefix', () => {
    assert.strictEqual(stripXlsxPrefixes('_xlfn.XLOOKUP(1,A:A,B:B)'), 'XLOOKUP(1,A:A,B:B)');
    assert.strictEqual(stripXlsxPrefixes('_xlfn.IFS(A1>0,"a")'), 'IFS(A1>0,"a")');
    assert.strictEqual(stripXlsxPrefixes('_xlfn.NORM.DIST(1,0,1,TRUE)'), 'NORM.DIST(1,0,1,TRUE)');
  });

  it('removes _xlfn._xlws. prefix', () => {
    assert.strictEqual(stripXlsxPrefixes('_xlfn._xlws.SORT(A1:A5)'), 'SORT(A1:A5)');
    assert.strictEqual(stripXlsxPrefixes('_xlfn._xlws.FILTER(A1:A5,B1:B5)'), 'FILTER(A1:A5,B1:B5)');
    assert.strictEqual(stripXlsxPrefixes('_xlfn._xlws.UNIQUE(A1:A5)'), 'UNIQUE(A1:A5)');
  });

  it('handles nested formulas', () => {
    assert.strictEqual(
      stripXlsxPrefixes('IF(_xlfn.XLOOKUP(1,A:A,B:B)>0,_xlfn._xlws.SORT(C:C),"no")'),
      'IF(XLOOKUP(1,A:A,B:B)>0,SORT(C:C),"no")'
    );
  });

  it('is idempotent — already-clean formulas unchanged', () => {
    assert.strictEqual(stripXlsxPrefixes('SUM(1,2,3)'), 'SUM(1,2,3)');
    assert.strictEqual(stripXlsxPrefixes('XLOOKUP(1,A:A,B:B)'), 'XLOOKUP(1,A:A,B:B)');
  });
});

describe('round-trip', () => {
  const formulas = [
    'SUM(1,2,3)',
    'XLOOKUP(1,A:A,B:B)',
    'SORT(A1:A5)',
    'IF(XLOOKUP(1,A:A,B:B)>0,SORT(C:C),"no")',
    'NORM.DIST(42,40,1.5,TRUE)',
    'MAXIFS(A:A,B:B,">0")+MINIFS(A:A,B:B,"<10")',
    'TEXTJOIN(",",TRUE,FILTER(A1:A5,B1:B5>0))',
    'CEILING.MATH(6.3)',
    'T.DIST.2T(1.96,10)',
    'STDEV.S(1,2,3)+VAR.P(4,5,6)',
  ];

  for (const f of formulas) {
    it(`strip(add("${f}")) === "${f}"`, () => {
      assert.strictEqual(stripXlsxPrefixes(addXlsxPrefixes(f)), f);
    });
  }
});
