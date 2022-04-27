export async function* decodeStream(input: ReadableStream) : AsyncIterable<string> {
  const reader = input.getReader();
  const decoder = new TextDecoder("utf-8", {fatal: false});
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const result = decoder.decode(new Uint8Array(0));
        if (result.length > 0) yield result;
        return;
      }
      const result = decoder.decode(value, {stream: true})
      if (result.length > 0) yield result;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* findLines(input: AsyncIterable<string>) : AsyncIterable<string> {
  let prefix = "";
  for await (let chunk of input) {
    if (prefix.endsWith('\r')) {
      chunk = prefix.slice(-1) + chunk;
      prefix = prefix.slice(0, -1);
    }
    const lines = chunk.split(/\r?\n/);
    if (lines.length == 1) {
      prefix += lines[0];
      continue;
    }
    yield prefix + lines[0];
    yield* lines.slice(1, lines.length-1);
    prefix = lines[lines.length - 1];
  }
  yield prefix;
}
