import { testProp, fc } from 'ava-fast-check';
import { decodeStream } from './csv';

import { ReadableStream } from 'node:stream/web';
import test, { ExecutionContext } from 'ava';

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (e) {
    return false;
  }
  return true;
}

const arbitraryUtf8 = fc.fullUnicodeString().map((a) => new TextEncoder().encode(a));

const invalidUtf8Examples = fc.constantFrom(...[
  [0xff],
  [192, 128],
  [193, 128],
  [237, 160, 128],
].map((x) => Uint8Array.from(x)));

testProp('isUtf8 should be true for any Unicode string', [arbitraryUtf8], (t, a) => {
  t.true(isUtf8(a));
});

testProp('isUtf8 should be false for invalid UTF8', [invalidUtf8Examples], (t, a) => {
  t.false(isUtf8(a));
});

function chunkStream(b: Uint8Array, sizes: number[]) {
  let sent = 0;
  let i = 0;
  let done = false;
  return new ReadableStream({
    pull: (controller) => {
      if (done) {
        throw "pull called when done";
      } else if (i < sizes.length) {
        controller.enqueue(b.slice(sent, sent + sizes[i]));
        sent += sizes[i];
        i++;
      } else {
        controller.enqueue(b.slice(sent));
        controller.close();
        done = true;
      }
    }
  });
}

const arbitraryChunks = (input: fc.Arbitrary<Uint8Array>): fc.Arbitrary<[Uint8Array, ReadableStream<Uint8Array>]> =>
  fc.tuple(input, fc.array(fc.nat()))
    .filter(([b, ns]) => ns.reduce((a, b) => a + b, 0) <= b.length)
    .map(([b, ns]) => [b, chunkStream(b, ns)]);

const arbitraryUtf8Chunks = (input: fc.Arbitrary<string>): fc.Arbitrary<[string, ReadableStream<Uint8Array>]> =>
  fc.tuple(input, fc.array(fc.nat()))
    .map(([s, ns]) => [s, new TextEncoder().encode(s), ns] as const)
    .filter(([_, b, ns]) => ns.reduce((a, b) => a + b, 0) <= b.length)
    .map(([s, b, ns]) => [s, chunkStream(b, ns)]);

async function concat(t: ExecutionContext, input: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of input) {
    if (chunk.length == 0) {
      t.fail("got zero-length chunk");
    }
    out += chunk;
  }
  return out;
}

testProp('decodeStream should split the original string for valid Unicode',
  [arbitraryUtf8Chunks(fc.fullUnicodeString())], async (t, [expected, chunkStream]) => {
    const actual = await concat(t, decodeStream(chunkStream));
    t.is(actual, expected);
  }, { numRuns: 1000 });

testProp('decodeStream should emit a replacement character for invalid Unicode',
  [arbitraryChunks(invalidUtf8Examples)], async (t, [_, chunkStream]) => {
    const actual = await concat(t, decodeStream(chunkStream));
    t.true(actual.includes('�'));
  });

testProp('decodeStream should handle arbitrary binary data',
  [arbitraryChunks(fc.uint8Array())], async (t, [original, chunkStream]) => {
    const valid = isUtf8(original);
    const actual = await concat(t, decodeStream(chunkStream));
    if (valid) {
      t.is(new TextDecoder().decode(original), actual);
    } else {
      t.true(actual.includes('�'));
    }
  });

test('decodeStream iterator should release the lock when return is called', async (t) => {
  const stream = chunkStream(Uint8Array.of(0), []);
  const iter: AsyncIterator<string> = decodeStream(stream)[Symbol.asyncIterator]();
  await iter.next();
  t.true(stream.locked);
  await iter.return();
  t.false(stream.locked);
});

test('decodeStream iterator should release the lock when throw is called', async (t) => {
  t.plan(3);
  const stream = chunkStream(Uint8Array.of(0), []);
  const iter: AsyncIterator<string> = decodeStream(stream)[Symbol.asyncIterator]();
  await iter.next();
  t.true(stream.locked);
  try {
    await iter.throw(123);
  } catch (e) {
    t.is(e, 123);
  }
  t.false(stream.locked);
});
