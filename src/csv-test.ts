import { testProp, fc } from 'ava-fast-check';
import { concat } from './csv';

testProp('should concatenate', [fc.string(), fc.string()], (t, a, b) => {
  t.true(concat(a, b) == a + b);
});
