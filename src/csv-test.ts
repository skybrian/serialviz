import { testProp, fc } from 'ava-fast-check';
import { decodeStream } from './csv';

import { ReadableStream } from 'node:stream/web';

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", {fatal: true}).decode(bytes)
  } catch (e) {
    return false;
  }
  return true;
}

const utf8Bytes = fc.fullUnicodeString().map((a) => new TextEncoder().encode(a));

const notUtf8Bytes = fc.constantFrom(...[
  [0xff],
  [192,128],
  [193,128],
  [237,160,128],
].map((x) => Uint8Array.from(x)));

testProp('isUtf8 should be true for any Unicode string', [utf8Bytes], (t, a) => {
  t.true(isUtf8(a));
});

testProp('isUtf8 should be false for some examples', [notUtf8Bytes], (t, a) => {
  t.false(isUtf8(a));
});

function byteStream(input: fc.Arbitrary<string>): fc.Arbitrary<[string, ReadableStream<Uint8Array>]> {
  const splits =
    fc.tuple(input, fc.nat())
      .map(([s, n]) => [s, new TextEncoder().encode(s), n] as const)
      .filter(([_, b, n]) => n <= b.length);

  return splits.map(([s, b, n]) => {
    const stream = new ReadableStream({
      start: (controller) => {
        controller.enqueue(b.slice(0, n));
        controller.enqueue(b.slice(n));
        controller.close();
      }
    });
    return [s, stream];
  });
}

testProp('decodeStream should emit substrings of the original string', [byteStream(fc.fullUnicodeString())], async (t, [expected, stream]) => {
  let actual = "";
  for await (const chunk of decodeStream(stream)) {
    if (chunk.length == 0) {
      t.fail("got zero-length chunk");
    }
    actual += chunk;
  }
  t.deepEqual(actual, expected);
}, {numRuns: 1000});
