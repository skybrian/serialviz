import { ReadableStream } from 'node:stream/web';

import test, { ExecutionContext } from 'ava';
import { testProp, fc } from 'ava-fast-check';
import { csvParseRows, csvFormatRow } from 'd3-dsv';

import { decodeStream, findLines, parseRow } from './csv.js';

fc.configureGlobal({ numRuns: 1000 })

const biasedStrings = fc.oneof(
  fc.stringOf(fc.constantFrom("\r", "\n", "x", ",")),
  fc.asciiString(),
  fc.fullUnicodeString()
);

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
  return new ReadableStream<Uint8Array>({
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

const arbitraryBinaryChunks = (input: fc.Arbitrary<Uint8Array>): fc.Arbitrary<[Uint8Array, ReadableStream<Uint8Array>]> =>
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
    const actual = await concat(t, decodeStream(chunkStream.getReader()));
    t.is(actual, expected);
  }, { numRuns: 1000 });

testProp('decodeStream should emit a replacement character for invalid Unicode',
  [arbitraryBinaryChunks(invalidUtf8Examples)], async (t, [_, chunkStream]) => {
    const actual = await concat(t, decodeStream(chunkStream.getReader()));
    t.true(actual.includes('�'));
  });

testProp('decodeStream should handle arbitrary binary data',
  [arbitraryBinaryChunks(fc.uint8Array())], async (t, [original, chunkStream]) => {
    const valid = isUtf8(original);
    const actual = await concat(t, decodeStream(chunkStream.getReader()));
    if (valid) {
      t.is(new TextDecoder().decode(original), actual);
    } else {
      t.true(actual.includes('�'));
    }
  });

test('decodeStream iterator should release the lock when return is called', async (t) => {
  const stream = chunkStream(Uint8Array.of(0), []);
  const iter: AsyncIterator<string> = decodeStream(stream.getReader())[Symbol.asyncIterator]();
  await iter.next();
  t.true(stream.locked);
  await iter.return();
  t.false(stream.locked);
});

test('decodeStream iterator should release the lock when throw is called', async (t) => {
  t.plan(3);
  const stream = chunkStream(Uint8Array.of(0), []);
  const iter: AsyncIterator<string> = decodeStream(stream.getReader())[Symbol.asyncIterator]();
  await iter.next();
  t.true(stream.locked);
  try {
    await iter.throw(123);
  } catch (e) {
    t.is(e, 123);
  }
  t.false(stream.locked);
});

async function* chunkGenerator(input: string, splits: number[]): AsyncIterable<string> {
  let seen = 0;
  for (const n of splits) {
    yield input.slice(seen, seen + n);
    seen += n;
  }
  yield input.slice(seen);
}

const arbitraryStringChunks = (input: fc.Arbitrary<string>): fc.Arbitrary<[string, AsyncIterable<string>]> =>
  fc.tuple(input, fc.array(fc.nat()))
    .filter(([s, ns]) => ns.reduce((a, b) => a + b, 0) <= s.length)
    .map(([s, ns]) => [s, chunkGenerator(s, ns)]);

testProp('findLines should generate complete lines',
  [arbitraryStringChunks(biasedStrings)], async (t, [original, input]) => {
    const expected = original.split(/\r?\n/);

    const actual = [];
    for await (const line of findLines(input)) {
      actual.push(line);
    }

    t.deepEqual(actual, expected);
  });

const arbitraryAsciiRecord = fc.array(fc.string(), { minLength: 2 });

testProp('parseRow should allow fields with printable ascii characters', [arbitraryAsciiRecord], async (t, original) => {
  const line = csvFormatRow(original);
  const actual = parseRow(1, line);
  t.deepEqual(actual.fields, original);
});

testProp('parseRow should parse the same way as d3 or refuse', [biasedStrings], (t, input) => {
  const actual = parseRow(1, input);
  if (actual) {
    const expected = csvParseRows(input)[0];
    t.deepEqual(actual.fields, expected);
  } else {
    t.is(actual, null);
  }
}, { examples: [["0\n"], [" 0"]] });

testProp('parseRow should parse quoted strings as one-row records', [fc.string()], (t, input) => {
  const quoted = input.includes('"') ? csvFormatRow([input]) : `"${input}"`;
  const actual = parseRow(1, quoted);
  t.deepEqual(actual.fields, [input]);
});

const arbitraryDoubles = fc.double().map((n) => n + "");

testProp('parseRow should parse doubles as one-row records', [arbitraryDoubles], (t, input) => {
  t.deepEqual(parseRow(1, input).fields, [input]);
});

const arbitraryNonCSV = fc.string().filter((s) => s.match(/^[^ 0-9,\+\-\."][^,]*$/) != null);

testProp('parseRow should reject non-CSV lines', [arbitraryNonCSV], (t, input) => {
  t.is(parseRow(1, input), null);
});
