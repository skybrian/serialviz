'use strict';

import { decodeStream, findLines } from './csv';
import { DeviceOutput } from './state';

export class SerialPortDevice {
  #readers = [] as ReadableStreamGenericReader[];
  #tasks = [] as Promise<any>[];

  constructor(readonly port: SerialPort, readonly output: DeviceOutput) { }

  async connect() {
    try {
      await this.port.open({
        baudRate: 115200,
        bufferSize: 40,
        flowControl: "hardware",
      });

      if (this.output.deviceOpened()) {
        this.#tasks.push(this.#parseRows(this.port.readable));
      }

      this.#closePortWhenDone();
    } catch (e) {
      this.output.deviceCrashed(e);
      return;
    }
  }

  cancel(): void {
    for (let reader of this.#readers) {
      this.#tasks.push(reader.cancel());
    }
    this.#readers = [];
  }

  async #parseRows(stream: ReadableStream) {
    try {
      const reader = stream.getReader();
      this.#readers.push(reader);

      for await (let line of findLines(decodeStream(reader))) {
        this.output.pushDeviceOutput(line);
      }
    } finally {
      await stream.cancel();
    }
  }

  async #closePortWhenDone() {
    for (let task = this.#tasks.shift(); task; task = this.#tasks.shift()) {
      try {
        await task;
      } catch (e) {
        this.output.deviceCrashed(e);
      }
    }

    try {
      await this.port.close();
      this.output.deviceClosed();
    } catch (e) {
      this.output.deviceCrashed(e);
    }
  }
}
