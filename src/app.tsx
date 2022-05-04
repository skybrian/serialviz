'use strict';

import { h, render, Component, createRef } from 'preact';
import { Terminal } from 'xterm';

class Start extends Component<{onConnect: (port: SerialPort) => void}, {choosing: boolean}> {
  state = { choosing: false }

  choosePort = async () => {
    this.setState({choosing: true});

    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      this.setState({choosing: false});
      throw e;
    }

    const info = port.getInfo();
    console.log(`Connecting to ${info.usbVendorId} ${info.usbProductId}`);
    this.props.onConnect(port);
  }

  render() {
    return <button id="connect" onClick={this.choosePort} disabled={this.state.choosing}>Connect</button>;
  }
}

interface Connecting {
  kind: "connecting";
}

interface Reading {
  kind: "reading";
  reader: ReadableStreamDefaultReader<Uint8Array>;
}

interface Closing {
  kind: "closing";
}

interface Done {
  kind: "done";
  message: string;
}

type PortState = Connecting | Reading | Closing | Done;

class PortView extends Component<{defaultPort: SerialPort}, PortState> {
  port = this.props.defaultPort; // ignore any changes

  state = {kind: "connecting"} as PortState;

  componentDidMount() {
    // Automatically close the serial port when another tab opens.
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key == "openingSerialPort") {
        this.setState({kind: "done", message: "Closed"});
      }
    });
    this.openPort();
  }

  componentDidUpdate(_: any, prev: PortState) {
    if (prev.kind == "reading" && (this.state.kind != "reading" || this.state.reader != prev.reader)) {
      this.closePort(prev.reader);
    }
    if (prev.kind != "connecting" && this.state.kind == "connecting") {
      this.openPort();
    }
  }

  openPort = async () => {
    if (this.state.kind != "connecting") return;
    // Tell other windows to close the serial port.
    // This ensures we don't try to read the same serial port at the same time.
    // See: https://bugs.chromium.org/p/chromium/issues/detail?id=1319178
    localStorage.openingSerialPort = Date.now();

    // Give them a chance to pause.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (this.state.kind != "connecting") return;

    try {
      await this.port.open({
        baudRate: 115200,
        bufferSize: 40,
        flowControl: "hardware",
      });

      const reader = this.port.readable.getReader();
      this.setState({kind: "reading", reader: reader});
    } catch (e) {
      this.setState({kind: "done", message: e + ""});
    }
  }

  closePort = async (reader: ReadableStreamDefaultReader) => {
    try {
      await reader.cancel();
      await this.port.close();
      this.setState({kind: "done", message: "Closed"});
    } catch (e) {
      this.setState({kind: "done", message: e + ""});
    }
  }

  stop = () => {
    this.setState({kind: "closing"});
  }

  restart = () => {
    this.setState({kind: "connecting"});
  }

  render() {
    const button = () => {
      switch (this.state.kind) {
        case "connecting":
          return <button disabled={true}>Stop</button>;
        case "reading":
          return <button onClick={this.stop}>Stop</button>;
        case "closing":
          return <button disabled={true}>Stop</button>;
        case "done":
          return <button onClick={this.restart}>Restart</button>;
      }
    }

    return <div>
      <div>
        {button()}
      </div>
      <TermView input={this.state}/>
    </div>;
  }
}

class TermView extends Component<{input: PortState}, {}> {
  terminal = new Terminal({
    rows: 50,
    scrollback: 0,
  });

  terminalElt = createRef();

  reader = null as ReadableStreamDefaultReader<Uint8Array>;

  componentDidMount() {
    this.terminal.open(this.terminalElt.current);
    this.componentDidUpdate();
  }

  componentDidUpdate() {
    const input = this.props.input;
    switch (input.kind) {
      case "connecting":
        this.terminal.clear();
        this.lastMessage = null;
        break;
      case "reading":
        if (this.reader != input.reader) {
          this.reader = input.reader;
          this.copyToTerminal(input.reader);
          this.lastMessage = null;
        }
        break;
      case "closing":
        break;
      case "done":
        this.writeStatus(input.message);
        break;
    }
  }

  isCurrent(reader: ReadableStreamDefaultReader<Uint8Array>): boolean {
    const input = this.props.input;
    return input.kind === "reading" && input.reader === reader;
  }

  copyToTerminal = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    try {
      while (true) {
        if (!this.isCurrent(reader)) {
          return;
        }
        const { value, done } = await reader.read();
        if (done || !this.isCurrent(reader)) {
          return;
        }
        this.terminal.write(value);
      }
    }  catch (e) {
      this.writeStatus(e);
    } finally {
      reader.releaseLock();
    }
  }

  lastMessage = null as string;

  writeStatus(message: string) {
    if (message == this.lastMessage) return;
    this.terminal.write(`\n*** ${message} ***\r\n\r\n`);
    this.lastMessage = message;
  }

  render() {
    return <div id="terminal" ref={this.terminalElt}></div>
  }
}

const appElt = document.getElementById("app") as HTMLDivElement;

function showLog(port: SerialPort) {
  render(<PortView defaultPort={port}/>, appElt);
}

render(<Start onConnect={showLog}/>, appElt);
