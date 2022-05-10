'use strict';

import { decodeStream, findLines } from './csv';
import { DeviceOutput } from './state';

export interface Device {
  start(): void;
  stop(): void;
}

export class SerialPortDevice implements Device {
  #readers = [] as ReadableStreamGenericReader[];
  #tasks = [] as Promise<any>[];

  constructor(readonly port: SerialPort, readonly output: DeviceOutput) { }

  start(): void {
    (async () => {
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
    })();
  }

  stop(): void {
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

const generatorPeriod = 10;

export class FunctionGenerator implements Device {
  #timeout: number;
  #seconds: 0;
  #mouseX = 0;
  #mouseY = 0;
  #mouseDown = 0;

  constructor(readonly output: DeviceOutput) { }

  start(): void {
    this.#seconds = 0;
    this.#mouseX = 0;
    this.#mouseY = 0;
    this.#mouseDown = 0;
    ["mousedown", "mousemove", "mouseup"].forEach((event) => {
      window.addEventListener(event, this.#onMouseChange);
    });
    this.#timeout = window.setTimeout(this.#sendRow, generatorPeriod);

    const out = this.output;
    out.deviceOpened();
    out.pushDeviceOutput("Function generator running!");
    out.pushDeviceOutput('Sine,Cosine,Mouse X,Mouse Y,Mouse Down');
  }

  stop(): void {
    ["mousedown", "mousemove", "mouseup"].forEach((event) => {
      window.removeEventListener(event, this.#onMouseChange);
    });
    window.clearTimeout(this.#timeout);
    this.output.deviceClosed();
  }

  #onMouseChange = (e: MouseEvent): void => {
    this.#mouseX = e.pageX;
    this.#mouseY = e.pageY;
    this.#mouseDown = e.buttons & 1;
  }

  #sendRow = () => {
    this.#timeout = window.setTimeout(this.#sendRow, generatorPeriod);

    const row = [
      Math.sin(this.#seconds * 2),
      Math.cos(this.#seconds * 2),
      this.#mouseX,
      this.#mouseY,
      this.#mouseDown
    ];

    this.output.pushDeviceOutput(row.join(","));
    this.#seconds += generatorPeriod / 1000;
  }
}
